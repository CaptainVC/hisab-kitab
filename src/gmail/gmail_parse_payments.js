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

const { getParser } = require('../parsers');

function parseWithParser(msgMeta, plainText, sourceCfg){
  const parserId = sourceCfg?.parser?.id;
  if(!parserId) throw new Error('Missing parser.id in email_payments.json for a source');
  const parser = getParser(parserId);
  const events = parser.parse({ msg: msgMeta, text: plainText, cfg: sourceCfg });
  return Array.isArray(events) ? events : [];
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

  // Build a Gmail query to reduce scanning.
  // We keep it broad: match by known sender domains/addresses.
  const qParts = [];
  for (const cfg of Object.values(paymentsCfg.sources || {})) {
    const froms = cfg?.match?.fromContains || [];
    for (const f of froms) {
      // handle either full address or domain-ish token
      qParts.push(`from:${String(f).replace(/\s+/g,'')}`);
    }
  }
  const q = qParts.length ? '(' + Array.from(new Set(qParts)).join(' OR ') + ')' : undefined;

  // Paginate like orders parser: fetch up to `max` messages from this label.
  let msgs = [];
  let pageToken = undefined;
  while (msgs.length < max) {
    const batchSize = Math.min(500, max - msgs.length);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [lbl.id],
      q,
      maxResults: batchSize,
      pageToken
    });
    const batch = listRes.data.messages || [];
    msgs = msgs.concat(batch);
    pageToken = listRes.data.nextPageToken;
    if (!pageToken || batch.length === 0) break;
  }

  const payments = [];
  const unknown = [];

  for(const m of msgs){
    // Optimization: fetch metadata first (much lighter than format=full).
    // For HDFC alerts, the snippet usually contains the full transaction line we need.
    // For other sources (e.g. Mobikwik), snippet is often sufficient too; if not, we can add a per-source flag later.
    const meta = await gmail.users.messages.get({
      userId:'me',
      id:m.id,
      format:'metadata',
      metadataHeaders:['From','Subject','Date']
    });

    const h = meta.data.payload?.headers || [];
    const from = header(h,'From');
    const subject = header(h,'Subject');

    // Use snippet as body text fallback to avoid full fetch.
    const plain = String(meta.data.snippet || '');

    const msgMeta = {
      messageId: meta.data.id,
      threadId: meta.data.threadId,
      internalDateMs: Number(meta.data.internalDate || 0),
      from,
      subject
    };

    let matched = false;
    for(const [srcKey, cfg] of Object.entries(paymentsCfg.sources || {})){
      if(!cfg.enabled) continue;
      if(!matchesRule(from, subject, cfg.match || {})) continue;
      // parse via configured parser
      const events = parseWithParser(msgMeta, plain, cfg);
      for(const e of events) payments.push(e);
      matched = true;
      break;
    }

    if(!matched){
      unknown.push({ messageId: msgMeta.messageId, from, subject });
    }
  }

  const outPath = path.join(baseDir, 'payments_parsed.json');

  const existing = readJsonSafe(outPath, { payments: [], unknown: [] });
  const byKey = new Map();
  const keyOf = (p) => p.messageId || JSON.stringify(p).slice(0, 200);
  for (const p of (existing.payments || [])) byKey.set(keyOf(p), p);
  for (const p of payments) byKey.set(keyOf(p), p);

  const mergedPayments = Array.from(byKey.values());
  const mergedUnknownRaw = (existing.unknown || []).concat(unknown || []);
  const unkById = new Map();
  for (const u of mergedUnknownRaw) {
    const id = u.messageId || JSON.stringify(u).slice(0, 120);
    unkById.set(id, u);
  }
  const mergedUnknown = Array.from(unkById.values());

  fs.writeFileSync(outPath, JSON.stringify({ ok: true, label, count: mergedPayments.length, payments: mergedPayments, unknown: mergedUnknown }, null, 2));

  process.stdout.write(JSON.stringify({ ok: true, count: payments.length, saved: outPath, unknown: unknown.length, total: mergedPayments.length, unknown_total: mergedUnknown.length }, null, 2) + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });
