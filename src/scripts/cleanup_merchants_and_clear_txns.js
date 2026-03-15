#!/usr/bin/env node
/*
1) Archives duplicate merchants in baseDir/refs/merchants.json by exact normalized name match.
2) Clears merchant_code in all HK_*.xlsx rows if they reference an archived merchant.

Backups:
- merchants.json -> backups/merchant_cleanup_<ts>/merchants.json
- HK_*.xlsx -> backups/merchant_cleanup_<ts>/*.xlsx

NOTE: Does not delete merchants, only sets archived=true.
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

function normName(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function listHK(baseDir){
  return fs.readdirSync(baseDir).filter(f=>/^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f)).map(f=>path.join(baseDir,f));
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
  const dryRun=args.includes('--dry-run');

  const merchantsFp = path.join(baseDir,'refs','merchants.json');
  const merchants = JSON.parse(fs.readFileSync(merchantsFp,'utf8'));
  const entries = Object.entries(merchants).map(([code,v])=>({code, v, name: (v && v.name) ? v.name : code}));

  // group by normalized name
  const groups=new Map();
  for(const e of entries){
    const k=normName(e.name);
    if(!k) continue;
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(e);
  }

  const emailRulesFp = path.join(baseDir,'refs','email_merchants.json');
  let emailRules={};
  try{ emailRules=JSON.parse(fs.readFileSync(emailRulesFp,'utf8')); }catch{}
  const preferred = new Set(Object.keys(emailRules||{}).map(s=>String(s).toUpperCase()));
  const canonicalPrefer = new Set([
    ...Array.from(preferred),
    'AMAZON','BLINKIT','BURGER_KING','DAILYOBJECTS','DISTRICT','EATCLUB','HOSTINGER','MEESHO','SWIGGY','TACO_BELL','TATA1MG','ZEPTO','ZOMATO','DOMINOS','UBER'
  ]);

  const toArchive=[];
  const keep=[];

  for(const [k, arr] of groups.entries()){
    if(arr.length<=1) continue;
    // choose keep: prefer one that is in email rules.
    // otherwise prefer "non-alias" looking codes (avoid 2-3 letter codes like BK/Dom).
    let winner = arr.find(x=>canonicalPrefer.has(x.code.toUpperCase()));
    if(!winner){
      winner = arr.slice().sort((a,b)=>{
        const aAlias = a.code.length <= 3;
        const bAlias = b.code.length <= 3;
        if (aAlias !== bAlias) return aAlias ? 1 : -1;
        const aUnd = a.code.includes('_');
        const bUnd = b.code.includes('_');
        if (aUnd !== bUnd) return aUnd ? -1 : 1;
        return a.code.length - b.code.length || a.code.localeCompare(b.code);
      })[0];
    }
    keep.push(winner.code);
    for(const e of arr){
      if(e.code===winner.code) continue;
      toArchive.push({code:e.code, group:k, keep:winner.code});
    }
  }

  const stamp = ts();
  const backupDir = path.join(baseDir,'backups',`merchant_cleanup_${stamp}`);

  const hkFiles=listHK(baseDir);

  if(!dryRun){
    backupFiles(backupDir,[merchantsFp,...hkFiles]);
  }

  // apply archive
  let archivedCount=0;
  const archivedCodes=new Set();
  for(const x of toArchive){
    const cur=merchants[x.code]||{};
    if(cur.archived) continue;
    cur.archived=true;
    merchants[x.code]=cur;
    archivedCount++;
    archivedCodes.add(x.code);
  }

  // write merchants
  if(!dryRun){
    fs.writeFileSync(merchantsFp, JSON.stringify(merchants,null,2));
  }

  // clear merchant_code in txns
  let cleared=0;
  let workbooksTouched=0;
  const touched=[];

  for(const fp of hkFiles){
    const wb = XLSX.readFile(fp);
    let wbChanged=false;
    for(const sheetName of wb.SheetNames){
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length) continue;
      const sample=rows[0]||{};
      const kMerch = Object.prototype.hasOwnProperty.call(sample,'merchant_code') ? 'merchant_code' : 'Merchant';
      let sheetChanged=false;
      for(const r of rows){
        const mc=String(r[kMerch]||'').trim();
        if(!mc) continue;
        if(!archivedCodes.has(mc)) continue;
        r[kMerch]='';
        cleared++;
        sheetChanged=true;
      }
      if(sheetChanged){
        const headers = Object.keys(rows[0]||{});
        wb.Sheets[sheetName]=XLSX.utils.json_to_sheet(rows,{header:headers});
        wbChanged=true;
      }
    }
    if(wbChanged){
      workbooksTouched++;
      touched.push(path.basename(fp));
      if(!dryRun) XLSX.writeFile(wb, fp);
    }
  }

  const out={
    ok:true,
    dryRun,
    backupDir: dryRun ? null : backupDir,
    archivedMerchants: archivedCount,
    archivedCodes: Array.from(archivedCodes).sort(),
    clearedMerchantCodesInTxns: cleared,
    workbooksTouched,
    touched
  };

  process.stdout.write(JSON.stringify(out,null,2)+'\n');
}

main();
