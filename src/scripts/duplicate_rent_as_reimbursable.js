#!/usr/bin/env node
/*
Duplicate each HOME_RENT expense row as a reimbursable "paid for others" row.

Creates ONE additional transaction per rent transaction:
- same date, amount, source, location, merchant_code/category/subcategory
- tags += reimbursable,for_others
- reimb_status = expected
- notes += " | reimbursable (rent)"
- linked_txn_id points to original

Usage:
  node src/scripts/duplicate_rent_as_reimbursable.js --base-dir /home/molt/HisabKitab [--dry-run]

Backups: baseDir/backups/dup_rent_reimb_<ts>/
*/

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

function getArg(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}
function pad2(n){return String(n).padStart(2,'0');}
function ts(){
  const d=new Date();
  return d.getUTCFullYear()+pad2(d.getUTCMonth()+1)+pad2(d.getUTCDate())+'T'+pad2(d.getUTCHours())+pad2(d.getUTCMinutes())+pad2(d.getUTCSeconds())+'Z';
}
function listHK(baseDir){
  return fs.readdirSync(baseDir)
    .filter(f=>/^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f))
    .map(f=>path.join(baseDir,f));
}
function backupFiles(dir, files){
  fs.mkdirSync(dir,{recursive:true});
  for(const fp of files){
    if(!fs.existsSync(fp)) continue;
    fs.copyFileSync(fp, path.join(dir, path.basename(fp)));
  }
}

function parseTagsCsv(tags){
  return String(tags||'').split(',').map(s=>s.trim()).filter(Boolean);
}
function uniq(xs){return Array.from(new Set(xs));}

function maxSeqByDateInWorkbook(filePath, dates){
  const wb=XLSX.readFile(filePath);
  const max=new Map(dates.map(d=>[d,-1]));
  for(const sn of wb.SheetNames){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''});
    for(const r of rows){
      const id=String(r.txn_id||'').trim();
      if(!id) continue;
      for(const d of dates){
        if(!id.startsWith(`hisab_${d}_`)) continue;
        const m=id.match(/_(\d{5})$/);
        if(!m) continue;
        const n=Number(m[1]);
        if(Number.isFinite(n) && n>(max.get(d)??-1)) max.set(d,n);
      }
    }
  }
  return max;
}

function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'/home/molt/HisabKitab');
  const dryRun=args.includes('--dry-run');

  const hkFiles=listHK(baseDir);
  const stamp=ts();
  const backupDir=path.join(baseDir,'backups',`dup_rent_reimb_${stamp}`);
  if(!dryRun) backupFiles(backupDir, hkFiles);

  let rowsAdded=0;
  let rentFound=0;
  const touched=[];

  for(const fp of hkFiles){
    const wb=XLSX.readFile(fp);

    // Find rent rows and group by sheet
    const addBySheet=new Map();
    const datesInThisBook=new Set();

    for(const sn of wb.SheetNames){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''});
      if(!rows.length) continue;

      for(const r of rows){
        if(String(r.subcategory||'').trim()!=='HOME_RENT') continue;
        if(String(r.type||'').toUpperCase()!=='EXPENSE') continue;

        const tags=parseTagsCsv(r.tags);
        // avoid duplicating if already has reimbursable+for_others and linked_txn_id
        if(tags.includes('reimbursable') && tags.includes('for_others')) continue;

        rentFound++;
        const date=String(r.date||'').trim();
        if(date) datesInThisBook.add(date);
        if(!addBySheet.has(sn)) addBySheet.set(sn, []);
        addBySheet.get(sn).push(r);
      }
    }

    if(addBySheet.size===0) continue;

    // Build max seq per date for this workbook
    const maxByDate=maxSeqByDateInWorkbook(fp, Array.from(datesInThisBook));

    let wbChanged=false;
    for(const [sn, rentRows] of addBySheet.entries()){
      const ws=wb.Sheets[sn];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length) continue;

      for(const orig of rentRows){
        const date=String(orig.date||'').trim();
        const cur=maxByDate.get(date) ?? -1;
        const next=cur+1;
        maxByDate.set(date,next);
        const txn_id=`hisab_${date}_${String(next).padStart(5,'0')}`;

        const tags=uniq(parseTagsCsv(orig.tags).concat(['reimbursable','for_others']));
        const child={
          ...orig,
          txn_id,
          group_id: orig.group_id ? String(orig.group_id) : `dup_${String(orig.txn_id||'')}`,
          tags: tags.join(','),
          reimb_status: 'expected',
          linked_txn_id: String(orig.txn_id||''),
          notes: (String(orig.notes||'') ? String(orig.notes||'') + ' | ' : '') + 'reimbursable (rent)',
          raw_text: String(orig.raw_text||'') ? String(orig.raw_text||'') + ' (for others)' : 'Rent (for others)',
          parse_status: 'dup_reimb',
          parse_error: ''
        };

        rows.push(child);
        rowsAdded++;
        wbChanged=true;
      }

      if(wbChanged){
        const headers=Object.keys(rows[0]||{});
        wb.Sheets[sn]=XLSX.utils.json_to_sheet(rows,{header:headers});
      }
    }

    if(wbChanged){
      touched.push(path.basename(fp));
      if(!dryRun) XLSX.writeFile(wb, fp);
    }
  }

  process.stdout.write(JSON.stringify({ ok:true, dryRun, backupDir: dryRun?null:backupDir, rentFound, rowsAdded, booksTouched:touched.length, touched }, null, 2) + '\n');
}

main();
