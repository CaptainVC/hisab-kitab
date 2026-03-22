#!/usr/bin/env node
/*
One-time: Zomato mail orders audit for current financial year.

- Reads mail orders from: <baseDir>/staging/mail_orders.json
- Reads transactions from quarterly workbooks: <baseDir>/HK_YYYY_QN.xlsx
- Scope: FY (default 2025-04-01..2026-03-31)
- Matches mail orders to txns using bufferDays + amount tolerance.
- Candidates include:
  - merchant_code=ZOMATO
  - OR merchant_code blank + raw_text/notes contain 'zomato'

Usage:
  node src/scripts/zomato_match_fy.js --base-dir /home/molt/HisabKitab \
    [--fy-start 2025-04-01 --fy-end 2026-03-31] \
    [--buffer-days 3] [--tol 10]

Output:
  <baseDir>/cache/zomato_match_report_FY_<fyStart>_<fyEnd>.json
*/

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

function getArg(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}
function readJson(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}
function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8');
}
function listHK(baseDir){
  return fs.readdirSync(baseDir)
    .filter(f=>/^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f))
    .map(f=>path.join(baseDir,f));
}
function parseTags(tags){
  return String(tags||'').split(',').map(s=>s.trim()).filter(Boolean);
}
function hasTag(tags, t){
  return parseTags(tags).map(x=>x.toLowerCase()).includes(String(t).toLowerCase());
}
function daysBetween(a,b){
  const t0 = Date.parse(a + 'T00:00:00Z');
  const t1 = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.round((t1 - t0) / 86400000);
}
function inRange(d, start, end){
  return d >= start && d <= end;
}

function loadMailOrders(baseDir, fyStart, fyEnd){
  const fp = path.join(baseDir, 'staging', 'mail_orders.json');
  const store = readJson(fp, { orders: [] });
  const orders = Array.isArray(store.orders) ? store.orders : [];
  return orders
    .filter(o => String(o?.merchant_code||'').toUpperCase() === 'ZOMATO')
    .map(o => ({
      messageId: String(o.messageId||''),
      date: String(o.date||'').slice(0,10),
      total: Number(o.total||0),
      items: Array.isArray(o.items) ? o.items.map(it => ({ name: String(it.name||it.title||'').trim(), amount: Number(it.amount||0) })) : []
    }))
    .filter(o => o.date && Number.isFinite(o.total) && o.total > 0)
    .filter(o => inRange(o.date, fyStart, fyEnd));
}

function loadTxnCandidates(baseDir, fyStart, fyEnd){
  const files = listHK(baseDir);
  const cand=[];
  const reZ = /\bzomato\b/i;

  for(const fp of files){
    const wb = XLSX.readFile(fp);
    for(const sn of wb.SheetNames){
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
      if(!rows.length) continue;
      for(const r of rows){
        const date = String(r.date||'').slice(0,10);
        if(!date || !inRange(date, fyStart, fyEnd)) continue;

        const tags = String(r.tags||'');
        if(hasTag(tags,'archived') || hasTag(tags,'superseded')) continue;

        // normalize type for transfers
        const rowCat = String(r.category||'');
        const rowCatName = String(r.category_name||'');
        const normType = (rowCat==='TRANSFER' || rowCatName==='Transfers') ? 'TRANSFER' : String(r.type||'');
        if(String(normType).toUpperCase() !== 'EXPENSE') continue;

        const amt = Number(r.amount||0);
        if(!Number.isFinite(amt) || amt===0) continue;

        const mc = String(r.merchant_code||'').trim().toUpperCase();
        const raw = String(r.raw_text||'');
        const notes = String(r.notes||'');
        const mention = reZ.test(raw) || reZ.test(notes);

        if(mc==='ZOMATO' || (!mc && mention)){
          cand.push({
            txn_id: String(r.txn_id||''),
            date,
            amount: amt,
            merchant_code: mc,
            raw_text: raw,
            notes,
            source: String(r.source||''),
            file: path.basename(fp),
            sheet: sn
          });
        }
      }
    }
  }
  return cand;
}

