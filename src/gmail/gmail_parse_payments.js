#!/usr/bin/env node
/* Parse payment emails (HDFC InstaAlerts, MobiKwik, etc.) from a Gmail label.
 * Config: ~/HisabKitab/refs/email_payments.json (from hisab-kitab-config)
 *
 * Usage:
 *   node src/gmail/gmail_parse_payments.js --base-dir ~/HisabKitab --label HisabKitab --max 500
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function readJson(fp){
  return JSON.parse(fs.readFileSync(fp,'utf8'));
}

function readJsonSafe(fp, fallback){
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fallback; }
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    label: get('--label') || 'HisabKitab',
    max: Number(get('--max') || 200)
  };
}

async function auth(baseDir){
  const credsPath = path.join(baseDir,'credentials.json');
  const tokenPath = path.join(baseDir,'gmail_token.json');
  if(!fs.existsSync(credsPath)) throw new Error('Missing ' + credsPath);
  if(!fs.existsSync(tokenPath)) throw new Error('Missing ' + tokenPath);

  const creds = readJson(credsPath);
  const c = creds.installed || creds.web;
  const oAuth2Client = new google.auth.OAuth2(c.client_id, c.client_secret);
  oAuth2Client.setCredentials(readJson(tokenPath));
  return oAuth2Client;
}

function header(headers, name){
  const h = (headers||[]).find(x => (x.name||'').toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decodeB64Url(s){
  if(!s) return '';
  const b64 = s.replace(/-/g,'+').replace(/_/g,'/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

function collectTextParts(payload){
  const out = [];
  function walk(p){
    if(!p) return;
    const mt = (p.mimeType||'').toLowerCase();
    if((mt === 'text/plain' || mt === 'text/html') && p.body && p.body.data){
      out.push({ mimeType: mt, text: decodeB64Url(p.body.data) });
    }
    for(const part of (p.parts||[])) walk(part);
  }
  walk(payload);
  return out;
}

function stripHtml(html){
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/\s+/g,' ')
    .trim();
}

function matchesRule(from, subject, cfg){
  const f = (from||'').toLowerCase();
  const s = (subject||'').toLowerCase();
  const fromOk = !cfg.fromContains?.length || cfg.fromContains.some(x => f.includes(String(x).toLowerCase()));
  const subjOk = !cfg.subjectContains?.length || cfg.subjectContains.some(x => s.includes(String(x).toLowerCase()));
  return fromOk && subjOk;
}

function applyRegex(text, regexStr, groupIndex=1){
  if(!regexStr) return null;
  const re = new RegExp(regexStr, 'i');
  const m = re.exec(text);
  return m ? (m[groupIndex] ?? null) : null;
}

function normalizeAmt(s){
  if(!s) return null;
  const v = Number(String(s).replace(/,/g,''));
  return Number.isFinite(v) ? v : null;
}

function parsePayment(sourceKey, msg, parsedText, cfg){
  const subject = msg.subject;
  const from = msg.from;
  const out = {
    source: sourceKey,
    messageId: msg.messageId,
    threadId: msg.threadId,
    internalDateMs: msg.internalDateMs,
    from,
    subject,
    direction: '',
    amount: null,
    cardLast4: null,
    txnId: null,
    counterparty: null,
    raw: parsedText.slice(0, 2000)
  };

  if(sourceKey === 'HDFC_INSTA_ALERT'){
    const debit = cfg.parse?.direction?.debitSubjectContains || [];
    const credit = cfg.parse?.direction?.creditSubjectContains || [];
    const s = (subject||'').toLowerCase();
    if(debit.some(x => s.includes(String(x).toLowerCase()))) out.direction = 'DEBIT';
    if(credit.some(x => s.includes(String(x).toLowerCase()))) out.direction = 'CREDIT';

    const amtStr = applyRegex(subject + '\n' + parsedText, cfg.parse?.amount?.regex, 1);
    out.amount = normalizeAmt(amtStr);

    const last4 = applyRegex(subject + '\n' + parsedText, cfg.parse?.cardLast4?.regex, 1);
    out.cardLast4 = last4 || null;
  }

  if(sourceKey === 'MOBIKWIK'){
    const t = (subject + '\n' + parsedText);
    const amtStr = applyRegex(t, cfg.parse?.amount?.regex, 2) || applyRegex(t, cfg.parse?.amount?.regex, 1);
    out.amount = normalizeAmt(amtStr);

    const debitC = cfg.parse?.direction?.debitBodyContains || [];
    const creditC = cfg.parse?.direction?.creditBodyContains || [];
    const tl = t.toLowerCase();
    if(debitC.some(x => tl.includes(String(x).toLowerCase()))) out.direction = 'DEBIT';
    if(creditC.some(x => tl.includes(String(x).toLowerCase()))) out.direction = 'CREDIT';

    out.txnId = applyRegex(t, cfg.parse?.txnId?.regex, 1);
    out.counterparty = applyRegex(t, cfg.parse?.counterparty?.regex, 1);
  }

  return out;
}

async function main(){
  const { baseDir, label, max } = parseArgs(process.argv);

  const paymentsCfgPath = path.join(baseDir, 'refs', 'email_payments.json');
  if(!fs.existsSync(paymentsCfgPath)) throw new Error('Missing config: ' + paymentsCfgPath);
  const paymentsCfg = readJson(paymentsCfgPath);

  const authClient = await auth(baseDir);
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const lbl = (labelsRes.data.labels || []).find(l => l.name === label);
  if(!lbl) throw new Error(`Label '${label}' not found`);

  const listRes = await gmail.users.messages.list({ userId: 'me', labelIds: [lbl.id], maxResults: max });
  const msgs = listRes.data.messages || [];

  const payments = [];
  const unknown = [];

  for(const m of msgs){
    const full = await gmail.users.messages.get({ userId:'me', id:m.id, format:'full' });
    const h = full.data.payload?.headers || [];
    const from = header(h,'From');
    const subject = header(h,'Subject');

    // extract best text
    const parts = collectTextParts(full.data.payload);
    let plain = '';
    const tp = parts.find(p => p.mimeType === 'text/plain');
    const th = parts.find(p => p.mimeType === 'text/html');
    if(tp) plain = tp.text;
    else if(th) plain = stripHtml(th.text);

    const msgMeta = {
      messageId: full.data.id,
      threadId: full.data.threadId,
      internalDateMs: Number(full.data.internalDate || 0),
      from,
      subject
    };

    let matched = false;
    for(const [srcKey, cfg] of Object.entries(paymentsCfg.sources || {})){
      if(!cfg.enabled) continue;
      if(!matchesRule(from, subject, cfg.match || {})) continue;
      const p = parsePayment(srcKey, msgMeta, plain, cfg);
      payments.push(p);
      matched = true;
      break;
    }

    if(!matched){
      unknown.push({ messageId: msgMeta.messageId, from, subject });
    }
  }

  const outPath = path.join(baseDir, 'payments_parsed.json');
  fs.writeFileSync(outPath, JSON.stringify({ ok: true, label, count: payments.length, payments, unknown }, null, 2));

  process.stdout.write(JSON.stringify({ ok: true, count: payments.length, saved: outPath, unknown: unknown.length }, null, 2) + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });
