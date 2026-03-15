#!/usr/bin/env node
/*
Replace merchant_code occurrences in HK_*.xlsx.

Usage:
  node replace_merchant_code.js --base-dir /home/molt/HisabKitab --from WATER_CAN --to BISLERI [--dry-run]

Backups created in baseDir/backups/replace_merchant_<ts>/
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

function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'/home/molt/HisabKitab');
  const from=String(getArg(args,'--from')||'').trim();
  const to=String(getArg(args,'--to')||'').trim();
  const dryRun=args.includes('--dry-run');
  if(!from||!to) throw new Error('--from/--to required');

  const hkFiles=listHK(baseDir);
  const stamp=ts();
  const backupDir=path.join(baseDir,'backups',`replace_merchant_${stamp}`);
  if(!dryRun) backupFiles(backupDir, hkFiles);

  let rowsChanged=0;
  let booksTouched=0;
  const touched=[];

  for(const fp of hkFiles){
    const wb=XLSX.readFile(fp);
    let wbChanged=false;

    for(const sheetName of wb.SheetNames){
      const ws=wb.Sheets[sheetName];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length) continue;
      const sample=rows[0]||{};
      const kMerch = Object.prototype.hasOwnProperty.call(sample,'merchant_code') ? 'merchant_code'
                  : Object.prototype.hasOwnProperty.call(sample,'Merchant') ? 'Merchant'
                  : 'merchant_code';
      let sheetChanged=false;
      for(const r of rows){
        const mc=String(r[kMerch]||'').trim();
        if(mc!==from) continue;
        r[kMerch]=to;
        rowsChanged++;
        sheetChanged=true;
      }
      if(sheetChanged){
        const headers=Object.keys(rows[0]||{});
        wb.Sheets[sheetName]=XLSX.utils.json_to_sheet(rows,{header:headers});
        wbChanged=true;
      }
    }

    if(wbChanged){
      booksTouched++;
      touched.push(path.basename(fp));
      if(!dryRun) XLSX.writeFile(wb, fp);
    }
  }

  process.stdout.write(JSON.stringify({ok:true,dryRun,backupDir:dryRun?null:backupDir,from,to,rowsChanged,booksTouched,touched},null,2)+'\n');
}

main();
