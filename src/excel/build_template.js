#!/usr/bin/env node
/* Build an empty, formatted HK Excel template.
 * Usage: node build_template.js --out templates/HK_TEMPLATE.pretty.xlsx
 */

const path = require('path');
const ExcelJS = require('exceljs');

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i === -1 ? null : (args[i+1] ?? null);
  };
  return { outFile: get('--out') };
}

function inrFmt(){
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

function colWidth(key){
  const map = {
    date: 12,
    type: 12,
    amount: 14,
    source: 20,
    location: 14,
    merchant_code: 18,
    category: 18,
    subcategory: 22,
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

async function main(){
  const { outFile } = parseArgs(process.argv);
  if(!outFile){
    console.error('Usage: node build_template.js --out templates/HK_TEMPLATE.pretty.xlsx');
    process.exit(2);
  }

  const headers = [
    'date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error',
    'txn_id','group_id'
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hisab Kitab';
  wb.created = new Date();

  const ws = wb.addWorksheet('Transactions', { properties: { defaultRowHeight: 18 } });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  ws.columns = headers.map(k => ({ header: prettyHeader(k), key: k, width: colWidth(k) }));

  const headerRow = ws.getRow(1);
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

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  // Helpful: format amount column even when empty
  const amtCol = headers.indexOf('amount') + 1;
  if(amtCol > 0){
    for(let r=2; r<=200; r++){
      const c = ws.getRow(r).getCell(amtCol);
      c.numFmt = inrFmt();
    }
  }

  await wb.xlsx.writeFile(path.resolve(outFile));
  process.stdout.write(JSON.stringify({ ok:true, out: path.resolve(outFile) }, null, 2) + '\n');
}

main().catch(e=>{ console.error(e); process.exit(1); });
