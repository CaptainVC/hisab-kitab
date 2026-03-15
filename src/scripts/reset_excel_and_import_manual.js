#!/usr/bin/env node
/*
Wipe ALL HK_YYYY_QN.xlsx workbooks (after backup) and import normalized manual Hisab rows.

Inputs:
- --base-dir /home/molt/HisabKitab
- --manual-json /home/molt/HisabKitab/cache/hisab_manual_full.json
Options:
- --include-transfers (default true)

This does NOT touch mail files.

Process:
1) Backup existing HK_*.xlsx into <baseDir>/backups/full_reset_<timestamp>/
2) Delete HK_*.xlsx
3) Convert manual rows to excel row schema
4) storeAppend into correct quarter/month sheets
*/

const fs = require('node:fs');
const path = require('node:path');

function getArg(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i+1] ?? null);
}

function pad2(n){return String(n).padStart(2,'0');}
function stamp(){
  const d=new Date();
  return d.getUTCFullYear()+pad2(d.getUTCMonth()+1)+pad2(d.getUTCDate())+'T'+pad2(d.getUTCHours())+pad2(d.getUTCMinutes())+pad2(d.getUTCSeconds())+'Z';
}

function readJson(fp){return JSON.parse(fs.readFileSync(fp,'utf8'));}

function listHK(baseDir){
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir).filter(f => /^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f)).map(f => path.join(baseDir,f));
}

function defaultLocation(baseDir){
  try {
    const locs = readJson(path.join(baseDir,'refs','locations.json'));
    for (const [code,v] of Object.entries(locs||{})) if (v && v.default) return code;
  } catch {}
  return 'BENGALURU';
}

function rowsToExcelRows(baseDir, manualRows, opts){
  const loc = defaultLocation(baseDir);
  const out=[];
  let n=0;
  for (const r of manualRows){
    if (!r || r.exclude) continue;
    const type = String(r.type||'EXPENSE').toUpperCase();
    if (type==='TRANSFER' && !opts.includeTransfers) continue;

    const date = String(r.date||'');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const amount = Number(r.amount||0);
    if (!Number.isFinite(amount) || amount===0) continue;

    const merchant_code = String(r.merchant_code||'UNKNOWN');
    const category = String(r.category||'');
    const subcategory = String(r.subcategory||'');
    const source = String(r.source||'cash');
    const tagsCsv = Array.isArray(r.tags) ? r.tags.join(',') : String(r.tags||'');

    out.push({
      txn_id: `hisab_${date}_${String(n).padStart(5,'0')}`,
      group_id: 'manual_full',
      date,
      type,
      amount,
      source,
      location: loc,
      merchant_code,
      category,
      subcategory,
      tags: tagsCsv,
      beneficiary: '',
      reimb_status: '',
      counterparty: '',
      linked_txn_id: '',
      notes: String(r.notes||''),
      raw_text: String(r.raw_text||''),
      parse_status: 'manual_hisab',
      parse_error: '',
      messageId: ''
    });
    n++;
  }
  return out;
}

async function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'');
  const manualJson=String(getArg(args,'--manual-json')||'');
  const includeTransfers = !args.includes('--no-transfers');
  if(!baseDir) throw new Error('missing --base-dir');
  if(!manualJson) throw new Error('missing --manual-json');

  const backupDir = path.join(baseDir,'backups',`full_reset_${stamp()}`);
  fs.mkdirSync(backupDir,{recursive:true});

  const hkFiles=listHK(baseDir);
  for(const fp of hkFiles){
    fs.copyFileSync(fp, path.join(backupDir, path.basename(fp)));
  }
  for(const fp of hkFiles){
    fs.unlinkSync(fp);
  }

  const doc = readJson(manualJson);
  const rows = Array.isArray(doc.rows) ? doc.rows : [];

  const headers = [
    'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error',
    'messageId'
  ];

  const excelRows = rowsToExcelRows(baseDir, rows, { includeTransfers });

  const { storeAppend } = require(path.join(process.cwd(),'src','excel','workbook_store'));
  const outputs = storeAppend({ baseDir, headers, rows: excelRows });

  process.stdout.write(JSON.stringify({ ok:true, backupDir, deleted: hkFiles.length, imported: excelRows.length, outputs }, null, 2) + '\n');
}

main().catch(err=>{ process.stderr.write(String(err?.stack||err?.message||err)+'\n'); process.exit(1); });
