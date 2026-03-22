#!/usr/bin/env node
/*
Set merchant_code=JEETU_POHA_SHOP for rows matching:
- location: BENGALURU (or Bengaluru)
- merchant_code: blank
- category: FOOD_DINING
- subcategory: FOOD_TAKEAWAY
- tags contain: poha

Usage:
  node src/scripts/set_merchant_for_poha_takeaway_blr.js --base-dir /home/molt/HisabKitab [--dry-run]

Backups: baseDir/backups/set_merch_poha_<ts>/
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
function hasTag(tags, t){
  return String(tags||'')
    .split(',')
    .map(s=>s.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(t).toLowerCase());
}

function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'/home/molt/HisabKitab');
  const dryRun=args.includes('--dry-run');

  const hkFiles=listHK(baseDir);
  const stamp=ts();
  const backupDir=path.join(baseDir,'backups',`set_merch_poha_${stamp}`);
  if(!dryRun) backupFiles(backupDir, hkFiles);

  let rowsChanged=0;
  const touched=new Set();

  for(const fp of hkFiles){
    const wb=XLSX.readFile(fp);
    let wbChanged=false;

    for(const sn of wb.SheetNames){
      const ws=wb.Sheets[sn];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length) continue;
      const sample=rows[0]||{};
      const kLoc = Object.prototype.hasOwnProperty.call(sample,'location')?'location':'Location';
      const kMerch = Object.prototype.hasOwnProperty.call(sample,'merchant_code')?'merchant_code':(Object.prototype.hasOwnProperty.call(sample,'Merchant Code')?'Merchant Code':'merchant_code');
      const kCat = Object.prototype.hasOwnProperty.call(sample,'category')?'category':'Category';
      const kSub = Object.prototype.hasOwnProperty.call(sample,'subcategory')?'subcategory':'Subcategory';
      const kTags = Object.prototype.hasOwnProperty.call(sample,'tags')?'tags':'Tags';

      let sheetChanged=false;
      for(const r of rows){
        const loc=String(r[kLoc]||'').trim();
        if(!(loc==='BENGALURU' || loc==='Bengaluru')) continue;
        const mc=String(r[kMerch]||'').trim();
        if(mc) continue;
        if(String(r[kCat]||'').trim()!=='FOOD_DINING') continue;
        if(String(r[kSub]||'').trim()!=='FOOD_TAKEAWAY') continue;
        if(!hasTag(r[kTags],'poha')) continue;

        r[kMerch]='JEETU_POHA_SHOP';
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
      touched.add(path.basename(fp));
      if(!dryRun) XLSX.writeFile(wb, fp);
    }
  }

  process.stdout.write(JSON.stringify({ ok:true, dryRun, backupDir: dryRun?null:backupDir, rowsChanged, booksTouched:touched.size, touched:[...touched].sort() }, null, 2) + '\n');
}

main();
