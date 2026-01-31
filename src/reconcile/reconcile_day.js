#!/usr/bin/env node
/* Reconcile a day (IST) across:
 * - Hisab entries (hisab/YYYY-MM-DD.txt)
 * - Payment events (payments_parsed.json)
 * - Orders (orders_unmatched.json / orders_parsed.json later)
 *
 * Current v0: flags missing hisab entries for the day and unmatched hisab entries.
 *
 * Usage:
 *   node src/reconcile/reconcile_day.js --base-dir ~/HisabKitab --date YYYY-MM-DD
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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
    tol: Number(get('--tol') || 2)
  };
}

// (hisab entries are expected to be pre-parsed into baseDir/hisab_entries/YYYY-MM-DD.json)

function amtClose(a,b,tol){
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function main(){
  const { baseDir, date, tol } = parseArgs(process.argv);
  if(!date){
    console.error('Usage: node reconcile_day.js --date YYYY-MM-DD [--base-dir ~/HisabKitab]');
    process.exit(2);
  }

  // hisab entries
  const hisabJsonPath = path.join(baseDir, 'hisab_entries', `${date}.json`);
  const hisab = readJsonSafe(hisabJsonPath, null);

  const paymentsPath = path.join(baseDir, 'payments_parsed.json');
  const paymentsDoc = readJsonSafe(paymentsPath, { payments: [] });
  const payments = paymentsDoc.payments || [];

  const dayStart = new Date(date + 'T00:00:00+05:30').getTime();
  const dayEnd = new Date(date + 'T23:59:59+05:30').getTime();

  const payDay = payments.filter(p => (p.internalDateMs || 0) >= dayStart && (p.internalDateMs || 0) <= dayEnd);

  // basic matching by amount + source hint (if available)
  const matches = [];
  const usedPayments = new Set();

  if(hisab && hisab.entries){
    for(const h of hisab.entries){
      const candidates = payDay
        .map((p, idx) => ({ p, idx }))
        .filter(({p}) => p.amount != null && amtClose(p.amount, h.amount, tol));

      // prefer source if present
      let picked = null;
      if(h.source_hint){
        picked = candidates.find(({p}) => (p.source === 'MOBIKWIK' && h.source_hint === 'mk') || (p.source === 'HDFC_INSTA_ALERT' && h.source_hint === 'cc'));
      }
      if(!picked) picked = candidates[0] || null;

      if(picked && !usedPayments.has(picked.p.messageId)){
        usedPayments.add(picked.p.messageId);
        matches.push({ hisab: h, payment: picked.p, confidence: 'amount' });
      }
    }
  }

  const unmatchedPayments = payDay.filter(p => !usedPayments.has(p.messageId));
  const unmatchedHisab = (hisab?.entries || []).filter(h => !matches.some(m => m.hisab.raw === h.raw));

  const report = {
    ok: true,
    date,
    payments_in_day: payDay.length,
    hisab_entries: hisab?.entries?.length || 0,
    matched: matches.length,
    unmatchedPayments: unmatchedPayments.map(p => ({ source: p.source, amount: p.amount, subject: p.subject })),
    unmatchedHisab: unmatchedHisab.map(h => ({ amount: h.amount, raw: h.raw, source_hint: h.source_hint })),
  };

  const outPath = path.join(baseDir, 'reconcile', `${date}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, saved: outPath, ...report }, null, 2) + '\n');
}

main();
