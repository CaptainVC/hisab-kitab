#!/usr/bin/env node
/*
Find Poha-related transactions and standardize:
- Always set category=FOOD_DINING
- Always add tag 'poha'
- If merchant_code is SWIGGY or ZOMATO (or merchant name matches), set subcategory=FOOD_ONLINE_DELIVERY
- Else if no merchant_code, set subcategory=FOOD_TAKEAWAY

Also fixes any rows that already have tag 'poha' but wrong subcategory.

Usage:
  node poha_tag_and_categorize.js --base-dir /home/molt/HisabKitab [--dry-run]

Matching heuristic:
- tag already contains 'poha' OR
- raw_text or notes contains word 'poha'
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
function hasWordPoha(s){
  return /\bpoha\b/i.test(String(s||''));
}

function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'/home/molt/HisabKitab');
  const dryRun=args.includes('--dry-run');

  const hkFiles=listHK(baseDir);
  const stamp=ts();
  const backupDir=path.join(baseDir,'backups',`poha_tag_${stamp}`);
  if(!dryRun) backupFiles(backupDir, hkFiles);

  let rowsMatched=0;
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
      const kCat = Object.prototype.hasOwnProperty.call(sample,'category') ? 'category'
                : Object.prototype.hasOwnProperty.call(sample,'Category') ? 'Category'
                : 'category';
      const kSub = Object.prototype.hasOwnProperty.call(sample,'subcategory') ? 'subcategory'
                : Object.prototype.hasOwnProperty.call(sample,'Subcategory') ? 'Subcategory'
                : 'subcategory';
      const kTags = Object.prototype.hasOwnProperty.call(sample,'tags') ? 'tags'
                 : Object.prototype.hasOwnProperty.call(sample,'Tags') ? 'Tags'
                 : 'tags';
      const kRaw = Object.prototype.hasOwnProperty.call(sample,'raw_text') ? 'raw_text'
                : Object.prototype.hasOwnProperty.call(sample,'Text') ? 'Text'
                : Object.prototype.hasOwnProperty.call(sample,'text') ? 'text'
                : 'raw_text';
      const kNotes = Object.prototype.hasOwnProperty.call(sample,'notes') ? 'notes'
                  : Object.prototype.hasOwnProperty.call(sample,'Notes') ? 'Notes'
                  : 'notes';

      let sheetChanged=false;
      for(const r of rows){
        const tags=splitTags(r[kTags]);
        const raw=String(r[kRaw]||'');
        const notes=String(r[kNotes]||'');
        const matched = tags.includes('poha') || hasWordPoha(raw) || hasWordPoha(notes);
        if(!matched) continue;
        rowsMatched++;

        const mc=String(r[kMerch]||'').trim();
        const mcU=mc.toUpperCase();
        const isOnline = mcU === 'SWIGGY' || mcU === 'ZOMATO' || mcU === 'SWIGGY_FOOD';

        let changed=false;

        // ensure tag
        if(!tags.includes('poha')) { tags.push('poha'); changed=true; }

        // enforce category
        if(String(r[kCat]||'') !== 'FOOD_DINING') { r[kCat]='FOOD_DINING'; changed=true; }

        // enforce subcategory rule
        const wantSub = isOnline ? 'FOOD_ONLINE_DELIVERY' : (!mc ? 'FOOD_TAKEAWAY' : String(r[kSub]||''));
        if(!isOnline && mc) {
          // merchant exists but not swiggy/zomato: leave subcategory as-is
        } else {
          if(String(r[kSub]||'') !== wantSub) { r[kSub]=wantSub; changed=true; }
        }

        if(changed){
          r[kTags]=joinTags(tags);
          rowsChanged++;
          sheetChanged=true;
        }
      }

      if(sheetChanged){
        const headers = Object.keys(rows[0]||{});
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

  process.stdout.write(JSON.stringify({
    ok:true,
    dryRun,
    backupDir: dryRun?null:backupDir,
    rowsMatched,
    rowsChanged,
    booksTouched,
    touched
  },null,2)+'\n');
}

main();
