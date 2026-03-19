#!/usr/bin/env node
/*
One-time Amazon: match Excel transactions to Amazon mail orders (orders_parsed.json) using buffer-days + amount tolerance,
then split matched transactions into item-level child rows.

Uses the same split implementation as the web UI (web/server/dist/scripts/split_txn.js), so it:
- tags original txn with superseded + split_parent
- appends child rows linked to original

Usage:
  node src/scripts/amazon_auto_split_from_mails.js --base-dir /home/molt/HisabKitab [--buffer-days 3] [--tol 2] [--dry-run]

Notes:
- Only processes rows with merchant_code=AMAZON.
- Skips rows already tagged superseded/split_parent.
- Will match either a single order total or a subset of order totals on the same day (or +/-bufferDays) whose sum matches.
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
function readJson(fp, fallback){
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fallback; }
}
function parseTagsCsv(tags){
  return String(tags||'').split(',').map(s=>s.trim()).filter(Boolean);
}
function amtClose(a,b,tol){
  return Math.abs(Number(a)-Number(b))<=tol;
}
function daysBetween(a,b){
  const t0=Date.parse(a+'T00:00:00Z');
  const t1=Date.parse(b+'T00:00:00Z');
  if(!Number.isFinite(t0)||!Number.isFinite(t1)) return null;
  return Math.round((t1-t0)/86400000);
}

function buildAmazonOrdersIndex(baseDir){
  const ordersDoc = readJson(path.join(baseDir,'orders_parsed.json'), { orders: [] });
  const all = Array.isArray(ordersDoc.orders) ? ordersDoc.orders : [];
  const amazon = all
    .filter(o => String(o?.merchant||'').toUpperCase()==='AMAZON')
    .map(o => ({
      messageId: o.messageId || null,
      date: String(o.invoice_date || o.date || '').slice(0,10),
      total: Number(o.total || 0),
      items: Array.isArray(o.items) ? o.items.map(it => ({ name: String(it.name||'').trim(), amount: Number(it.amount||0) })) : []
    }))
    .filter(o => o.date && Number.isFinite(o.total) && o.total>0);

  const byDate = new Map();
  for(const o of amazon){
    if(!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date).push(o);
  }
  return { amazonOrders: amazon, byDate };
}

function pickOrdersForAmount(byDate, dateIso, amt, tol, bufferDays){
  const candidatesByDate=[];
  for(const [d, list] of byDate.entries()){
    const dd=daysBetween(dateIso,d);
    if(dd===null) continue;
    if(Math.abs(dd)>bufferDays) continue;
    candidatesByDate.push({ d, dd, list });
  }

  // 1) single order exact-ish
  for(const {d,dd,list} of candidatesByDate.sort((a,b)=>Math.abs(a.dd)-Math.abs(b.dd))){
    const m=list.find(o=>amtClose(o.total, amt, tol));
    if(m) return { orders:[m], matchedDate:d, dayDelta:dd, mode:'single' };
  }

  // 2) subset sum per date (cap 12)
  let best=null;
  for(const {d,dd,list} of candidatesByDate){
    const arr=list.slice(0,12);
    const n=arr.length;
    for(let mask=1; mask < (1<<n); mask++){
      let sum=0;
      const picked=[];
      for(let i=0;i<n;i++){
        if(mask & (1<<i)) { sum += Number(arr[i].total); picked.push(arr[i]); }
      }
      if(amtClose(sum, amt, tol)){
        const score = picked.length*100 + Math.abs(dd); // fewer orders better, then closer date
        if(!best || score < best.score){
          best={ orders:picked, matchedDate:d, dayDelta:dd, mode:'subset', score };
        }
      }
    }
  }
  return best;
}

function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'/home/molt/HisabKitab');
  const bufferDays=Number(getArg(args,'--buffer-days')||3);
  const tol=Number(getArg(args,'--tol')||2);
  const dryRun=args.includes('--dry-run');

  const hkFiles=listHK(baseDir);
  const stamp=ts();
  const backupDir=path.join(baseDir,'backups',`amazon_split_${stamp}`);
  if(!dryRun){
    fs.mkdirSync(backupDir,{recursive:true});
    for(const fp of hkFiles) fs.copyFileSync(fp, path.join(backupDir, path.basename(fp)));
  }

  const { byDate } = buildAmazonOrdersIndex(baseDir);

  const splitScript = path.join('/home/molt/clawd/hisab-kitab', 'web', 'server', 'dist', 'scripts', 'split_txn.js');
  if(!fs.existsSync(splitScript)) throw new Error('split_txn_script_missing');

  let considered=0, matched=0, splitPlanned=0, splitDone=0, skipped=0, noMatch=0;
  const report=[];

  for(const fp of hkFiles){
    const wb=XLSX.readFile(fp);
    for(const sheetName of wb.SheetNames){
      const ws=wb.Sheets[sheetName];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length) continue;
      const sample=rows[0]||{};
      const kTxn = Object.prototype.hasOwnProperty.call(sample,'txn_id') ? 'txn_id' : 'Transaction ID';
      const kDate = Object.prototype.hasOwnProperty.call(sample,'date') ? 'date' : 'Date';
      const kAmt = Object.prototype.hasOwnProperty.call(sample,'amount') ? 'amount' : 'Amount';
      const kMerch = Object.prototype.hasOwnProperty.call(sample,'merchant_code') ? 'merchant_code' : 'Merchant Code';
      const kTags = Object.prototype.hasOwnProperty.call(sample,'tags') ? 'tags' : 'Tags';

      for(const r of rows){
        const mc=String(r[kMerch]||'').trim().toUpperCase();
        if(mc!=='AMAZON') continue;

        const tags=parseTagsCsv(r[kTags]);
        if(tags.includes('superseded') || tags.includes('split_parent')) { skipped++; continue; }

        const txnId=String(r[kTxn]||'').trim();
        const date=String(r[kDate]||'').trim();
        const amt=Number(r[kAmt]||0);
        if(!txnId || !date || !Number.isFinite(amt) || amt<=0){ skipped++; continue; }

        considered++;

        const picked=pickOrdersForAmount(byDate, date, amt, tol, bufferDays);
        if(!picked || !picked.orders || !picked.orders.length){
          noMatch++;
          if(report.length<200) report.push({ txnId, date, amt, status:'no_match', file:path.basename(fp), sheet:sheetName });
          continue;
        }

        matched++;
        // build item list
        let items=[];
        for(const o of picked.orders){
          const its=(o.items||[]).filter(it=>it && it.name && Number.isFinite(it.amount) && Number(it.amount)>0);
          items=items.concat(its);
        }
        if(!items.length){
          skipped++;
          report.push({ txnId, date, amt, status:'matched_but_no_items', mode:picked.mode, dayDelta:picked.dayDelta });
          continue;
        }

        const splits = items.map(it => ({
          amount: Number(it.amount),
          raw_text: String(it.name).slice(0, 180),
          merchant_code: 'AMAZON'
        }));

        splitPlanned++;
        if(dryRun){
          report.push({ txnId, date, amt, status:'would_split', mode:picked.mode, dayDelta:picked.dayDelta, splits: splits.length, matchedDate: picked.matchedDate });
          continue;
        }

        // write splits file
        const stagingDir = path.join(baseDir,'staging');
        fs.mkdirSync(stagingDir,{recursive:true});
        const splitsFile = path.join(stagingDir, `amazon_splits_${txnId}_${Date.now()}.json`);
        fs.writeFileSync(splitsFile, JSON.stringify(splits,null,2),'utf8');

        // run split script
        const { execFileSync } = require('node:child_process');
        try {
          const out = execFileSync(process.execPath, [splitScript, '--base-dir', baseDir, '--txn-id', txnId, '--splits-file', splitsFile], { cwd: '/home/molt/clawd/hisab-kitab', stdio: ['ignore','pipe','pipe'] });
          splitDone++;
          report.push({ txnId, date, amt, status:'split', mode:picked.mode, dayDelta:picked.dayDelta, splits: splits.length, splitOut: String(out).slice(0,500) });
        } catch (e) {
          report.push({ txnId, date, amt, status:'split_failed', error: String(e?.stderr || e?.message || e) });
        }
      }
    }
  }

  const outFp = path.join(baseDir,'cache',`amazon_split_report_${stamp}.json`);
  fs.mkdirSync(path.dirname(outFp),{recursive:true});
  fs.writeFileSync(outFp, JSON.stringify({
    ok:true,
    dryRun,
    bufferDays,
    tol,
    backupDir: dryRun?null:backupDir,
    considered,
    matched,
    splitPlanned,
    splitDone,
    skipped,
    noMatch,
    report
  },null,2));

  process.stdout.write(JSON.stringify({ ok:true, out: outFp, summary: { dryRun, considered, matched, splitPlanned, splitDone, skipped, noMatch, backupDir: dryRun?null:backupDir } }, null, 2) + '\n');
}

main();
