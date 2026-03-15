#!/usr/bin/env node
/*
Fill missing txn_id fields in HK_*.xlsx.

txn_id format: hisab_YYYY-MM-DD_00000 (sequence per date)

Usage:
  node fill_missing_txn_ids.js --base-dir /home/molt/HisabKitab [--dry-run]

Backups: baseDir/backups/fill_txn_id_<ts>/
*/

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

function getArg(args, name){
  const i=args.indexOf(name);
  return i===-1?null:(args[i+1]??null);
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

function parseSeq(id){
  const m=String(id||'').match(/_(\d{5})$/);
  if(!m) return null;
  return Number(m[1]);
}

function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'/home/molt/HisabKitab');
  const dryRun=args.includes('--dry-run');

  const files=listHK(baseDir);
  const backupDir=path.join(baseDir,'backups',`fill_txn_id_${ts()}`);
  if(!dryRun) backupFiles(backupDir, files);

  let rowsFilled=0;
  let booksTouched=0;
  const touched=[];

  for(const fp of files){
    const wb=XLSX.readFile(fp);
    let wbChanged=false;

    for(const sn of wb.SheetNames){
      const ws=wb.Sheets[sn];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length) continue;
      const sample=rows[0]||{};
      const kId = Object.prototype.hasOwnProperty.call(sample,'txn_id') ? 'txn_id' : 'txn_id';
      const kDate = Object.prototype.hasOwnProperty.call(sample,'date') ? 'date' : 'date';

      // build max seq per date in this sheet
      const maxByDate={};
      for(const r of rows){
        const d=String(r[kDate]||'').trim();
        if(!d) continue;
        const id=String(r[kId]||'').trim();
        if(!id) continue;
        const seq=parseSeq(id);
        if(seq===null) continue;
        maxByDate[d]=Math.max(maxByDate[d]||-1, seq);
      }

      let sheetChanged=false;
      for(const r of rows){
        const d=String(r[kDate]||'').trim();
        if(!d) continue;
        const cur=String(r[kId]||'').trim();
        if(cur) continue;
        const next=(maxByDate[d]??-1)+1;
        maxByDate[d]=next;
        r[kId]=`hisab_${d}_${String(next).padStart(5,'0')}`;
        rowsFilled++;
        sheetChanged=true;
      }

      if(sheetChanged){
        const headers=Object.keys(rows[0]||{});
        wb.Sheets[sn]=XLSX.utils.json_to_sheet(rows,{header:headers});
        wbChanged=true;
      }
    }

    if(wbChanged){
      booksTouched++;
      touched.push(path.basename(fp));
      if(!dryRun) XLSX.writeFile(wb, fp);
    }
  }

  process.stdout.write(JSON.stringify({ok:true,dryRun,backupDir:dryRun?null:backupDir,rowsFilled,booksTouched,touched},null,2)+'\n');
}

main();
