#!/usr/bin/env node
/* Nightly Hisab Kitab pipeline:
 * - Auto-log high-confidence mail transactions into Excel
 * - Parse /hisab daily entries and log unmatched entries
 * - Flag issues by section
 * - Output plain-text report + JSON
 *
 * Usage:
 *   node src/pipeline/nightly_pipeline.js --base-dir ~/HisabKitab --from 2026-01-12 --to 2026-02-01 --hisab /path/to/hisab.txt
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const { DateTime } = require('luxon');
const { nanoid } = require('nanoid');

const IST = 'Asia/Kolkata';

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function readJsonSafe(fp, fallback){
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fallback; }
}

function writeJson(fp, obj){
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i === -1 ? null : (args[i+1] || null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    from: get('--from'),
    to: get('--to'),
    hisabFile: expandHome(get('--hisab') || '')
  };
}

function weekOfMonth(dt, weekStart = 1){
  const first = dt.startOf('month');
  const offset = (first.weekday - weekStart + 7) % 7;
  return Math.floor((dt.day + offset - 1) / 7) + 1;
}

function loadRefs(baseDir){
  const refsDir = path.join(baseDir, 'refs');
  const r = (f, fb) => readJsonSafe(path.join(refsDir, f), fb);
  return {
    sources: r('sources.json', {}),
    merchants: r('merchants.json', {}),
    mappings: r('mappings.json', {}),
    locations: r('locations.json', { BENGALURU: { name: 'Bengaluru', default: true } })
  };
}

function normalizeMerchantCode(s){
  if(!s) return '';
  const cleaned = String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g,'');
  return cleaned;
}

function mapSource(paymentSource){
  const s = String(paymentSource || '').toUpperCase();
  if(s.includes('HDFC')) return 'cc';
  if(s.includes('MOBIKWIK')) return 'mk';
  if(s.includes('SBI')) return 'SBI';
  if(s.includes('HDFC_INSTA_ALERT')) return 'cc';
  return 'cash';
}

function applyMerchantMappings(row, refs){
  const fromMerch = row.merchant_code && refs.merchants?.[row.merchant_code]?.default;
  const fromLegacy = row.merchant_code && refs.mappings?.[row.merchant_code];
  const m = fromMerch || fromLegacy;
  if(!m) return row;
  if(!row.category && m.category) row.category = m.category;
  if(!row.subcategory && m.subcategory) row.subcategory = m.subcategory;
  if((!row.tags || row.tags === '') && m.tags){
    row.tags = Array.isArray(m.tags) ? m.tags.join(',') : String(m.tags);
  }
  return row;
}

function isGenericMerchant(code){
  const g = ['DEBITED_VIA_CREDIT','ALERT','UNKNOWN','MOBIKWIK','WALLET_DEBIT'];
  return g.includes(String(code||'').toUpperCase());
}

function highConfidence(payment, row){
  const conf = Number(payment.confidence || 0);
  if(conf < 0.8) return false;
  if(!row.merchant_code || isGenericMerchant(row.merchant_code)) return false;
  if(!row.category || !row.subcategory) return false;
  if(!row.source) return false;
  if(!row.location) return false;
  if(Number(row.amount || 0) <= 0) return false;
  return true;
}

function ensureWorkbook(filePath, headers){
  if(fs.existsSync(filePath)) return XLSX.readFile(filePath);
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  return wb;
}

function appendRowsToWorkbook(wb, rows, headers){
  const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
  const existing = XLSX.utils.sheet_to_json(ws, { header: headers, range: 1, defval: '' });
  const combined = existing.concat(rows.map(r => {
    const o = {}; for(const h of headers) o[h] = r[h] ?? ''; return o;
  }));
  const newWs = XLSX.utils.json_to_sheet(combined, { header: headers });
  wb.Sheets['Transactions'] = newWs;
  if(!wb.SheetNames.includes('Transactions')) wb.SheetNames.unshift('Transactions');
}

function loadExcelIndex(baseDir, fromDate, toDate){
  const files = fs.readdirSync(baseDir).filter(f => /^HK_\d{4}-\d{2}-Week\d+\.xlsx$/.test(f));
  const index = [];
  for(const f of files){
    const wb = XLSX.readFile(path.join(baseDir, f));
    const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    for(const r of rows){
      if(!r.date) continue;
      const dt = DateTime.fromISO(r.date, { zone: IST });
      if(!dt.isValid) continue;
      if(dt < fromDate || dt > toDate) continue;
      index.push({ ...r, _file: f });
    }
  }
  return index;
}

function paymentToRow(payment, refs){
  const dt = DateTime.fromMillis(Number(payment.internalDateMs || 0), { zone: IST });
  const date = dt.isValid ? dt.toISODate() : DateTime.now().setZone(IST).toISODate();
  const merchantRaw = payment.merchant || payment.merchantHint || '';
  const merchant_code = normalizeMerchantCode(merchantRaw);
  const row = {
    txn_id: nanoid(),
    group_id: '',
    date,
    type: (String(payment.direction||'').toUpperCase() === 'CREDIT') ? 'INCOME' : 'EXPENSE',
    amount: Number(payment.amount || 0),
    source: mapSource(payment.source),
    location: 'BENGALURU',
    merchant_code,
    category: '',
    subcategory: '',
    tags: '',
    beneficiary: '',
    reimb_status: '',
    counterparty: '',
    linked_txn_id: '',
    notes: '',
    raw_text: payment.subject || payment.raw || '',
    parse_status: payment.parse_status || 'ok',
    parse_error: ''
  };
  applyMerchantMappings(row, refs);
  return row;
}

function matchEntry(a, b, tol=2){
  if(!a || !b) return false;
  const amtOk = Math.abs(Number(a.amount||0) - Number(b.amount||0)) <= tol;
  const dateOk = a.date === b.date;
  const merchOk = (a.merchant_code && b.merchant_code) ? a.merchant_code === b.merchant_code : false;
  return amtOk && dateOk && merchOk;
}

function parseHisabEntries(baseDir, fromDate, toDate){
  const dir = path.join(baseDir, 'hisab_entries');
  if(!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const out = [];
  for(const f of files){
    const dt = DateTime.fromISO(f.replace('.json',''), { zone: IST });
    if(!dt.isValid || dt < fromDate || dt > toDate) continue;
    const doc = readJsonSafe(path.join(dir, f), { entries: [] });
    for(const e of (doc.entries || [])) out.push(e);
  }
  return out;
}

function ensurePendingDir(baseDir){
  const dir = path.join(baseDir, 'pending');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function main(){
  const { baseDir, from, to } = parseArgs(process.argv);
  if(!from || !to){
    console.error('Usage: node nightly_pipeline.js --from YYYY-MM-DD --to YYYY-MM-DD [--base-dir ~/HisabKitab]');
    process.exit(2);
  }

  const refs = loadRefs(baseDir);
  const fromDate = DateTime.fromISO(from, { zone: IST }).startOf('day');
  const toDate = DateTime.fromISO(to, { zone: IST }).endOf('day');

  // Load payments
  const paymentsDoc = readJsonSafe(path.join(baseDir, 'payments_parsed.json'), { payments: [] });
  const payments = (paymentsDoc.payments || []).filter(p => {
    const ms = Number(p.internalDateMs || 0);
    return ms >= fromDate.toMillis() && ms <= toDate.toMillis();
  });

  const headers = [
    'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error'
  ];

  const excelIndex = loadExcelIndex(baseDir, fromDate, toDate);
  const pendingDir = ensurePendingDir(baseDir);
  const pendingMail = [];

  // Auto-log high confidence payments
  const autoLogged = [];
  for(const p of payments){
    const row = paymentToRow(p, refs);
    const already = excelIndex.find(r => matchEntry(r, row, 2));
    if(already) continue;
    if(highConfidence(p, row)){
      const dt = DateTime.fromISO(row.date, { zone: IST });
      const wom = weekOfMonth(dt, 1);
      const excelName = `HK_${dt.toFormat('yyyy-LL')}-Week${wom}.xlsx`;
      const excelPath = path.join(baseDir, excelName);
      const wb = ensureWorkbook(excelPath, headers);
      appendRowsToWorkbook(wb, [row], headers);
      XLSX.writeFile(wb, excelPath);
      autoLogged.push(row);
    } else {
      const reason = [];
      if(!row.merchant_code || isGenericMerchant(row.merchant_code)) reason.push('missing_merchant');
      if(!row.category || !row.subcategory) reason.push('missing_category');
      if(Number(row.amount||0) <= 0) reason.push('invalid_amount');
      if(Number(p.confidence||0) < 0.8) reason.push('low_confidence');
      pendingMail.push({ ...row, _payment: p, reason: reason.join(',') });
    }
  }

  writeJson(path.join(pendingDir, 'pending_mail.json'), { ok:true, count: pendingMail.length, items: pendingMail });

  // Reconcile with hisab entries (already parsed)
  const hisabEntries = parseHisabEntries(baseDir, fromDate, toDate);

  const flags = {
    'hisab-categorization-issue': [],
    'hisab-mail-mismatch': [],
    'mail-logged-entry-not-found-in-hisab': [],
    'mail-extraction-issue': []
  };

  // Build excel index again after auto-log
  const excelIndex2 = loadExcelIndex(baseDir, fromDate, toDate);

  // Match hisab to excel
  for(const h of hisabEntries){
    const hDate = h.date || '';
    const hMerch = h.merchant_hint || '';
    const hAmt = Number(h.amount||0);

    const match = excelIndex2.find(r => {
      const amtOk = Math.abs(Number(r.amount||0) - hAmt) <= 2;
      const dateOk = r.date === hDate;
      const merchOk = hMerch && r.merchant_code && String(r.merchant_code).toUpperCase() === String(hMerch).toUpperCase();
      return amtOk && dateOk && (merchOk || !hMerch);
    });

    if(!match){
      // categorize and add to excel if possible
      const row = {
        txn_id: nanoid(),
        group_id: '',
        date: hDate,
        type: /received\s+from/i.test(h.raw || '') ? 'INCOME' : 'EXPENSE',
        amount: hAmt,
        source: h.source_hint || 'cash',
        location: 'BENGALURU',
        merchant_code: normalizeMerchantCode(h.merchant_hint || ''),
        category: '',
        subcategory: '',
        tags: '',
        beneficiary: '',
        reimb_status: '',
        counterparty: '',
        linked_txn_id: '',
        notes: h.desc || h.raw || '',
        raw_text: h.raw || '',
        parse_status: 'ok',
        parse_error: ''
      };
      applyMerchantMappings(row, refs);

      if(!row.category || !row.subcategory){
        flags['hisab-categorization-issue'].push({ amount: hAmt, date: hDate, raw: h.raw });
      } else {
        const dt = DateTime.fromISO(row.date, { zone: IST });
        const wom = weekOfMonth(dt, 1);
        const excelName = `HK_${dt.toFormat('yyyy-LL')}-Week${wom}.xlsx`;
        const excelPath = path.join(baseDir, excelName);
        const wb = ensureWorkbook(excelPath, headers);
        appendRowsToWorkbook(wb, [row], headers);
        XLSX.writeFile(wb, excelPath);
      }

      // if we couldn't match to mail, flag
      flags['hisab-mail-mismatch'].push({ amount: hAmt, date: hDate, raw: h.raw });
    }
  }

  // Mail entries logged in excel but not in hisab
  for(const r of excelIndex2){
    const found = hisabEntries.find(h => {
      const amtOk = Math.abs(Number(r.amount||0) - Number(h.amount||0)) <= 2;
      const dateOk = r.date === h.date;
      return amtOk && dateOk;
    });
    if(!found){
      flags['mail-logged-entry-not-found-in-hisab'].push({ amount: r.amount, date: r.date, merchant: r.merchant_code, source: r.source });
    }
  }

  // Mail extraction issues: pending mail items
  for(const p of pendingMail){
    flags['mail-extraction-issue'].push({ amount: p.amount, date: p.date, merchant: p.merchant_code || '(unknown)', reason: p.reason });
  }

  const report = {
    ok: true,
    range: { from, to },
    autoLogged: autoLogged.length,
    pendingMail: pendingMail.length,
    flags
  };

  const outJson = path.join(baseDir, 'reconcile', 'nightly_report.json');
  const outTxt = path.join(baseDir, 'reconcile', 'nightly_report.txt');
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  writeJson(outJson, report);

  const lines = [];
  lines.push(`HisabKitab Nightly Report (${from} → ${to})`);
  lines.push(`Auto-logged from mail: ${autoLogged.length}`);
  lines.push(`Pending mail items: ${pendingMail.length}`);
  lines.push('');

  for(const [key, items] of Object.entries(flags)){
    lines.push(`${key}:`);
    for(const it of items.slice(0, 200)){
      const desc = it.raw || it.merchant || '';
      lines.push(`- ₹${it.amount} ${it.date} ${desc}`);
    }
    lines.push('');
  }

  fs.writeFileSync(outTxt, lines.join('\n') + '\n', 'utf8');

  process.stdout.write(JSON.stringify({ ok:true, report: outJson, reportText: outTxt, ...report }, null, 2) + '\n');
}

main();
