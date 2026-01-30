#!/usr/bin/env node
/* Fetch labeled Gmail messages and parse basic order info into orders.json
 * - Only reads messages under a label (default: HisabKitab)
 * - Extracts: merchant, orderDate, subject, messageId, items (best-effort)
 *
 * Usage:
 *   node gmail_parse_orders.js --base-dir ~/HisabKitab --label HisabKitab --max 50
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

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    label: get('--label') || 'HisabKitab',
    max: Number(get('--max') || 50)
  };
}

async function auth(baseDir){
  const credsPath = path.join(baseDir,'credentials.json');
  const tokenPath = path.join(baseDir,'gmail_token.json');
  if(!fs.existsSync(credsPath)) throw new Error('Missing ' + credsPath);
  if(!fs.existsSync(tokenPath)) throw new Error('Missing ' + tokenPath);

  const creds = readJson(credsPath);
  const c = creds.installed || creds.web;
  if(!c) throw new Error('credentials.json must have installed/web');

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

function identifyMerchant(from, subject){
  const f = (from||'').toLowerCase();
  const s = (subject||'').toLowerCase();
  if(f.includes('amazon.') || s.includes('amazon')) return 'AMAZON';
  if(f.includes('flipkart') || s.includes('flipkart')) return 'FLIPKART';
  if(f.includes('meesho') || s.includes('meesho')) return 'MEESHO';
  if(f.includes('swiggy') || s.includes('swiggy')) return 'SWIGGY';
  if(f.includes('zomato') || s.includes('zomato')) return 'ZOMATO';
  return 'UNKNOWN';
}

function parseAmazonItems(subject, textPlain){
  // Amazon order confirmation subjects often contain: Ordered: "item..." and N more items
  const items = [];
  const m = subject.match(/Ordered:\s*"([^"]+)"/i);
  if(m) items.push({ name: m[1].trim() });
  // Try to find additional items in body (very best-effort)
  // Look for lines like: "Item: ..." or bullet-ish lines.
  if(textPlain){
    const lines = textPlain.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    for(const l of lines){
      if(l.length < 6) continue;
      if(/^(ordered|hello|hi|thanks|delivery|total|order\s*#)/i.test(l)) continue;
      if(l.includes('amazon')) continue;
      if(l.match(/quantity\b/i)) continue;
      // keep a small set
      if(items.length >= 6) break;
      // crude heuristic: product-y lines with letters
      if(/[a-zA-Z]/.test(l) && l.length <= 80){
        // avoid duplicates
        if(!items.some(x => x.name.toLowerCase() === l.toLowerCase())) items.push({ name: l });
      }
    }
  }
  return items;
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

async function main(){
  const { baseDir, label, max } = parseArgs(process.argv);
  const authClient = await auth(baseDir);
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const lbl = (labelsRes.data.labels || []).find(l => l.name === label);
  if(!lbl) throw new Error(`Label '${label}' not found`);

  const listRes = await gmail.users.messages.list({ userId: 'me', labelIds: [lbl.id], maxResults: max });
  const msgs = listRes.data.messages || [];

  const orders = [];

  for(const m of msgs){
    const full = await gmail.users.messages.get({ userId:'me', id:m.id, format:'full' });
    const h = full.data.payload?.headers || [];
    const from = header(h,'From');
    const subject = header(h,'Subject');
    const date = header(h,'Date');

    const parts = collectTextParts(full.data.payload);
    const textPlain = parts.find(p=>p.mimeType==='text/plain')?.text || '';
    const textHtml = parts.find(p=>p.mimeType==='text/html')?.text || '';
    const bodyText = textPlain || stripHtml(textHtml);

    const merchant = identifyMerchant(from, subject);

    let items = [];
    if(merchant === 'AMAZON') items = parseAmazonItems(subject, textPlain);

    // Swiggy/Zomato: keep as a single "order" record for now; item parsing later.

    orders.push({
      messageId: full.data.id,
      threadId: full.data.threadId,
      internalDateMs: Number(full.data.internalDate || 0),
      from,
      subject,
      date,
      merchant,
      items,
      snippet: full.data.snippet,
      // keep small body preview for debugging (first 400 chars)
      bodyPreview: bodyText.slice(0, 400)
    });
  }

  const outPath = path.join(baseDir,'orders_unmatched.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), label, toleranceInr: 10, orders }, null, 2) + '\n','utf8');

  console.log(JSON.stringify({ ok:true, count: orders.length, saved: outPath }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
