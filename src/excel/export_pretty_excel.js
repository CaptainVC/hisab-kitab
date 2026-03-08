#!/usr/bin/env node
/* Export a clean, professional-looking Excel from a Hisab Kitab workbook.
 * - Reorders columns (txn_id, group_id at end)
 * - Light color theme + borders + zebra striping
 * - Amount formatted as INR currency
 * - Replaces source/location codes with display names (from refs)
 * - NO extra helper columns
 *
 * Usage: node export_pretty_excel.js --in <xlsx> --out <xlsx> [--base-dir ~/HisabKitab]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function readJson(fp, fallback){
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fallback; }
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return {
    inFile: get('--in'),
    outFile: get('--out'),
    baseDir: get('--base-dir') || '~/HisabKitab'
  };
}

function loadRefs(baseDir){
  const refsDir = path.join(baseDir,'refs');
  return {
    sources: readJson(path.join(refsDir,'sources.json'), {}),
    locations: readJson(path.join(refsDir,'locations.json'), {}),
    merchants: readJson(path.join(refsDir,'merchants.json'), {}),
    categories: readJson(path.join(refsDir,'categories.json'), {}),
    subcategories: readJson(path.join(refsDir,'subcategories.json'), {})
  };
}

function inrFmt(){
  // Excel number format with INR symbol; shows 2 decimals.
  return '₹#,##0.00';
}

function prettyHeader(s){
  return String(s)
    .replace(/_/g,' ')
    .replace(/\btxn\b/i,'Transaction')
    .replace(/\bsubcategories\b/i,'Subcategories')
    .replace(/\bsubcategory\b/i,'Subcategory')
    .replace(/\bmerchant\b/i,'Merchant')
    .replace(/\bid\b/i,'ID')
    .replace(/\bmk\b/g,'Mobikwik')
    .replace(/\bcc\b/g,'Credit Card')
    .replace(/\bpp\b/g,'PhonePe')
    .replace(/\bsbi\b/i,'SBI')
    .replace(/\bhdfc\b/i,'HDFC')
    .replace(/\braw\b/i,'Raw')
    .replace(/\btext\b/i,'Text')
    .replace(/\bparse\b/i,'Parse')
    .replace(/\bgroup\b/i,'Group')
    .replace(/\bdate\b/i,'Date')
    .replace(/\btype\b/i,'Type')
    .replace(/\bamount\b/i,'Amount')
    .replace(/\bsource\b/i,'Source')
    .replace(/\blocation\b/i,'Location')
    .replace(/\bcategory\b/i,'Category')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function reorderColumns(headers){
  // Move IDs and less-used columns to the far right.
  // Order at end: txn_id, group_id, tags, beneficiary, reimb_status, counterparty, linked_txn_id
  const h = headers.slice();
  const pull = (name) => {
    const i = h.indexOf(name);
    if(i!==-1){
      h.splice(i,1);
      h.push(name);
    }
  };

  // Put IDs last
  pull('txn_id');
  pull('group_id');

  // Put these after group_id (i.e., also at the far right)
  pull('tags');
  pull('beneficiary');
  pull('reimb_status');
  pull('counterparty');
  pull('linked_txn_id');

  return h;
}

function colWidth(key){
  const map = {
    date: 12,
    type: 12,
    amount: 14,
    source: 20,
    location: 14,
    merchant_code: 16,
    category: 14,
    subcategory: 20,
    tags: 22,
    notes: 40,
    raw_text: 52,
    beneficiary: 18,
    counterparty: 18,
    reimb_status: 14,
    linked_txn_id: 22,
    parse_status: 12,
    parse_error: 26,
    txn_id: 24,
    group_id: 18
  };
  return map[key] || 16;
}

function prettyTag(t){
  return String(t || '')
    .trim()
    .replace(/_/g, ' ')
    .toLowerCase();
}

function normalizeValue(key, val, refs){
  if(val == null) return '';
  if(key === 'source'){
    const code = String(val);
    return refs.sources?.[code]?.display || val;
  }
  if(key === 'location'){
    const code = String(val);
    return refs.locations?.[code]?.name || val;
  }
  if(key === 'merchant_code'){
    const code = String(val);
    return refs.merchants?.[code]?.name || val;
  }
  if(key === 'category'){
    const code = String(val);
    return refs.categories?.[code]?.name || val;
  }
  if(key === 'subcategory'){
    const code = String(val);
    return refs.subcategories?.[code]?.name || val;
  }
  if(key === 'tags'){
    // keep underlying tags machine-friendly in the source data; render friendly in Excel
    const parts = String(val).split(',').map(s=>s.trim()).filter(Boolean);
    return parts.map(prettyTag).join(', ');
  }
  return val;
}

(async function main(){
  const { inFile, outFile, baseDir } = parseArgs(process.argv);
  if(!inFile || !outFile){
    console.error('Usage: node export_pretty_excel.js --in <xlsx> --out <xlsx> [--base-dir ~/HisabKitab]');
    process.exit(2);
  }

  const base = expandHome(baseDir);
  const refs = loadRefs(base);

  const input = expandHome(inFile);
  const output = expandHome(outFile);

  // Read rows using xlsx (robust)
  const wb = XLSX.readFile(input);
  const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const ordered = reorderColumns(headers);

  const outWb = new ExcelJS.Workbook();
  outWb.creator = 'Hisab Kitab';
  outWb.created = new Date();
  const outWs = outWb.addWorksheet('Transactions', { properties: { defaultRowHeight: 18 } });
  outWs.views = [{ state: 'frozen', ySplit: 1 }];

  // Columns
  outWs.columns = ordered.map(k => ({ header: prettyHeader(k), key: k, width: colWidth(k) }));

  // Header style (light)
  const headerRow = outWs.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF0B1020' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0FF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB6C2D6' } },
      left: { style: 'thin', color: { argb: 'FFB6C2D6' } },
      bottom: { style: 'medium', color: { argb: 'FF90A4C0' } },
      right: { style: 'thin', color: { argb: 'FFB6C2D6' } }
    };
  });

  // Add rows
  for (const r of rows) {
    const obj = {};
    for (const k of ordered) obj[k] = normalizeValue(k, r[k], refs);
    outWs.addRow(obj);
  }

  // Autofilter
  outWs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ordered.length }
  };

  // Hide low-signal columns by default (user can unhide in Excel)
  const hideKeys = new Set(['tags','beneficiary','reimb_status','counterparty','linked_txn_id']);
  for (const k of ordered) {
    if (hideKeys.has(k)) {
      const col = outWs.getColumn(k);
      if (col) col.hidden = true;
    }
  }

  // Cell styling + color coding
  const idx = Object.fromEntries(ordered.map((k,i)=>[k,i+1]));
  const amtCol = idx['amount'];
  const typeCol = idx['type'];

  for (let r = 2; r <= outWs.rowCount; r++) {
    const row = outWs.getRow(r);
    const zebra = (r % 2 === 0);

    const type = String(row.getCell(typeCol)?.value || '').toUpperCase();

    // base fill
    const baseFill = zebra ? 'FFFFFFFF' : 'FFF7FAFF';

    row.eachCell((cell, colNumber) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseFill } };
      cell.font = { color: { argb: 'FF0B1020' } };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE1E8F5' } }
      };
      cell.alignment = { vertical: 'top', wrapText: true };
    });

    // Type pill-ish color
    if (typeCol) {
      const c = row.getCell(typeCol);
      const colors = {
        EXPENSE: { fill:'FFFFE8E8', font:'FF991B1B' },
        INCOME: { fill:'FFE9FBEF', font:'FF166534' },
        TRANSFER: { fill:'FFF3E8FF', font:'FF6D28D9' },
        ADJUSTMENT: { fill:'FFFFF7D6', font:'FF92400E' }
      };
      const cc = colors[type] || { fill:'FFEAF0FF', font:'FF0B1020' };
      c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: cc.fill } };
      c.font = { bold: true, color: { argb: cc.font } };
      c.alignment = { vertical:'middle', horizontal:'center' };
      c.border = {
        top: { style:'thin', color:{ argb:'FFB6C2D6' } },
        left: { style:'thin', color:{ argb:'FFB6C2D6' } },
        bottom: { style:'thin', color:{ argb:'FFB6C2D6' } },
        right: { style:'thin', color:{ argb:'FFB6C2D6' } }
      };
    }

    // Amount formatting + emphasis
    if (amtCol) {
      const c = row.getCell(amtCol);
      const num = Number(c.value);
      if (Number.isFinite(num)) {
        c.value = num;
        c.numFmt = inrFmt();
      }
      c.alignment = { vertical:'top', horizontal:'right' };
      c.font = { bold: true, color: { argb: 'FF0B1020' } };
    }

    row.commit();
  }

  // Save
  await outWb.xlsx.writeFile(output);

  // Verify we can read it back (basic sanity)
  const verifyWb = XLSX.readFile(output);
  if (!verifyWb.SheetNames || verifyWb.SheetNames.length === 0) {
    throw new Error('Verification failed: no sheets');
  }

  process.stdout.write(JSON.stringify({ ok:true, in: input, out: output, rows: rows.length }, null, 2) + '\n');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
