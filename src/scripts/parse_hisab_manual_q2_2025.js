#!/usr/bin/env node
/*
Parse Vyom's manual Hisab entries text into normalized JSON rows.
Input: text file with sections: Day (D/M/YY) then multiple lines "amount/- desc (source, notes)".
Outputs:
- <baseDir>/cache/hisab_manual_2025_Q2.json
- <baseDir>/cache/hisab_manual_2025_Q2_report.json (stats + unknown merchants)

Uses refs under <baseDir>/refs.
*/

const fs = require('node:fs');
const path = require('node:path');

function readJson(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}

function pad2(n){return String(n).padStart(2,'0');}

function toIsoDateFromDmy(dmy) {
  // dmy like 1/4/25 or 01/04/25
  const m = String(dmy).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y = 2000 + y;
  if (!(y && mo>=1 && mo<=12 && d>=1 && d<=31)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function parseAmount(s) {
  // handles 24,294/- or 190/ - etc
  const m = String(s).replace(/\s+/g,' ').match(/([0-9][0-9,]*)(?:\.[0-9]{1,2})?\s*\/-?/);
  if (!m) return null;
  return Number(m[1].replace(/,/g,''));
}

function extractParenMeta(raw) {
  const m = raw.match(/\(([^)]*)\)\s*$/);
  if (!m) return { main: raw.trim(), meta: '' };
  return { main: raw.slice(0, m.index).trim(), meta: m[1].trim() };
}

function splitDescMerchant(main) {
  // pattern: "desc; merchant" (semicolon separates)
  const parts = main.split(';').map(x=>x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { desc: parts.slice(0, -1).join('; '), merchantRaw: parts[parts.length-1] };
  }
  return { desc: main.trim(), merchantRaw: '' };
}

function normalizeSource(meta, defaultSource) {
  const m = meta.split(',').map(x=>x.trim()).filter(Boolean);
  for (const tok of m) {
    const t = tok.toLowerCase();
    if (['cash','sbi','hdfc','mk','pp','cc'].includes(t)) return t === 'sbi' ? 'SBI' : t === 'hdfc' ? 'HDFC' : t;
    if (['SBI','HDFC','mk','pp','cc'].includes(tok)) return tok;
  }
  return defaultSource;
}

function hasKeyword(meta, kw) {
  return meta.toLowerCase().includes(kw.toLowerCase());
}

function isTransferLike(text) {
  const t = String(text).toLowerCase();
  return t.includes('credit card payment') || t.includes('credit card bill') || t.includes('added to mobikwik wallet') || t.includes('cash to mobikwik wallet') || t.includes('transfer from') || t.includes('from sbi to mobikwik wallet') || t.includes('sbi to mk') || t.includes('added to indmoney') || t.includes('transfer to') || t.includes('to vidhi') || t.includes('from hdfc to sbi');
}

function merchantCodeFromText(txt, aliases, merchants) {
  const raw = String(txt||'').trim();
  if (!raw) return null;
  // apply alias exact match
  if (aliases[raw] && aliases[raw].kind === 'merchant') return aliases[raw].value;

  const up = raw.toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');

  // heuristic mappings
  const map = {
    'TATA_1MG':'TATA1MG',
    'TATA_1MG_':'TATA1MG',
    '1MG':'TATA1MG',
    'MB':'MUSCLEBLAZE',
    'MCDONALDS':'MCDONALDS',
    'BURGER_KING':'BURGER_KING',
    'BK':'BURGER_KING',
    'ACTIVA_PUC':'ACTIVA_PUC',
    'SONY_LIV':'SONY_LIV',
    'NETFLIX_SUBSCRIPTION':'NETFLIX',
    'NETFLIX':'NETFLIX',
    'GOOGLE_ONE_STORAGE':'GOOGLE_ONE',
    'ZOMATO_GOLD_SUBSCRIPTION':'ZOMATO_GOLD',
    'GAME_PAD':'AMAZON',
    'AMAZON_WALLET':'AMAZON',
  };
  if (map[up]) return map[up];

  // if merchant already known by code, return it
  if (merchants[up]) return up;

  // some merchants are typed in mixed case and correspond to known ones
  const candidates = [up, up.replace(/_+/g,'_')];
  for (const c of candidates) if (merchants[c]) return c;

  return up;
}

function defaultCatSub(merchantCode, merchants) {
  const m = merchants[merchantCode];
  if (m && m.default) return { category: m.default.category, subcategory: m.default.subcategory };
  // heuristics
  if (merchantCode === 'PETROL') return { category: 'TRANSPORT', subcategory: 'TRANSPORT_PETROL' };
  if (merchantCode.includes('RENT')) return { category: 'HOUSING_UTILITIES', subcategory: 'HOME_RENT' };
  if (merchantCode.includes('LAUNDRY')) return { category: 'HOUSING_UTILITIES', subcategory: 'HOME_LAUNDRY' };
  if (merchantCode.includes('WATER') || merchantCode === 'BISLERI') return { category: 'FOOD_DINING', subcategory: 'FOOD_WATER' };
  if (merchantCode.includes('MEDIC') || merchantCode === 'TATA1MG' || merchantCode === 'PHARMEASY') return { category: 'HEALTHCARE', subcategory: 'HEALTH_MEDICINES' };
  if (merchantCode.includes('DOCTOR') || merchantCode.includes('ANURADHA')) return { category: 'HEALTHCARE', subcategory: 'HEALTH_DOCTOR' };
  return { category: 'OTHERS', subcategory: 'OTH_MISC' };
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : (args[i+1] ?? null);
  };

  const baseDir = String(getArg('--base-dir') || '/home/molt/HisabKitab');
  const inFile = String(getArg('--in') || '');
  if (!inFile) throw new Error('missing --in');

  const refsDir = path.join(baseDir, 'refs');
  const aliases = readJson(path.join(refsDir, 'aliases.json'), {});
  const merchants = readJson(path.join(refsDir, 'merchants.json'), {});

  const txt = fs.readFileSync(inFile, 'utf8');
  const lines = txt.split(/\r?\n/).map(l=>l.trim());

  let curDate = null;
  const rows = [];
  const unknownMerchants = new Map();

  for (let li=0; li<lines.length; li++) {
    const line = lines[li];
    if (!line) continue;

    const daym = line.match(/^Day\s*\(([^)]+)\)/i);
    if (daym) {
      curDate = toIsoDateFromDmy(daym[1].trim());
      continue;
    }

    // ignore separators
    if (/^[-—_]{3,}$/.test(line)) continue;

    const amt = parseAmount(line);
    if (!amt || !curDate) continue;

    // remove leading amount chunk
    const rest = line.replace(/^([0-9][0-9,]*)(?:\.[0-9]{1,2})?\s*\/-?\s*/,'').trim();

    const { main: mainText, meta } = extractParenMeta(rest);
    const { desc, merchantRaw } = splitDescMerchant(mainText);

    const source = normalizeSource(meta, 'cash');

    // Determine merchant_code
    let merchantText = merchantRaw || desc; // if no explicit merchant, use desc token
    // special: if desc like "Added to Mobikwik Wallet" treat merchant MOBIKWIK
    if (/mobikwik/i.test(mainText)) merchantText = 'MOBIKWIK';
    if (/indmoney/i.test(mainText)) merchantText = 'INDMONEY';

    const merchant_code = merchantCodeFromText(merchantText, aliases, merchants) || 'UNKNOWN';

    if (!merchants[merchant_code]) {
      // track unknowns except obviously generic categories
      if (!['PETROL','RENT','LAUNDRY','WATER_CAN','HAIRCUT','PARTY','CRICKET','BADMINTON','POOL','PARKING'].includes(merchant_code)) {
        unknownMerchants.set(merchant_code, (unknownMerchants.get(merchant_code) || 0) + 1);
      }
    }

    const type = isTransferLike(mainText) ? 'TRANSFER' : 'EXPENSE';

    // exclusions
    const exclude = hasKeyword(meta, 'not to include') || hasKeyword(meta, 'dont include');

    const { category, subcategory } = defaultCatSub(merchant_code, merchants);

    // refund parsing (simple)
    const refundM = meta.match(/got\s+([0-9,]+)\s+refund/i) || meta.match(/got\s+([0-9,]+)\s+refunded/i) || meta.match(/then\s+got\s+([0-9,]+)\s+refunded/i) || meta.match(/refunded\s*([0-9,]+)/i);
    const refund_amount = refundM ? Number(String(refundM[1]).replace(/,/g,'')) : null;

    const tags = [];
    if (hasKeyword(meta, 'charity')) tags.push('gift');
    if (hasKeyword(meta, 'for vidhi') || hasKeyword(meta, 'for someone else')) tags.push('for_someone_else');
    if (hasKeyword(meta, 'subscription') || /subscription/i.test(mainText)) tags.push('subscription');
    if (hasKeyword(meta, 'recharge') || /recharge/i.test(mainText)) tags.push('recharge');

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
      tags
    });
  }

  const outFp = path.join(baseDir, 'cache', 'hisab_manual_2025_Q2.json');
  fs.mkdirSync(path.dirname(outFp), { recursive: true });
  fs.writeFileSync(outFp, JSON.stringify({ schemaVersion: 1, period: '2025_Q2', rows }, null, 2));

  const report = {
    ok: true,
    period: '2025_Q2',
    totalRows: rows.length,
    excludedRows: rows.filter(r=>r.exclude).length,
    transfers: rows.filter(r=>r.type==='TRANSFER').length,
    expenses: rows.filter(r=>r.type==='EXPENSE').length,
    sources: rows.reduce((acc,r)=>{acc[r.source]=(acc[r.source]||0)+1; return acc;},{}),
    unknownMerchants: Array.from(unknownMerchants.entries()).sort((a,b)=>b[1]-a[1]).slice(0,50)
  };

  const repFp = path.join(baseDir, 'cache', 'hisab_manual_2025_Q2_report.json');
  fs.writeFileSync(repFp, JSON.stringify(report, null, 2));

  process.stdout.write(JSON.stringify({ ok:true, out: outFp, report: repFp, summary: report }, null, 2));
  process.stdout.write('\n');
}

main();