function match(mailOrders, txns, bufferDays, tol){
  const byDate = new Map();
  for(const t of txns){
    if(!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }

  function datesWithin(d){
    const out=[];
    for(const [k] of byDate.entries()){
      const dd=daysBetween(d,k);
      if(dd===null) continue;
      if(Math.abs(dd)<=bufferDays) out.push({date:k, dd});
    }
    out.sort((a,b)=>Math.abs(a.dd)-Math.abs(b.dd));
    return out;
  }

  const matches=[];
  const ambiguous=[];
  const none=[];

  for(const mo of mailOrders){
    const cand=[];
    for(const {date, dd} of datesWithin(mo.date)){
      for(const t of (byDate.get(date)||[])){
        const diff = Number(t.amount) - Number(mo.total);
        if(Math.abs(diff) <= tol){
          const boost = (t.merchant_code==='ZOMATO') ? 1 : 0;
          cand.push({ txn: t, dayDelta: dd, amtDelta: diff, boost });
        }
      }
    }

    cand.sort((a,b)=> (b.boost-a.boost) || (Math.abs(a.amtDelta)-Math.abs(b.amtDelta)) || (Math.abs(a.dayDelta)-Math.abs(b.dayDelta)));

    if(!cand.length){
      none.push({ mail: mo });
      continue;
    }

    if(cand.length===1){
      matches.push({ mail: mo, match: cand[0] });
      continue;
    }

    const c0=cand[0], c1=cand[1];
    const s0 = (Math.abs(c0.amtDelta)*10 + Math.abs(c0.dayDelta)) - c0.boost*5;
    const s1 = (Math.abs(c1.amtDelta)*10 + Math.abs(c1.dayDelta)) - c1.boost*5;

    if(s0 + 2 < s1){
      matches.push({ mail: mo, match: c0, note: 'clear_best' });
    } else {
      ambiguous.push({
        mail: mo,
        candidates: cand.slice(0,5).map(c => ({
          txn_id: c.txn.txn_id,
          date: c.txn.date,
          amount: c.txn.amount,
          merchant_code: c.txn.merchant_code,
          raw_text: c.txn.raw_text,
          file: c.txn.file,
          sheet: c.txn.sheet,
          dayDelta: c.dayDelta,
          amtDelta: c.amtDelta,
          boost: c.boost
        }))
      });
    }
  }

  return { matches, ambiguous, none };
}

function main(){
  const args=process.argv.slice(2);
  const baseDir=String(getArg(args,'--base-dir')||'/home/molt/HisabKitab');
  const fyStart=String(getArg(args,'--fy-start')||'2025-04-01');
  const fyEnd=String(getArg(args,'--fy-end')||'2026-03-31');
  const bufferDays=Number(getArg(args,'--buffer-days')||3);
  const tol=Number(getArg(args,'--tol')||10);

  const mailOrders=loadMailOrders(baseDir, fyStart, fyEnd);
  const txns=loadTxnCandidates(baseDir, fyStart, fyEnd);
  const { matches, ambiguous, none } = match(mailOrders, txns, bufferDays, tol);

  const outFp = path.join(baseDir,'cache',`zomato_match_report_FY_${fyStart}_${fyEnd}.json`);
  writeJson(outFp, {
    ok:true,
    fyStart,
    fyEnd,
    bufferDays,
    tol,
    mailOrders: mailOrders.length,
    txnCandidates: txns.length,
    matched: matches.length,
    ambiguous: ambiguous.length,
    unmatched: none.length,
    matches,
    ambiguousExamples: ambiguous.slice(0,50),
    unmatchedExamples: none.slice(0,50)
  });

  process.stdout.write(JSON.stringify({ ok:true, out: outFp, summary: { mailOrders: mailOrders.length, txnCandidates: txns.length, matched: matches.length, ambiguous: ambiguous.length, unmatched: none.length } }, null, 2) + '\n');
}

main();
