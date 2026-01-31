#!/usr/bin/env node
/* Parse order/receipt emails using config-driven parser selection.
 *
 * Config: ~/HisabKitab/refs/email_merchants.json
 * - Each merchant entry can specify:
 *   - match (fromContains, subjectContains)
 *   - parser: { type: 'email'|'pdf', id: '...' }
 *
 * Output: ~/HisabKitab/orders_parsed.json
 *
 * Usage:
 *   node src/gmail/gmail_parse_orders_v2.js --base-dir ~/HisabKitab --label HisabKitab --max 500
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');
const { getParser } = require('../parsers');

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
    max: Number(get('--max') || 200),
    merchant: (get('--merchant') || '').trim().toUpperCase()
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

function findPdfParts(payload){
  const out = [];
  function walk(p){
    if(!p) return;
    const fn = p.filename || '';
    const mt = (p.mimeType || '').toLowerCase();
    const attId = p.body && p.body.attachmentId;
    if(attId && (mt === 'application/pdf' || fn.toLowerCase().endsWith('.pdf'))){
      out.push({ filename: fn || 'attachment.pdf', attachmentId: attId, mimeType: mt });
    }
    for(const part of (p.parts||[])) walk(part);
  }
  walk(payload);
  return out;
}

async function savePdfAttachments(gmail, baseDir, merchantKey, msgId, pdfParts){
  const outDir = path.join(baseDir, 'attachments', merchantKey.toLowerCase(), msgId);
  fs.mkdirSync(outDir, { recursive: true });

  const saved = [];
  for(const p of pdfParts){
    const att = await gmail.users.messages.attachments.get({ userId:'me', messageId: msgId, id: p.attachmentId });
    const data = att.data.data.replace(/-/g,'+').replace(/_/g,'/');
    const buf = Buffer.from(data, 'base64');
    const outPath = path.join(outDir, p.filename || (merchantKey.toLowerCase() + '.pdf'));
    fs.writeFileSync(outPath, buf);
    saved.push(outPath);
  }
  return saved;
}

function buildGmailQueryForMerchant(key, mc){
  // Build a simple Gmail query to reduce scanning.
  // We keep this intentionally conservative.
  const parts = [];
  const froms = mc?.match?.fromContains || [];
  const subs = mc?.match?.subjectContains || [];

  // from: filters are reliable
  if(froms.length) {
    const ors = froms.map(s => `from:${String(s).replace(/\s+/g,'')}`);
    parts.push('(' + ors.join(' OR ') + ')');
  }

  // Gmail subject search is tokenized; underscores and punctuation can fail exact matching.
  // So we extract safe word tokens and search those.
  const subjectTokens = [];
  for(const s of subs) {
    const toks = String(s).toLowerCase().split(/[^a-z0-9]+/g).filter(t => t.length >= 4);
    for(const t of toks) subjectTokens.push(t);
  }
  if(subjectTokens.length) {
    const uniq = [...new Set(subjectTokens)];
    // Use AND semantics to reduce false positives (e.g. ZEPTO should match both 'zepto' AND 'invoice').
    // Use plain terms rather than subject: since Gmail API tokenization can be finicky with subject: and underscores.
    parts.push(uniq.join(' '));
  } else {
    // fallback: search merchant key itself
    parts.push(key.toLowerCase());
  }

  // If it's a PDF parser, likely has attachment.
  if(mc?.parser?.type === 'pdf') parts.push('has:attachment filename:pdf');

  return parts.join(' ');
}

async function main(){
  const { baseDir, label, max, merchant } = parseArgs(process.argv);
  const cfgPath = path.join(baseDir, 'refs', 'email_merchants.json');
  if(!fs.existsSync(cfgPath)) throw new Error('Missing config: ' + cfgPath);
  const cfg = readJson(cfgPath);

  if(merchant && !cfg[merchant]) {
    throw new Error(`Unknown merchant '${merchant}'. Valid: ${Object.keys(cfg).join(', ')}`);
  }

  const authClient = await auth(baseDir);
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const lbl = (labelsRes.data.labels || []).find(l => l.name === label);
  if(!lbl) throw new Error(`Label '${label}' not found`);

  // If a merchant is specified, use a targeted Gmail query to avoid scanning the whole label.
  let q = null;
  if(merchant){
    const mc = cfg[merchant];
    if(!mc) throw new Error(`Unknown merchant key '${merchant}' in email_merchants.json`);
    q = buildGmailQueryForMerchant(merchant, mc);
  }

  const listRes = await gmail.users.messages.list({ userId: 'me', labelIds: [lbl.id], q: q || undefined, maxResults: max });
  const msgs = listRes.data.messages || [];

  const outEvents = [];
  const unknown = [];

  for(const m of msgs){
    const full = await gmail.users.messages.get({ userId:'me', id:m.id, format:'full' });
    const h = full.data.payload?.headers || [];
    const from = header(h,'From');
    const subject = header(h,'Subject');

    const msgMeta = {
      messageId: full.data.id,
      threadId: full.data.threadId,
      internalDateMs: Number(full.data.internalDate || 0),
      from,
      subject
    };

    // find matching merchant config
    let matchedKey = null;
    let matchedCfg = null;

    if(merchant){
      const mc = cfg[merchant];
      if(mc?.enabled && matchesRule(from, subject, mc.match || {})){
        matchedKey = merchant;
        matchedCfg = mc;
      }
    } else {
      for(const [k, mc] of Object.entries(cfg)){
        if(!mc?.enabled) continue;
        const match = mc.match || {};
        if(!matchesRule(from, subject, match)) continue;
        matchedKey = k;
        matchedCfg = mc;
        break;
      }
    }

    if(!matchedKey){
      unknown.push({ messageId: msgMeta.messageId, from, subject });
      continue;
    }

    const parserId = matchedCfg?.parser?.id;
    if(!parserId){
      unknown.push({ messageId: msgMeta.messageId, from, subject, error: 'missing parser.id in email_merchants.json' });
      continue;
    }

    const parser = getParser(parserId);

    // extract best text
    const parts = collectTextParts(full.data.payload);
    let plain = '';
    const tp = parts.find(p => p.mimeType === 'text/plain');
    const th = parts.find(p => p.mimeType === 'text/html');
    if(tp) plain = tp.text;
    else if(th) plain = stripHtml(th.text);

    if(matchedCfg?.parser?.type === 'pdf'){
      const pdfs = findPdfParts(full.data.payload);
      if(!pdfs.length){
        outEvents.push({ merchant: matchedKey, parse_status: 'error', parse_error: 'expected pdf attachment but none found', messageId: msgMeta.messageId, subject });
        continue;
      }
      const saved = await savePdfAttachments(gmail, baseDir, matchedKey, msgMeta.messageId, pdfs);
      for(const pdfPath of saved){
        const events = parser.parse({ msg: msgMeta, pdfPath, cfg: matchedCfg });
        for(const e of events) outEvents.push(e);
      }
    } else {
      const events = parser.parse({ msg: msgMeta, text: plain, cfg: matchedCfg });
      for(const e of events) outEvents.push(e);
    }
  }

  const outPath = path.join(baseDir, 'orders_parsed.json');

  // Merge with existing (append/update by stable key).
  const existing = readJsonSafe(outPath, { orders: [], unknown: [] });
  const byKey = new Map();
  const keyOf = (o) => {
    // Prefer messageId + pdfPath (unique per attachment) else messageId.
    if (o.messageId && o.pdfPath) return o.messageId + '::' + o.pdfPath;
    if (o.messageId && o.invoice_number) return o.messageId + '::' + o.invoice_number;
    if (o.messageId) return o.messageId;
    return JSON.stringify(o).slice(0, 200);
  };

  for (const o of (existing.orders || [])) byKey.set(keyOf(o), o);
  for (const o of outEvents) byKey.set(keyOf(o), o);

  const mergedOrders = Array.from(byKey.values());
  const mergedUnknown = (existing.unknown || []).concat(unknown || []);

  fs.writeFileSync(outPath, JSON.stringify({ ok: true, label, count: mergedOrders.length, orders: mergedOrders, unknown: mergedUnknown }, null, 2));

  process.stdout.write(JSON.stringify({ ok: true, count: outEvents.length, saved: outPath, unknown: unknown.length, total: mergedOrders.length }, null, 2) + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });
