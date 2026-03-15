#!/usr/bin/env node
/*
Parse multiple manual Hisab entry files into a single normalized dataset.

Input files contain sections like:
  Day (1/4/25)
  379/- WWE Cards; Powerslam TCG (mk)

Outputs:
  <baseDir>/cache/hisab_manual_full.json
  <baseDir>/cache/hisab_manual_full_report.json

Rules:
- Date: DD/MM/YY -> YYYY-MM-DD (IST)
- Source: from parentheses token (mk/pp/cc/SBI/HDFC/cash) else default cash
- Type: EXPENSE by default; detect TRANSFER patterns
- Tags:
  - 'for_someone_else' if meta includes 'for <name>'
  - keep 'subscription'/'recharge'/'gift' tags heuristically
- Category/Subcategory:
  - use merchant defaults from refs/merchants.json when possible
  - else default to OTHERS/OTH_MISC (per user preference)

Note: does NOT touch mail data.
*/

const fs = require('node:fs');
const path = require('node:path');

function readJson(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}

function pad2(n){return String(n).padStart(2,'0');}

function toIsoDateFromDmy(dmy) {
  const m = String(dmy).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y = 2000 + y;
  if (!(y && mo>=1 && mo<=12 && d>=1 && d<=31)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function parseAmount(line) {
  const m = String(line).replace(/\s+/g,' ').match(/([0-9][0-9,]*)(?:\.[0-9]{1,2})?\s*\/-?/);
  if (!m) return null;
  return Number(m[1].replace(/,/g,''));
}

function extractParenMeta(raw) {
  const m = raw.match(/\(([^)]*)\)\s*$/);
  if (!m) return { main: raw.trim(), meta: '' };
  return { main: raw.slice(0, m.index).trim(), meta: m[1].trim() };
}

function splitDescMerchant(main) {
  const parts = main.split(';').map(x=>x.trim()).filter(Boolean);
  if (parts.length >= 2) return { desc: parts.slice(0,-1).join('; '), merchantRaw: parts[parts.length-1] };
  return { desc: main.trim(), merchantRaw: '' };
}

function normalizeSource(meta, defaultSource) {
  const toks = String(meta||'').split(',').map(s=>s.trim()).filter(Boolean);
  for (const tok of toks) {
    const t = tok.toLowerCase();
    if (['cash','mk','pp','cc'].includes(t)) return t;
    if (t === 'sbi') return 'SBI';
    if (t === 'hdfc') return 'HDFC';
  }
  return defaultSource;
}

function has(meta, s) {
  return String(meta||'').toLowerCase().includes(String(s).toLowerCase());
}

function isTransferLike(text) {
  const t = String(text).toLowerCase();
  return t.includes('credit card payment') || t.includes('credit card bill') || t.includes('transfer from') || t.includes('from sbi to') || t.includes('to mk') || t.includes('added to mobikwik wallet') || t.includes('cash to mobikwik wallet') || t.includes('added to indmoney') || t.includes('transfer to');
}

function merchantCodeFromText(txt, aliases, merchants) {
  const raw = String(txt||'').trim();
  if (!raw) return null;
  if (aliases[raw] && aliases[raw].kind === 'merchant') return aliases[raw].value;

  const up = raw.toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');

  const map = {
    'BK':'BURGER_KING',
    'DOM':'DOMINOS',
    'MB':'MUSCLEBLAZE',
    'TATA_1MG':'TATA1MG',
    'TATA_1MG_':'TATA1MG',
    '1MG':'TATA1MG'
  };
  if (map[up]) return map[up];

  if (merchants[up]) return up;
  return up;
}

function defaultCatSub(merchantCode, merchants) {
  const m = merchants[merchantCode];
  if (m && m.default) return { category: m.default.category || 'OTHERS', subcategory: m.default.subcategory || 'OTH_MISC' };

  const mc = String(merchantCode||'');
  if (mc.includes('RENT')) return { category: 'HOUSING_UTILITIES', subcategory: 'HOME_RENT' };
  if (mc.includes('LAUNDRY')) return { category: 'HOUSING_UTILITIES', subcategory: 'HOME_LAUNDRY' };
  if (mc.includes('PETROL')) return { category: 'TRANSPORT', subcategory: 'TRANSPORT_PETROL' };
  if (mc.includes('WATER') || mc === 'BISLERI') return { category: 'FOOD_DINING', subcategory: 'FOOD_WATER' };
  if (mc.includes('MEDIC') || mc === 'TATA1MG') return { category: 'HEALTHCARE', subcategory: 'HEALTH_MEDICINES' };
  return { category: 'OTHERS', subcategory: 'OTH_MISC' };
}

function parseOneFile(baseDir, fp, refs) {
  const txt = fs.readFileSync(fp, 'utf8');
  const lines = txt.split(/\r?\n/).map(l=>l.trim());

  let curDate = null;
  const rows = [];

  for (const line0 of lines) {
    const line = line0.trim();
    if (!line) continue;

    const daym = line.match(/^Day\s*\(([^)]+)\)/i);
    if (daym) {
      curDate = toIsoDateFromDmy(daym[1].trim());
      continue;
    }
    if (/^[-—_]{3,}$/.test(line)) continue;

    const amt = parseAmount(line);
    if (!amt || !curDate) continue;

    const rest = line.replace(/^([0-9][0-9,]*)(?:\.[0-9]{1,2})?\s*\/-?\s*/,'').trim();
    const { main: mainText, meta } = extractParenMeta(rest);
    const { desc, merchantRaw } = splitDescMerchant(mainText);

    const source = normalizeSource(meta, 'cash');

    // Instamart default mapping
    let merchantHint = merchantRaw || '';
    if (!merchantHint && /instamart/i.test(desc)) merchantHint = 'SWIGGY_INSTAMART';
    if (!merchantHint) merchantHint = desc;

    const merchant_code = merchantCodeFromText(merchantHint, refs.aliases, refs.merchants) || 'UNKNOWN';
    const { category, subcategory } = defaultCatSub(merchant_code, refs.merchants);

    const type = isTransferLike(mainText) ? 'TRANSFER' : 'EXPENSE';

    const exclude = has(meta, 'not to include') || has(meta, "don't include");

    const tags = [];
    if (has(meta, 'for ') || has(meta, 'for_vidhi') || has(meta, 'for vidhi')) tags.push('for_someone_else');
    if (has(meta, 'charity') || /donation/i.test(mainText)) tags.push('gift');
    if (has(meta, 'subscription') || /subscription/i.test(mainText)) tags.push('subscription');
    if (has(meta, 'recharge') || /recharge/i.test(mainText)) tags.push('recharge');

    const refundM = meta.match(/got\s+([0-9,]+)\s+refund/i) || meta.match(/got\s+([0-9,]+)\s+refunded/i) || meta.match(/then\s+got\s+([0-9,]+)\s+refunded/i);
    const refund_amount = refundM ? Number(String(refundM[1]).replace(/,/g,'')) : null;

    rows.push({
      date: curDate,
      amount: amt,
      type,
      source,
      merchant_code,
      merchant_raw: merchantRaw || '',
      raw_text: desc,
      notes: meta,
      category,
      subcategory,
      refund_amount,
      exclude: Boolean(exclude),
      tags,
      _src_file: path.basename(fp)
    });
  }

  return rows;
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : (args[i+1] ?? null);
  };

  const baseDir = String(getArg('--base-dir') || '/home/molt/HisabKitab');
  const outFp = String(getArg('--out') || path.join(baseDir, 'cache', 'hisab_manual_full.json'));
  const outReportFp = String(getArg('--report') || path.join(baseDir, 'cache', 'hisab_manual_full_report.json'));

  const inFiles = [];
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--in') {
      const fp = args[i+1];
      if (fp) inFiles.push(fp);
    }
  }
  if (!inFiles.length) throw new Error('missing --in <file> (repeatable)');

  const refsDir = path.join(baseDir, 'refs');
  const refs = {
    aliases: readJson(path.join(refsDir,'aliases.json'), {}),
    merchants: readJson(path.join(refsDir,'merchants.json'), {})
  };

  let rows = [];
  for (const fp of inFiles) {
    rows = rows.concat(parseOneFile(baseDir, fp, refs));
  }

  rows.sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.raw_text).localeCompare(String(b.raw_text)) || Number(a.amount)-Number(b.amount));

  // basic stats
  const report = {
    ok: true,
    files: inFiles.map(f => path.basename(f)),
    totalRows: rows.length,
    excludedRows: rows.filter(r=>r.exclude).length,
    transfers: rows.filter(r=>String(r.type)==='TRANSFER' && !r.exclude).length,
    expenses: rows.filter(r=>String(r.type)==='EXPENSE' && !r.exclude).length,
    sources: rows.reduce((acc,r)=>{ const s=r.source||'unknown'; acc[s]=(acc[s]||0)+1; return acc; }, {})
  };

  fs.mkdirSync(path.dirname(outFp), { recursive:true });
  fs.writeFileSync(outFp, JSON.stringify({ schemaVersion:1, rows }, null, 2));
  fs.writeFileSync(outReportFp, JSON.stringify(report, null, 2));

  process.stdout.write(JSON.stringify({ ok:true, out: outFp, report: outReportFp, summary: report }, null, 2) + '\n');
}

main();
