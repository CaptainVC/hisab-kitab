#!/usr/bin/env node
/*
Move legacy TRANSFER_FOR_OTHERS rows into OTHERS so expense totals don't need special casing.

For any row where subcategory == TRANSFER_FOR_OTHERS:
- type: EXPENSE
- category: OTHERS
- subcategory: OTH_PAID_FOR_OTHERS
- merchant_code: '' (unchanged if already blank)
- ensure tag for_others exists

Usage:
  node move_paid_for_others_to_others.js --base-dir /home/molt/HisabKitab [--dry-run]

Backups: baseDir/backups/move_paid_for_others_<ts>/
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
function splitTags(s){
  return String(s||'')
    .split(',')
    .map(x=>x.trim())
    .filter(Boolean);
}
function joinTags(a){
  return Array.from(new Set(a)).filter(Boolean).join(',');
}

function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'/home/molt/HisabKitab');
  const dryRun=args.includes('--dry-run');

  const files=listHK(baseDir);
  const backupDir=path.join(baseDir,'backups',`move_paid_for_others_${ts()}`);
  if(!dryRun) backupFiles(backupDir, files);

  let rowsChanged=0;
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

      const kType = Object.prototype.hasOwnProperty.call(sample,'type') ? 'type' : 'type';
      const kCat = Object.prototype.hasOwnProperty.call(sample,'category') ? 'category' : 'category';
      const kSub = Object.prototype.hasOwnProperty.call(sample,'subcategory') ? 'subcategory' : 'subcategory';
      const kTags = Object.prototype.hasOwnProperty.call(sample,'tags') ? 'tags' : 'tags';
      const kMerch = Object.prototype.hasOwnProperty.call(sample,'merchant_code') ? 'merchant_code' : 'merchant_code';

      let sheetChanged=false;
      for(const r of rows){
        const sub=String(r[kSub]||'').trim();
        if(sub!=='TRANSFER_FOR_OTHERS') continue;

        const tags=splitTags(r[kTags]);
        if(!tags.includes('for_others')) tags.push('for_others');
        r[kTags]=joinTags(tags);

        r[kType]='EXPENSE';
        r[kCat]='OTHERS';
        r[kSub]='OTH_PAID_FOR_OTHERS';
        // merchant left blank for these bookkeeping rows
        r[kMerch]=String(r[kMerch]||'').trim();

        rowsChanged++;
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

  process.stdout.write(JSON.stringify({ok:true,dryRun,backupDir:dryRun?null:backupDir,rowsChanged,booksTouched,touched},null,2)+'\n');
}

main();
