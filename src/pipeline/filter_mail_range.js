#!/usr/bin/env node
/* Filter payments_parsed.json and orders_parsed.json to a date range (IST).
 * Writes filtered copies to *_filtered.json
 * Usage: node src/pipeline/filter_mail_range.js --base-dir ~/HisabKitab --from YYYY-MM-DD --to YYYY-MM-DD
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DateTime } = require('luxon');
const IST = 'Asia/Kolkata';

function expandHome(p){ return p && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p; }
function readJsonSafe(fp, fb){ try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fb; } }
function writeJson(fp, obj){ fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return { baseDir: expandHome(get('--base-dir')||'~/HisabKitab'), from: get('--from'), to: get('--to') };
}

function parseOrderDateMs(o){
  const s = o.invoice_date || o.date || '';
  if(!s) return null;
  let dt = DateTime.fromFormat(s, 'dd-MM-yyyy', { zone: IST });
  if(dt.isValid) return dt.toMillis();
  dt = DateTime.fromFormat(s, 'dd-LLL-yyyy', { zone: IST });
  if(dt.isValid) return dt.toMillis();
  dt = DateTime.fromISO(s, { zone: IST });
  if(dt.isValid) return dt.toMillis();
  return null;
}

function main(){
  const { baseDir, from, to } = parseArgs(process.argv);
  if(!from || !to){ console.error('Usage: --from YYYY-MM-DD --to YYYY-MM-DD'); process.exit(2); }
  const fromDt = DateTime.fromISO(from, { zone: IST }).startOf('day');
  const toDt = DateTime.fromISO(to, { zone: IST }).endOf('day');

  const payPath = path.join(baseDir, 'payments_parsed.json');
  const ordPath = path.join(baseDir, 'orders_parsed.json');
  const pay = readJsonSafe(payPath, { payments: [], unknown: [] });
  const ord = readJsonSafe(ordPath, { orders: [], unknown: [] });

  const payments = (pay.payments||[]).filter(p => {
    const ms = Number(p.internalDateMs||0);
    return ms >= fromDt.toMillis() && ms <= toDt.toMillis();
  });

  const orders = (ord.orders||[]).filter(o => {
    const ms = parseOrderDateMs(o);
    if(ms == null) return false;
    return ms >= fromDt.toMillis() && ms <= toDt.toMillis();
  });

  const payOut = path.join(baseDir, 'payments_parsed_filtered.json');
  const ordOut = path.join(baseDir, 'orders_parsed_filtered.json');
  writeJson(payOut, { ok:true, from, to, payments, unknown: [] });
  writeJson(ordOut, { ok:true, from, to, orders, unknown: [] });
  console.log(JSON.stringify({ ok:true, payments: payments.length, orders: orders.length, payOut, ordOut }, null, 2));
}

main();
