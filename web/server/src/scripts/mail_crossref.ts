import fs from 'node:fs';
import path from 'node:path';
import { syncMailOrders } from './mail_orders_sync.js';
import type { MailOrderRecord } from './mail_orders_sync.js';

function getArg(args: string[], name: string) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function rangeToMs(from: string, to: string) {
  const f = String(from || '').trim();
  const t = String(to || '').trim();

  if (/^\d{4}-\d{2}$/.test(f) && /^\d{4}-\d{2}$/.test(t)) {
    const [fy, fm] = f.split('-').map(Number);
    const [ty, tm] = t.split('-').map(Number);
    if (!fy || !fm || !ty || !tm) return null;
    const start = Date.UTC(fy, fm - 1, 1, 0, 0, 0, 0);
    const endExclusive = Date.UTC(ty, tm, 1, 0, 0, 0, 0);
    return { start, endExclusive };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const start = Date.parse(f + 'T00:00:00Z');
    const endInc = Date.parse(t + 'T00:00:00Z');
    if (!Number.isFinite(start) || !Number.isFinite(endInc)) return null;
    return { start, endExclusive: endInc + 86400000 };
  }

  return null;
}

function readJson<T>(fp: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(fp: string, obj: any) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8');
}

function daysBetween(a: string, b: string) {
  const t0 = Date.parse(a + 'T00:00:00Z');
  const t1 = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.round((t1 - t0) / 86400000);
}

export async function main() {
  const args = process.argv.slice(2);
  const baseDir = String(getArg(args, '--base-dir') || '');
  const from = String(getArg(args, '--from') || '');
  const to = String(getArg(args, '--to') || '');
  const bufferDays = Number(getArg(args, '--buffer-days') || 2);
  const tol = Number(getArg(args, '--tol') || 2);

  if (!baseDir) throw new Error('missing_base_dir');
  if (!from || !to) throw new Error('missing_range');

  const range = rangeToMs(from, to);
  if (!range) throw new Error('bad_range');

  // Ensure store is up to date with latest parsed emails
  const syncRes = syncMailOrders(baseDir);

  const storeFp = path.join(baseDir, 'staging', 'mail_orders.json');
  const store = readJson<{ schemaVersion: 1; orders: MailOrderRecord[] }>(storeFp, { schemaVersion: 1, orders: [] });

  const cacheFp = path.join(baseDir, 'cache', `hisab_data_${from}_${to}.json`);
  const cache = readJson<any>(cacheFp, null);
  if (!cache) throw new Error(`missing_cache:${cacheFp}`);
  const rows: any[] = Array.isArray(cache?.rows) ? cache.rows : [];
  const his = rows.filter((r) => !r.messageId && String(r.type || '').toUpperCase() === 'EXPENSE');

  const byDate = new Map<string, any[]>();
  for (const r of his) {
    const d = String(r.date || '');
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(r);
  }

  let considered = 0;
  let matched = 0;
  let ambiguous = 0;
  let none = 0;

  const now = new Date().toISOString();
  const ambiguousExamples: any[] = [];
  const noneExamples: any[] = [];

  for (const mo of store.orders) {
    if (mo.status !== 'unmatched') continue;

    // only attempt within range ± buffer
    const ddFrom = daysBetween(from + '-01', mo.date);
    const [ty, tm] = to.split('-').map(Number);
    const endExclusive = new Date(Date.UTC(ty, tm, 1)).toISOString().slice(0, 10);
    const ddTo = daysBetween(mo.date, endExclusive);
    // quick coarse filter: mo.date should be within [from-01-buffer, endExclusive+buffer)
    // We'll just keep it simple: attempt if mo.date month overlaps from/to +/- buffer doesn't matter much

    considered++;

    const candidates: any[] = [];
    for (const [d, list] of byDate.entries()) {
      const dayDelta = daysBetween(mo.date, d);
      if (dayDelta === null) continue;
      if (Math.abs(dayDelta) > bufferDays) continue;
      for (const r of list) {
        const amt = Number(r.amount || 0);
        if (Math.abs(amt - mo.total) <= tol) {
          candidates.push({ r, dayDelta, amtDelta: amt - mo.total });
        }
      }
    }

    if (candidates.length === 0) {
      none++;
      if (noneExamples.length < 10) noneExamples.push({ mail: mo });
      continue;
    }

    if (candidates.length === 1) {
      const c = candidates[0];
      mo.status = 'matched';
      mo.matched_txn_id = String(c.r.txn_id || '');
      mo.match = {
        confidence: 'high',
        reason: 'unique_amount_date_match',
        dayDelta: c.dayDelta,
        amtDelta: c.amtDelta
      };
      mo.updatedAt = now;
      matched++;
      continue;
    }

    ambiguous++;
    if (ambiguousExamples.length < 10) {
      ambiguousExamples.push({
        mail: mo,
        candidates: candidates.slice(0, 5).map((x) => ({
          txn_id: x.r.txn_id,
          date: x.r.date,
          amount: x.r.amount,
          source: x.r.source,
          raw_text: x.r.raw_text,
          notes: x.r.notes,
          dayDelta: x.dayDelta,
          amtDelta: x.amtDelta
        }))
      });
    }
  }

  writeJson(storeFp, store);

  const out = {
    ok: true,
    from,
    to,
    bufferDays,
    tol,
    sync: syncRes,
    considered,
    matched,
    ambiguous,
    none,
    examples: { ambiguous: ambiguousExamples, none: noneExamples }
  };

  const outFp = path.join(baseDir, 'cache', `mail_crossref_${from}_${to}.json`);
  writeJson(outFp, out);

  process.stdout.write(JSON.stringify({ ok: true, out: outFp, summary: out }, null, 2));
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err?.message || err) + '\n');
  process.exit(1);
});
