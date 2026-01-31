#!/usr/bin/env node
/* Reconcile a day (IST) across:
 * - Hisab entries (hisab/YYYY-MM-DD.txt -> hisab_entries/YYYY-MM-DD.json)
 * - Payment events (payments_parsed.json)
 * - Orders/events (orders_parsed.json)
 *
 * v1 goals:
 * - Match hisab entries to payments (amount + source hint)
 * - Match payments to orders (amount + date window)
 * - Flag missing hisab entries (payments with no hisab)
 * - Flag unmatched orders (orders with no payment yet; likely COD or delayed)
 *
 * Usage:
 *   node src/reconcile/reconcile_day.js --base-dir ~/HisabKitab --date YYYY-MM-DD
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { DateTime } = require('luxon');

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
    date: get('--date'),
    payTol: Number(get('--pay-tol') || 2),
    payWindowDays: Number(get('--pay-window-days') || 7),
    orderTol: Number(get('--order-tol') || 10),
    orderWindowDays: Number(get('--order-window-days') || 7),
    maxOrderPaymentGapDays: Number(get('--max-order-payment-gap-days') || 5),
    // sources that may not have any payment email trail (manual-only)
    nonVerifiableSources: (get('--non-verifiable-sources') || 'SBI,mk').split(',').map(s=>s.trim()).filter(Boolean)
  };
}

function amtClose(a,b,tol){
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function parseOrderDateMs(order){
  const s = order.invoice_date || order.date || '';
  if(!s) return null;

  // Zepto: 15-04-2025
  let dt = DateTime.fromFormat(s, 'dd-MM-yyyy', { zone: IST });
  if(dt.isValid) return dt.toMillis();

  // Blinkit: 28-Jan-2026
  dt = DateTime.fromFormat(s, 'dd-LLL-yyyy', { zone: IST });
  if(dt.isValid) return dt.toMillis();

  // ISO
  dt = DateTime.fromISO(s, { zone: IST });
  if(dt.isValid) return dt.toMillis();

  return null;
}

function paymentSourceMatchesHint(payment, sourceHint){
  if(!sourceHint) return false;
  if(sourceHint === 'mk') return payment.source === 'MOBIKWIK';
  if(sourceHint === 'cc') return payment.source === 'HDFC_INSTA_ALERT';
  return false;
}

function main(){
  const { baseDir, date, payTol, payWindowDays, orderTol, orderWindowDays, maxOrderPaymentGapDays, nonVerifiableSources } = parseArgs(process.argv);
  if(!date){
    console.error('Usage: node reconcile_day.js --date YYYY-MM-DD [--base-dir ~/HisabKitab]');
    process.exit(2);
  }

  const nonVerifiable = new Set((nonVerifiableSources || []).map(s => String(s).trim()));

  // normalize source hint comparisons (SBI/mk)
  const isNonVerifiableHint = (hint) => hint && nonVerifiable.has(String(hint).trim());

  // (usage message moved above)

  const dayStart = DateTime.fromISO(date, { zone: IST }).startOf('day');
  const dayEnd = dayStart.endOf('day');

  const hisabJsonPath = path.join(baseDir, 'hisab_entries', `${date}.json`);
  const hisab = readJsonSafe(hisabJsonPath, { entries: [], errors: [{ error: 'missing hisab_entries json', file: hisabJsonPath }] });

  const paymentsDoc = readJsonSafe(path.join(baseDir, 'payments_parsed.json'), { payments: [], unknown: [] });
  const ordersDoc = readJsonSafe(path.join(baseDir, 'orders_parsed.json'), { orders: [], unknown: [] });

  const payments = paymentsDoc.payments || [];
  const orders = ordersDoc.orders || [];

  // Payments in this IST day (using internalDateMs)
  const payDay = payments.filter(p => {
    const ms = Number(p.internalDateMs || 0);
    return ms >= dayStart.toMillis() && ms <= dayEnd.toMillis();
  });

  // Payment search window for matching hisab entries (cross-day)
  const payWinStart = dayStart.minus({ days: payWindowDays });
  const payWinEnd = dayEnd.plus({ days: payWindowDays });
  const payWin = payments.filter(p => {
    const ms = Number(p.internalDateMs || 0);
    return ms >= payWinStart.toMillis() && ms <= payWinEnd.toMillis();
  });

  // Orders near this day (invoice date window)
  const winStart = dayStart.minus({ days: orderWindowDays });
  const winEnd = dayEnd.plus({ days: orderWindowDays });
  const ordWin = orders.filter(o => {
    const ms = parseOrderDateMs(o);
    return ms != null && ms >= winStart.toMillis() && ms <= winEnd.toMillis();
  });

  // 1) Match hisab entries -> payments (cross-day window)
  const hisabToPayment = [];
  const usedPaymentIds = new Set();

  const manualOnlyHisab = [];

  for(const h of (hisab.entries || [])){
    // SBI (and any configured) may not have emails at all
    if (isNonVerifiableHint(h.source_hint) && h.source_hint !== 'mk') {
      manualOnlyHisab.push(h);
      continue;
    }

    const candidates = payWin
      .filter(p => p.amount != null && amtClose(p.amount, h.amount, payTol))
      .map(p => ({ p, dist: Math.abs(Number(p.internalDateMs||0) - dayStart.toMillis()) }));

    if(!candidates.length) {
      // mk can be manual-only (UPI via mk), so treat as manual section if no email found
      if (h.source_hint === 'mk') manualOnlyHisab.push(h);
      continue;
    }

    // prefer source hint
    let picked = null;
    if(h.source_hint) picked = candidates.find(x => paymentSourceMatchesHint(x.p, h.source_hint));
    if(!picked) {
      candidates.sort((a,b)=>a.dist-b.dist);
      picked = candidates[0];
    }

    if(picked && !usedPaymentIds.has(picked.p.messageId)){
      usedPaymentIds.add(picked.p.messageId);
      hisabToPayment.push({ hisab: h, payment: picked.p, confidence: h.source_hint ? 'amount+hint+window' : 'amount+window' });
    }
  }

  // Payments on this day that weren't matched to any hisab entry (even cross-day)
  const unmatchedPayments = payDay.filter(p => !usedPaymentIds.has(p.messageId));

  // Hisab entries that did not match, excluding manual-only sources
  const unmatchedHisab = (hisab.entries || [])
    .filter(h => !hisabToPayment.some(m => m.hisab.raw === h.raw))
    .filter(h => !manualOnlyHisab.some(x => x.raw === h.raw));

  // 2) Match payments -> orders (cross-day window) (best-effort)
  // We match orders in the invoice-date window against payments in a wider payment window.
  const paymentToOrder = [];
  const usedPaymentForOrder = new Set();

  const maxGapMs = Number(maxOrderPaymentGapDays) * 24 * 60 * 60 * 1000;

  for(const o of ordWin){
    if(o.total == null) continue;
    const oMs = parseOrderDateMs(o);

    const candidates = payWin
      .filter(p => p.amount != null && amtClose(p.amount, o.total, orderTol))
      .map(p => ({
        p,
        dist: (oMs != null && p.internalDateMs != null) ? Math.abs(Number(p.internalDateMs) - oMs) : null
      }))
      .filter(x => x.dist == null || x.dist <= maxGapMs)
      .sort((a,b)=>(a.dist ?? 0) - (b.dist ?? 0));

    const picked = candidates.find(x => !usedPaymentForOrder.has(x.p.messageId)) || null;
    if(!picked) continue;

    usedPaymentForOrder.add(picked.p.messageId);
    paymentToOrder.push({ payment: picked.p, order: o, confidence: 'amount+cross_day_window+gap' });
  }

  // Orders in window not linked to any payment (possible COD or payment via non-verifiable source)
  const matchedOrderKeys = new Set(paymentToOrder.map(x => x.order.messageId + '::' + (x.order.invoice_number||x.order.order_id||'')));
  const unmatchedOrders = ordWin
    .filter(o => !matchedOrderKeys.has(o.messageId + '::' + (o.invoice_number||o.order_id||'')))
    .map(o => ({ merchant: o.merchant, invoice_date: o.invoice_date, order_id: o.order_id, invoice_number: o.invoice_number, total: o.total }));

  const report = {
    ok: true,
    date,
    payments_in_day: payDay.length,
    orders_in_window: ordWin.length,
    hisab_entries: (hisab.entries || []).length,
    matched_hisab_payments: hisabToPayment.length,
    matched_payment_orders: paymentToOrder.length,
    unmatchedPayments: unmatchedPayments.map(p => ({ source: p.source, amount: p.amount, subject: p.subject })),
    unmatchedHisab: unmatchedHisab.map(h => ({ amount: h.amount, raw: h.raw, source_hint: h.source_hint })),
    manualOnlyHisab: manualOnlyHisab.map(h => ({ amount: h.amount, raw: h.raw, source_hint: h.source_hint })),
    unmatchedOrders
  };

  const outPath = path.join(baseDir, 'reconcile', `${date}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // Human-readable report for Telegram (can be sent by a cron later)
  const lines = [];
  lines.push(`HisabKitab review for ${date} (IST)`);
  lines.push(`- Hisab entries: ${report.hisab_entries}`);
  lines.push(`- Payments (emails): ${report.payments_in_day}`);
  lines.push(`- Orders (±${orderWindowDays}d): ${report.orders_in_window}`);
  lines.push(`- Matched payment↔orders: ${report.matched_payment_orders} (max gap ${maxOrderPaymentGapDays}d)`);
  lines.push('');

  if(report.unmatchedPayments.length){
    lines.push('Unmatched payments (check if missed in hisab):');
    for(const p of report.unmatchedPayments.slice(0, 30)) lines.push(`- ${p.amount} (${p.source}) :: ${p.subject}`);
    lines.push('');
  }

  if(report.unmatchedHisab.length){
    lines.push('Hisab entries with no matching payment email (cash/typo/COD?):');
    for(const h of report.unmatchedHisab.slice(0, 30)) lines.push(`- ${h.amount} :: ${h.raw}`);
    lines.push('');
  }

  if(report.manualOnlyHisab.length){
    lines.push('Manual-source hisab entries (no payment email expected):');
    for(const h of report.manualOnlyHisab.slice(0, 30)) lines.push(`- ${h.amount} :: ${h.raw}`);
    lines.push('');
  }

  if(report.unmatchedOrders.length){
    lines.push('Orders not matched to any payment yet (may arrive later / COD):');
    for(const o of report.unmatchedOrders.slice(0, 30)) lines.push(`- ${o.merchant} ${o.total} :: ${o.invoice_number||o.order_id||''} (${o.invoice_date||''})`);
    lines.push('');
  }

  const txtPath = path.join(baseDir, 'reconcile', `${date}.txt`);
  fs.writeFileSync(txtPath, lines.join('\n') + '\n', 'utf8');

  // Avoid crashing if output is piped and the consumer closes early.
  process.stdout.on('error', (e) => {
    if (e && e.code === 'EPIPE') process.exit(0);
  });

  process.stdout.write(JSON.stringify({ ok: true, saved: outPath, savedText: txtPath, ...report }, null, 2) + '\n');
}

main();
