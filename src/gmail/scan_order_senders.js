#!/usr/bin/env node
/* Scan Gmail for order/receipt emails within a date range and produce a merchant sender report.
 * Goal: find sender email addresses that send order breakdown details (PDF invoices or itemized body).
 *
 * Usage:
 *   node src/gmail/scan_order_senders.js --base-dir ~/HisabKitab \
 *     --after 2024-01-01 --before 2026-02-01 \
 *     --batch 200 --max 5000 \
 *     --out-csv ~/HisabKitab/order_senders_2024-01-01_2026-01-31.csv \
 *     --out-xlsx ~/HisabKitab/order_senders_2024-01-01_2026-01-31.xlsx
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1] ?? null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    after: get('--after') || '2024-01-01',
    before: get('--before') || '2026-02-01',
    batch: Number(get('--batch') || 200),
    max: Number(get('--max') || 0),
    outCsv: expandHome(get('--out-csv') || ''),
    outXlsx: expandHome(get('--out-xlsx') || ''),
    statePath: expandHome(get('--state') || '~/HisabKitab/order_sender_scan_state.json'),
    debug: (get('--debug') || '').toLowerCase() === 'true'
  };
}

function loadJson(fp, fallback){
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fallback; }
}

function saveJson(fp, obj){
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function hdr(headers, name){
  const h = (headers||[]).find(x => String(x.name||'').toLowerCase() === String(name).toLowerCase());
  return h ? String(h.value || '') : '';
}

function parseFrom(from){
  // Examples:
  //   "Swiggy <noreply@swiggy.in>"
  //   "noreply@swiggy.in"
  const s = String(from || '').trim();
  if(!s) return { name: '', email: '' };
  const m = s.match(/^(.*)<([^>]+)>\s*$/);
  if(m) return { name: m[1].trim().replace(/^\"|\"$/g,''), email: m[2].trim().toLowerCase() };
  // sometimes comma separated
  const addr = s.split(',')[0].trim();
  const mm = addr.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return { name: s.replace(mm?.[1]||'', '').replace(/[<>\"]/g,'').trim(), email: (mm?.[1]||'').toLowerCase() };
}

function walkParts(payload, out){
  if(!payload) return;
  const fn = payload.filename || '';
  const mt = String(payload.mimeType || '').toLowerCase();
  const attId = payload.body && payload.body.attachmentId;
  if(attId) out.attachments.push({ filename: fn, mimeType: mt, attachmentId: attId });
  if(payload.body && payload.body.data) out.inline.push({ mimeType: mt, data: payload.body.data });
  for(const p of (payload.parts || [])) walkParts(p, out);
}

function isPdfAttachment(att){
  const mt = String(att.mimeType||'').toLowerCase();
  const fn = String(att.filename||'').toLowerCase();
  return mt === 'application/pdf' || fn.endsWith('.pdf') || fn.includes('.pdf');
}

function decodeBase64Url(s){
  const b64 = String(s||'').replace(/-/g,'+').replace(/_/g,'/');
  return Buffer.from(b64, 'base64');
}

function stripHtml(html){
  return String(html||'')
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

function looksItemized(text){
  const t = String(text||'').toLowerCase();
  if(!t) return false;
  // strong signals
  const strong = [
    'tax invoice',
    'invoice total',
    'invoice value',
    'order summary',
    'item(s)',
    'qty',
    'quantity',
    'subtotal',
    'grand total',
    'net amount',
    'net assessable',
    'hsn',
    'gst',
    'unit price'
  ];
  let hits = 0;
  for(const s of strong){
    if(t.includes(s)) hits++;
  }
  // Require at least 2 signals to avoid false positives
  return hits >= 2;
}

function csvEscape(v){
  const s = String(v ?? '');
  if(/[\n\r\",]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}

async function main(){
  const cfg = parseArgs(process.argv);
  if(!cfg.outCsv && !cfg.outXlsx){
    console.error('Provide --out-csv and/or --out-xlsx');
    process.exit(2);
  }

  const creds = loadJson(path.join(cfg.baseDir,'credentials.json'), null);
  const token = loadJson(path.join(cfg.baseDir,'gmail_token.json'), null);
  if(!creds || !token){
    console.error('Missing Gmail creds/token in ' + cfg.baseDir);
    process.exit(2);
  }
  const c = creds.installed || creds.web;
  const auth = new google.auth.OAuth2(c.client_id, c.client_secret);
  auth.setCredentials(token);
  const gmail = google.gmail({ version:'v1', auth });

  // Resume state
  const state = loadJson(cfg.statePath, { pageToken: null, processed: 0, seen: {} });

  const afterQ = cfg.after.replace(/-/g,'/');
  const beforeQ = cfg.before.replace(/-/g,'/');
  const q = `after:${afterQ} before:${beforeQ}`;

  const agg = new Map();
  // Load any existing agg snapshot from state
  if(state.agg){
    for(const row of state.agg){
      agg.set(row.key, row);
    }
  }

  let pageToken = state.pageToken || null;
  let processed = Number(state.processed || 0);

  while(true){
    if(cfg.max && processed >= cfg.max) break;

    const maxResults = cfg.max ? Math.min(cfg.batch, cfg.max - processed) : cfg.batch;

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults,
      pageToken: pageToken || undefined,
    });

    const msgs = listRes.data.messages || [];
    pageToken = listRes.data.nextPageToken || null;

    if(!msgs.length) break;

    for(const m of msgs){
      // Avoid repeats
      if(state.seen && state.seen[m.id]) continue;

      // Use format=full so we can inspect body + attachments
      const full = await gmail.users.messages.get({ userId:'me', id:m.id, format:'full' });
      const payload = full.data.payload;
      const headers = payload?.headers || [];
      const fromRaw = hdr(headers, 'From');
      const subject = hdr(headers, 'Subject');
      const snippet = String(full.data.snippet || '');

      const { name, email } = parseFrom(fromRaw);
      if(!email){
        state.seen[m.id] = 1;
        processed++;
        continue;
      }

      const parts = { attachments: [], inline: [] };
      walkParts(payload, parts);

      const hasPdf = parts.attachments.some(isPdfAttachment);

      // Extract some body text (prefer text/plain, else html)
      let bodyText = '';
      // walk inline bodies (some messages are singlepart)
      // also scan parts recursively for text/plain and text/html data
      function extractBodies(p){
        if(!p) return;
        const mt = String(p.mimeType||'').toLowerCase();
        const data = p.body && p.body.data;
        if(data && (mt === 'text/plain' || mt === 'text/html')){
          try{
            const buf = decodeBase64Url(data);
            const s = buf.toString('utf8');
            if(mt === 'text/plain') bodyText += '\n' + s;
            else bodyText += '\n' + stripHtml(s);
          }catch{}
        }
        for(const ch of (p.parts||[])) extractBodies(ch);
      }
      extractBodies(payload);

      // Lightweight: use snippet as extra signal
      const itemized = looksItemized(bodyText) || looksItemized(snippet) || looksItemized(subject);

      // We only want order breakdown details, so keep only if pdf OR itemized
      if(hasPdf || itemized){
        const key = email;
        const cur = agg.get(key) || {
          key,
          sender_email: email,
          sender_name: name,
          total_matched: 0,
          pdf_count: 0,
          itemized_count: 0,
          sample_subjects: [],
          sample_from: fromRaw
        };

        cur.total_matched++;
        if(hasPdf) cur.pdf_count++;
        if(itemized) cur.itemized_count++;
        if(subject && cur.sample_subjects.length < 8 && !cur.sample_subjects.includes(subject)) cur.sample_subjects.push(subject);
        if(!cur.sender_name && name) cur.sender_name = name;
        if(!cur.sample_from && fromRaw) cur.sample_from = fromRaw;

        agg.set(key, cur);
      }

      state.seen[m.id] = 1;
      processed++;

      if(cfg.debug && processed % 20 === 0){
        process.stderr.write(`processed=${processed} last=${email} pdf=${hasPdf} itemized=${itemized}\n`);
      }
    }

    // persist state every batch
    state.pageToken = pageToken;
    state.processed = processed;
    state.agg = [...agg.values()];
    saveJson(cfg.statePath, state);

    process.stdout.write(JSON.stringify({ ok:true, processed, unique_senders: agg.size, pageToken: !!pageToken }, null, 2) + '\n');

    if(!pageToken) break;
  }

  // finalize + write outputs
  const rows = [...agg.values()]
    .sort((a,b)=> (b.total_matched - a.total_matched) || a.sender_email.localeCompare(b.sender_email));

  if(cfg.outCsv){
    const header = [
      'sender_email','sender_name','total_matched','pdf_count','itemized_count','sample_subjects','sample_from'
    ];
    const lines = [header.join(',')];
    for(const r of rows){
      lines.push([
        r.sender_email,
        r.sender_name,
        r.total_matched,
        r.pdf_count,
        r.itemized_count,
        (r.sample_subjects||[]).join(' | '),
        r.sample_from
      ].map(csvEscape).join(','));
    }
    fs.writeFileSync(cfg.outCsv, lines.join('\n') + '\n', 'utf8');
  }

  if(cfg.outXlsx){
    // optional dependency in repo
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Hisab Kitab';
    wb.created = new Date();
    const ws = wb.addWorksheet('Order Senders');
    ws.columns = [
      { header: 'Sender Email', key: 'sender_email', width: 32 },
      { header: 'Sender Name', key: 'sender_name', width: 28 },
      { header: 'Total Matched', key: 'total_matched', width: 14 },
      { header: 'PDF Count', key: 'pdf_count', width: 10 },
      { header: 'Itemized Count', key: 'itemized_count', width: 14 },
      { header: 'Sample Subjects', key: 'sample_subjects', width: 80 },
      { header: 'Sample From', key: 'sample_from', width: 48 }
    ];
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for(const r of rows){
      ws.addRow({
        sender_email: r.sender_email,
        sender_name: r.sender_name,
        total_matched: r.total_matched,
        pdf_count: r.pdf_count,
        itemized_count: r.itemized_count,
        sample_subjects: (r.sample_subjects||[]).join(' | '),
        sample_from: r.sample_from
      });
    }
    await wb.xlsx.writeFile(cfg.outXlsx);
  }

  process.stdout.write(JSON.stringify({ ok:true, processed, unique_senders: rows.length, outCsv: cfg.outCsv||null, outXlsx: cfg.outXlsx||null, state: cfg.statePath }, null, 2) + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });
