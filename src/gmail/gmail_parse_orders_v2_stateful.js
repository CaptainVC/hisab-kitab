#!/usr/bin/env node
/* Stateful/resumable order parsing to avoid SIGKILL when many PDFs are present.
 *
 * - Reads merchant rules from ~/HisabKitab/refs/email_merchants.json
 * - Iterates per merchant with Gmail query (within label) and paginates
 * - Saves state after each page: ~/HisabKitab/orders_parse_state.json
 * - Merges into ~/HisabKitab/orders_parsed.json incrementally
 *
 * Usage:
 *   node src/gmail/gmail_parse_orders_v2_stateful.js --base-dir ~/HisabKitab --label HisabKitab --max 200
 *   (run repeatedly until done)
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

function writeJson(fp, obj){
  fs.mkdirSync(path.dirname(fp), { recursive:true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    label: get('--label') || 'HisabKitab',
    max: Number(get('--max') || 200),
    merchant: (get('--merchant') || '').trim().toUpperCase(),
    statePath: expandHome(get('--state') || '~/HisabKitab/orders_parse_state.json')
  };
}

async function auth(baseDir){
  const credsPath = path.join(baseDir,'credentials.json');
  const tokenPath = path.join(baseDir,'gmail_token.json');
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
    const rawName = p.filename || (merchantKey.toLowerCase() + '.pdf');
    const safeName = String(rawName).replace(/[\\/]+/g, '_').replace(/\s+/g, ' ').trim();
    const outPath = path.join(outDir, safeName);
    fs.writeFileSync(outPath, buf);
    saved.push(outPath);
  }
  return saved;
}

function buildGmailQueryForMerchant(key, mc){
  const parts = [];
  const froms = mc?.match?.fromContains || [];
  const subs = mc?.match?.subjectContains || [];

  if(froms.length){
    const ors = froms.map(s => `from:${String(s).replace(/\s+/g,'')}`);
    parts.push('(' + ors.join(' OR ') + ')');
  }

  // Subject terms (use token approach)
  const subjectTokens = [];
  for(const s of subs){
    const toks = String(s).toLowerCase().split(/[^a-z0-9]+/g).filter(t => t.length >= 4);
    for(const t of toks) subjectTokens.push(t);
  }
  if(subjectTokens.length){
    const uniq = [...new Set(subjectTokens)];
    parts.push(uniq.join(' '));
  }

  if(mc?.parser?.type === 'pdf') parts.push('has:attachment');
  return parts.join(' ');
}

function mergeOrders(baseDir, outEvents, unknown){
  const outPath = path.join(baseDir, 'orders_parsed.json');
  const existing = readJsonSafe(outPath, { orders: [], unknown: [] });

  const byKey = new Map();
  const keyOf = (o) => {
    if (o.messageId && o.pdfPath) return o.messageId + '::' + o.pdfPath;
    if (o.messageId && o.invoice_number) return o.messageId + '::' + o.invoice_number;
    if (o.messageId && o.order_id) return o.messageId + '::' + o.order_id;
    if (o.messageId) return o.messageId;
    return JSON.stringify(o).slice(0, 200);
  };

  for (const o of (existing.orders || [])) byKey.set(keyOf(o), o);
  for (const o of outEvents) byKey.set(keyOf(o), o);

  const mergedOrders = Array.from(byKey.values());

  // Keep unknown from THIS run only (do not accumulate forever)
  const mergedUnknown = unknown || [];

  fs.writeFileSync(outPath, JSON.stringify({ ok: true, count: mergedOrders.length, orders: mergedOrders, unknown: mergedUnknown }, null, 2));
  return { outPath, total: mergedOrders.length, unknown_total: mergedUnknown.length };
}

async function main(){
  const { baseDir, label, max, merchant, statePath } = parseArgs(process.argv);
  const cfgPath = path.join(baseDir, 'refs', 'email_merchants.json');
  const cfg = readJson(cfgPath);

  const authClient = await auth(baseDir);
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const lbl = (labelsRes.data.labels || []).find(l => l.name === label);
  if(!lbl) throw new Error(`Label '${label}' not found`);

  const state = readJsonSafe(statePath, { perMerchant: {}, done: {} });

  const keys = merchant ? [merchant] : Object.keys(cfg).filter(k => cfg[k]?.enabled);

  let processed = 0;
  const outEvents = [];
  const unknown = [];

  for(const k of keys){
    if(processed >= max) break;
    const mc = cfg[k];
    if(!mc?.enabled) continue;

    const q = buildGmailQueryForMerchant(k, mc);
    const st = state.perMerchant?.[k] || { pageToken: null, done: false };
    if(st.done) continue;

    const batchSize = Math.min(25, max - processed);
    const listRes = await gmail.users.messages.list({
      userId:'me',
      labelIds:[lbl.id],
      q: q || undefined,
      maxResults: batchSize,
      pageToken: st.pageToken || undefined
    });

    const msgs = listRes.data.messages || [];
    let nextToken = listRes.data.nextPageToken || null;

    for(const m of msgs){
      // Save progress aggressively: treat our pageToken as "start from here" for the next run.
      // Gmail page tokens are page-level; we still update after each message to reduce rework.
      // (Worst case: we reprocess a few messages; merge logic dedupes.)
      state.perMerchant = state.perMerchant || {};
      state.perMerchant[k] = state.perMerchant[k] || { pageToken: st.pageToken || null, done: false };
      writeJson(statePath, state);

      // metadata first
      const meta = await gmail.users.messages.get({ userId:'me', id:m.id, format:'metadata', metadataHeaders:['From','Subject','Date'] });
      const h = meta.data.payload?.headers || [];
      const from = header(h,'From');
      const subject = header(h,'Subject');

      const msgMeta = {
        messageId: meta.data.id,
        threadId: meta.data.threadId,
        internalDateMs: Number(meta.data.internalDate || 0),
        from,
        subject
      };

      // guard: ensure it matches
      if(!matchesRule(from, subject, mc.match || {})) {
        continue;
      }

      const parserId = mc?.parser?.id;
      if(!parserId){
        unknown.push({ messageId: msgMeta.messageId, from, subject, error:'missing parser.id' });
        continue;
      }

      const parser = getParser(parserId);

      if(mc?.parser?.type === 'pdf'){
        const full = await gmail.users.messages.get({ userId:'me', id:m.id, format:'full' });
        const pdfs = findPdfParts(full.data.payload);
        if(!pdfs.length){
          outEvents.push({ merchant: k, parse_status:'error', parse_error:'expected pdf attachment but none found', messageId: msgMeta.messageId, subject });
          continue;
        }
        const saved = await savePdfAttachments(gmail, baseDir, k, msgMeta.messageId, pdfs);
        for(const pdfPath of saved){
          const events = parser.parse({ msg: msgMeta, pdfPath, cfg: mc }) || [];
          for(const e of events) outEvents.push(e);
        }
      } else {
        // email parser: snippet first, then full
        const snippet = String(meta.data.snippet || '');
        let events = [];
        try { events = parser.parse({ msg: msgMeta, text: snippet, html: snippet, htmlRaw: '', cfg: mc }) || []; } catch { events = []; }
        const useful = Array.isArray(events) && events.some(e => (e.parse_status==='ok') || (e.items && e.items.length) || (e.total != null));
        if(!useful){
          const full = await gmail.users.messages.get({ userId:'me', id:m.id, format:'full' });
          const parts = collectTextParts(full.data.payload);
          const tp = parts.find(p => p.mimeType === 'text/plain');
          const th = parts.find(p => p.mimeType === 'text/html');
          const plainText = tp ? tp.text : '';
          const htmlText = th ? th.text : '';
          const htmlStripped = th ? stripHtml(th.text) : '';
          events = parser.parse({ msg: msgMeta, text: plainText || htmlStripped || snippet, html: htmlStripped || snippet, htmlRaw: htmlText || '', cfg: mc }) || [];
        }
        for(const e of (events || [])) outEvents.push(e);
      }

      processed++;
      if(processed >= max) break;
    }

    // update state
    state.perMerchant = state.perMerchant || {};
    state.perMerchant[k] = state.perMerchant[k] || {};
    state.perMerchant[k].pageToken = nextToken;
    state.perMerchant[k].done = !nextToken;

    writeJson(statePath, state);

    if(processed >= max) break;
  }

  const mergeRes = mergeOrders(baseDir, outEvents, unknown);
  process.stdout.write(JSON.stringify({ ok:true, processed, wrote: outEvents.length, unknown: unknown.length, state: statePath, saved: mergeRes.outPath, total: mergeRes.total, unknown_total: mergeRes.unknown_total }, null, 2) + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });
