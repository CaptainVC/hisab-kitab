#!/usr/bin/env node
/*
Match mail_orders.json (unmatched) against a cleansed manual hisab dataset.

Inputs:
- --base-dir /home/molt/HisabKitab
- --hisab /home/molt/HisabKitab/cache/hisab_manual_2025_Q2.json
- --from 2025-04 --to 2025-06 (optional; limits by entry date)
- --buffer-days 2
- --tol 2
- --tol-food 10

Outputs:
- <baseDir>/cache/mail_to_hisab_manual_<period>.json
Does NOT mutate mail_orders.json.
*/

const fs = require('node:fs');
const path = require('node:path');

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

function daysBetween(a, b) {
  const t0 = Date.parse(a + 'T00:00:00Z');
  const t1 = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.round((t1 - t0) / 86400000);
}

function inMonthRange(dateIso, fromYm, toYm) {
  if (!fromYm || !toYm) return true;
  const ym = dateIso.slice(0, 7);
  return ym >= fromYm && ym <= toYm;
}

function normMerchant(s) {
  return String(s || '').trim().toUpperCase();
}

function isFoodGroceryMerchant(m) {
  const x = normMerchant(m);
  return ['SWIGGY', 'ZOMATO', 'ZEPTO', 'BLINKIT', 'SWIGGY_INSTAMART', 'EATCLUB', 'DOMINOS', 'BURGER_KING'].includes(x);
}

function main() {
  const args = process.argv.slice(2);
  const baseDir = String(getArg(args, '--base-dir') || '/home/molt/HisabKitab');
  const hisabFp = String(getArg(args, '--hisab') || '');
  const fromYm = String(getArg(args, '--from') || '');
  const toYm = String(getArg(args, '--to') || '');
  const bufferDays = Number(getArg(args, '--buffer-days') || 2);
  const tol = Number(getArg(args, '--tol') || 2);
  const tolFood = Number(getArg(args, '--tol-food') || 10);

  if (!hisabFp) throw new Error('missing --hisab');

  const storeFp = path.join(baseDir, 'staging', 'mail_orders.json');
  const store = readJson(storeFp, { schemaVersion: 1, orders: [] });
  const mailOrders = Array.isArray(store.orders) ? store.orders : [];

  const hisabDoc = readJson(hisabFp, null);
  if (!hisabDoc) throw new Error('bad hisab json');
  const hisabRows = Array.isArray(hisabDoc.rows) ? hisabDoc.rows : [];

  // Only expenses, not excluded
  const his = hisabRows
    .filter(r => r && !r.exclude && String(r.type).toUpperCase() === 'EXPENSE')
    .filter(r => !fromYm || !toYm ? true : inMonthRange(String(r.date || ''), fromYm, toYm));

  const byDate = new Map();
  for (const r of his) {
    const d = String(r.date || '');
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }

  let considered = 0;
  let matched = 0;
  let ambiguous = 0;
  let none = 0;

  const matches = [];
  const ambiguousExamples = [];
  const noneExamples = [];

  for (const mo of mailOrders) {
    if (!mo || mo.status !== 'unmatched') continue;
    const moDate = String(mo.date || '');
    const moTotal = Number(mo.total || 0);
    if (!moDate || !moTotal) continue;

    // limit to quarter window (if provided)
    if (fromYm && toYm && !inMonthRange(moDate, fromYm, toYm)) continue;

    considered++;

    const tolUse = isFoodGroceryMerchant(mo.merchant) ? tolFood : tol;
    const candidates = [];

    for (const [d, list] of byDate.entries()) {
      const dd = daysBetween(moDate, d);
      if (dd === null) continue;
      if (Math.abs(dd) > bufferDays) continue;
      for (const r of list) {
        const amt = Number(r.amount || 0);
        if (!amt) continue;
        const diff = amt - moTotal;
        if (Math.abs(diff) <= tolUse) {
          // boost if merchant hint aligns (when we have merchant_code or raw)
          const hm = normMerchant(r.merchant_code || r.merchant_raw || '');
          const mm = normMerchant(mo.merchant || '');
          const hint = (hm && mm && (hm.includes(mm) || mm.includes(hm))) ? 1 : 0;
          candidates.push({ hisab: r, dayDelta: dd, amtDelta: diff, tol: tolUse, hint });
        }
      }
    }

    // rank: merchant hint desc, abs(amtDelta) asc, abs(dayDelta) asc
    candidates.sort((a, b) => (b.hint - a.hint) || (Math.abs(a.amtDelta) - Math.abs(b.amtDelta)) || (Math.abs(a.dayDelta) - Math.abs(b.dayDelta)));

    if (candidates.length === 0) {
      none++;
      if (noneExamples.length < 20) noneExamples.push({ mail: mo });
      continue;
    }

    // if top candidate clearly better than runner-up, accept
    if (candidates.length === 1) {
      matched++;
      matches.push({ mail: mo, match: candidates[0] });
      continue;
    }

    const c0 = candidates[0];
    const c1 = candidates[1];
    const better = (c0.hint > c1.hint) || (Math.abs(c0.amtDelta) + Math.abs(c0.dayDelta) < Math.abs(c1.amtDelta) + Math.abs(c1.dayDelta));

    if (better && (c0.hint > c1.hint)) {
      matched++;
      matches.push({ mail: mo, match: c0, note: 'hint_break' });
      continue;
    }

    ambiguous++;
    if (ambiguousExamples.length < 20) {
      ambiguousExamples.push({
        mail: mo,
        candidates: candidates.slice(0, 5).map(c => ({
          date: c.hisab.date,
          amount: c.hisab.amount,
          raw_text: c.hisab.raw_text,
          merchant_code: c.hisab.merchant_code,
          source: c.hisab.source,
          dayDelta: c.dayDelta,
          amtDelta: c.amtDelta,
          tol: c.tol,
          hint: c.hint
        }))
      });
    }
  }

  const period = (hisabDoc && hisabDoc.period) ? String(hisabDoc.period) : 'manual';
  const outFp = path.join(baseDir, 'cache', `mail_to_hisab_manual_${period}.json`);
  const out = {
    ok: true,
    period,
    fromYm: fromYm || null,
    toYm: toYm || null,
    bufferDays,
    tol,
    tolFood,
    considered,
    matched,
    ambiguous,
    none,
    matches,
    examples: { ambiguous: ambiguousExamples, none: noneExamples }
  };

  writeJson(outFp, out);

  process.stdout.write(JSON.stringify({ ok: true, out: outFp, summary: { considered, matched, ambiguous, none } }, null, 2));
  process.stdout.write('\n');
}

main();
