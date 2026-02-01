#!/usr/bin/env node
/* Split workbook transactions into item-level rows using orders_parsed.json.
 * Currently supports: Blinkit PDF invoices (merchant=BLINKIT) where we have item totals.
 *
 * Strategy:
 * - Find rows with merchant_code=BLINKIT and amount ~= invoice_total and date matches invoice_date.
 * - Replace that single row with multiple item rows:
 *   - Each item row: amount=item.total, raw_text=item.name, merchant_code preserved.
 *   - group_id kept (or generated) to tie them together.
 * - If item totals don't sum exactly, add a final "Other charges" row for the remainder.
 *
 * Usage:
 *   node src/core/split_from_orders.js --base-dir ~/HisabKitab --file ~/HisabKitab/HK_2026-01-Week2.xlsx
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const { DateTime } = require('luxon');
const { nanoid } = require('nanoid');

const IST = 'Asia/Kolkata';

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function readJsonSafe(fp, fallback){
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fallback; }
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    file: expandHome(get('--file') || ''),
    tol: Number(get('--tol') || 2)
  };
}

function amtClose(a,b,tol){
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function orderDateToISO(s){
  if(!s) return null;
  // Blinkit: 28-Jan-2026
  let dt = DateTime.fromFormat(String(s), 'dd-LLL-yyyy', { zone: IST });
  if(dt.isValid) return dt.toISODate();
  // Zepto: 15-04-2025
  dt = DateTime.fromFormat(String(s), 'dd-MM-yyyy', { zone: IST });
  if(dt.isValid) return dt.toISODate();
  // ISO
  dt = DateTime.fromISO(String(s), { zone: IST });
  if(dt.isValid) return dt.toISODate();
  return null;
}

function cleanProductName(name){
  let s = String(name || '');
  // Remove HSN / product code noise that sometimes appears in invoices
  s = s.replace(/\bHSN\b\s*(?:code)?\s*[:#-]?\s*\d+/ig, '');
  s = s.replace(/\bHSN\s*[:#-]?\s*\d+/ig, '');
  s = s.replace(/\bSKU\b\s*[:#-]?\s*[A-Z0-9-]+/ig, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function flattenItems(order){
  const merchant = String(order.merchant || '').toUpperCase();

  // Blinkit (PDF invoices)
  if (merchant === 'BLINKIT') {
    const out = [];
    for(const inv of (order.invoices || [])){
      for(const it of (inv.items || [])){
        const amt = it.total;
        if(amt == null) continue;
        const n = cleanProductName(it.name);
        if(!n) continue;
        out.push({ name: n, amount: Number(amt) });
      }
    }
    return out.filter(x => Number.isFinite(x.amount) && x.amount > 0);
  }

  // Swiggy (PDF invoices)
  if (merchant === 'SWIGGY') {
    const out = [];
    for (const it of (order.items || [])) {
      const amt = it.amount;
      const n = cleanProductName(it.name);
      if (!n) continue;
      if (amt == null) continue;
      out.push({ name: n, amount: Number(amt) });
    }
    return out.filter(x => Number.isFinite(x.amount) && x.amount > 0);
  }

  // Zomato (PDF invoices)
  if (merchant === 'ZOMATO') {
    const out = [];
    for (const it of (order.items || [])) {
      const amt = it.amount;
      const n = cleanProductName(it.name);
      if (!n) continue;
      if (amt == null) continue;
      out.push({ name: n, amount: Number(amt) });
    }
    return out.filter(x => Number.isFinite(x.amount) && x.amount > 0);
  }

  // Amazon (email)
  if (merchant === 'AMAZON') {
    const out = [];
    for (const it of (order.items || [])) {
      const amt = it.amount;
      const n = cleanProductName(it.name);
      if (!n) continue;
      if (amt == null) continue;
      out.push({ name: n, amount: Number(amt) });
    }
    return out.filter(x => Number.isFinite(x.amount) && x.amount > 0);
  }

  return [];
}

function pickOrdersForAmount(byDate, date, amt, tol){
  // Try exact match on same day; then allow +/-1 day; then try subset sum on same day.
  const dateIso = date;
  const dates = [dateIso];
  try {
    const dt = DateTime.fromISO(dateIso, { zone: IST });
    if (dt.isValid) {
      dates.push(dt.plus({ days: 1 }).toISODate());
      dates.push(dt.minus({ days: 1 }).toISODate());
    }
  } catch {}

  // 1) exact match (single invoice)
  for (const d of dates) {
    const cand = (byDate.get(d) || []).filter(o => o.total != null);
    const m = cand.find(o => amtClose(o.total, amt, tol));
    if (m) return { orders: [m], matchedDate: d, mode: 'single' };
  }

  // 2) subset sum on the candidate dates (common case: multiple orders sum to one payment)
  let best = null;
  for (const d of dates) {
    const same = (byDate.get(d) || []).filter(o => o.total != null);
    // small N, brute force
    const n = Math.min(same.length, 12);
    const arr = same.slice(0, n);
    for (let mask = 1; mask < (1 << n); mask++) {
      let sum = 0;
      const picked = [];
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          sum += Number(arr[i].total);
          picked.push(arr[i]);
        }
      }
      if (amtClose(sum, amt, tol)) {
        // prefer fewer invoices; then prefer exact-date match
        if (!best || picked.length < best.orders.length || (picked.length === best.orders.length && d === dateIso)) {
          best = { orders: picked, matchedDate: d, mode: 'subset' };
        }
      }
    }
  }
  return best;
}

function splitWorkbook(filePath, baseDir, tol){
  const ordersPath = path.join(baseDir, 'orders_parsed.json');
  const ordersDoc = readJsonSafe(ordersPath, { orders: [] });
  const orders = (ordersDoc.orders || [])
    .filter(o => ['BLINKIT','AMAZON','SWIGGY','ZOMATO'].includes(String(o.merchant||'').toUpperCase()));

  const byDate = new Map();
  for(const o of orders){
    // Prefer explicit invoice date; fall back to email internal timestamp day.
    const iso = orderDateToISO(o.invoice_date || o.date) || (o.internalDateMs ? DateTime.fromMillis(Number(o.internalDateMs), { zone: IST }).toISODate() : null);
    if(!iso) continue;
    if(!byDate.has(iso)) byDate.set(iso, []);
    byDate.get(iso).push(o);
  }

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  // Support both the raw template headers (snake_case) and the "pretty" export headers (Title Case)
  const sample = rows[0] || {};
  const key = (a, b) => (Object.prototype.hasOwnProperty.call(sample, a) ? a : b);
  const kDate = key('date', 'Date');
  const kAmount = key('amount', 'Amount');
  const kMerchant = key('merchant_code', 'Merchant Code');
  const kRaw = key('raw_text', 'Raw Text');
  const kNotes = key('notes', 'Notes');
  const kTxnId = key('txn_id', 'Transaction ID');
  const kGroupId = key('group_id', 'Group ID');
  const kParseStatus = key('parse_status', 'Parse Status');
  const kParseError = key('parse_error', 'Parse Error');

  let changed = 0;
  const out = [];

  for(const r of rows){
    // Only split expense rows with supported merchant codes
    const mc = String(r[kMerchant] || '').toUpperCase();
    if(!['BLINKIT','AMAZON','SWIGGY','ZOMATO'].includes(mc)) { out.push(r); continue; }

    const date = String(r[kDate] || '');
    const amt = Number(r[kAmount]);
    if(!date || !Number.isFinite(amt)) { out.push(r); continue; }

    const picked = pickOrdersForAmount(byDate, date, amt, tol);
    if(!picked || !picked.orders || !picked.orders.length) { out.push(r); continue; }

    // Combine items across one or more invoices/orders
    let items = [];
    for (const o of picked.orders) items = items.concat(flattenItems(o));
    if(!items.length) { out.push(r); continue; }

    const groupId = r[kGroupId] ? String(r[kGroupId]) : nanoid();
    const sum = items.reduce((s,x)=>s + (Number(x.amount)||0), 0);

    for(const it of items){
      out.push({
        ...r,
        [kTxnId]: nanoid(),
        [kGroupId]: groupId,
        [kAmount]: Number(it.amount),
        [kRaw]: it.name,
        [kNotes]: (String(r[kRaw]||'') + ' | ' + it.name).slice(0, 300),
        [kParseStatus]: 'split_from_invoice',
        [kParseError]: picked.mode === 'subset' ? 'matched_multiple_invoices' : ''
      });
    }

    const diff = Number(amt) - Number(sum);
    if(Number.isFinite(diff) && Math.abs(diff) > tol){
      out.push({
        ...r,
        [kTxnId]: nanoid(),
        [kGroupId]: groupId,
        [kAmount]: Math.round(diff * 100) / 100,
        [kRaw]: `Other charges (${mc})`,
        [kNotes]: (String(r[kRaw]||'') + ' | remainder').slice(0, 300),
        [kParseStatus]: 'split_from_invoice',
        [kParseError]: 'invoice item sum mismatch'
      });
    }

    changed++;
  }

  const headers = Object.keys(rows[0] || out[0] || {});
  const newWs = XLSX.utils.json_to_sheet(out, { header: headers });
  wb.Sheets['Transactions'] = newWs;
  if (!wb.SheetNames.includes('Transactions')) wb.SheetNames.unshift('Transactions');
  XLSX.writeFile(wb, filePath);

  return { rows: rows.length, outRows: out.length, changed, ordersUsed: changed, ordersTotal: orders.length };
}

function main(){
  const { baseDir, file, tol } = parseArgs(process.argv);
  if(!file){
    console.error('Usage: node split_from_orders.js --file <xlsx> [--base-dir ~/HisabKitab]');
    process.exit(2);
  }
  const res = splitWorkbook(file, baseDir, tol);
  process.stdout.write(JSON.stringify({ ok:true, file, ...res }, null, 2) + '\n');
}

main();
