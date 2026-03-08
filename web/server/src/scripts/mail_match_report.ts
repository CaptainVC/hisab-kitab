import fs from 'node:fs';
import path from 'node:path';

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

function dateFromMsIST(ms: number) {
  const ist = ms + (5.5 * 60 * 60 * 1000);
  return new Date(ist).toISOString().slice(0, 10);
}

function parseItems(order: any): Array<{ name: string; amount: number }> {
  const items = Array.isArray(order?.items) ? order.items : [];
  const out: Array<{ name: string; amount: number }> = [];
  for (const it of items) {
    const name = String(it?.name || it?.title || '').trim();
    const amt = Number(it?.total ?? it?.amount ?? 0);
    if (!name || !amt) continue;
    out.push({ name, amount: amt });
  }
  return out;
}

function daysBetween(a: string, b: string) {
  const t0 = Date.parse(a + 'T00:00:00Z');
  const t1 = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.round((t1 - t0) / 86400000);
}

function normText(x: any) {
  return String(x || '').toLowerCase();
}

function merchantHints(merchantCode: string) {
  const m = String(merchantCode || '').toUpperCase();
  const map: Record<string, string[]> = {
    SWIGGY_INSTAMART: ['instamart', 'swiggy'],
    SWIGGY: ['swiggy'],
    ZOMATO: ['zomato'],
    BLINKIT: ['blinkit'],
    AMAZON: ['amazon'],
    DOMINOS: ['domino', "domino's"],
    UBER: ['uber'],
    OLA: ['ola'],
    ZEPTO: ['zepto']
  };
  if (map[m]) return map[m];
  // fallback to first token
  const t = m.split('_')[0]?.toLowerCase();
  return t ? [t] : [];
}

async function main() {
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

  const ordersFp = path.join(baseDir, 'orders_parsed.json');
  const ordersDoc = JSON.parse(fs.readFileSync(ordersFp, 'utf8')) as any;
  const orders = Array.isArray(ordersDoc?.orders) ? ordersDoc.orders : [];

  const cacheFp = path.join(baseDir, 'cache', `hisab_data_${from}_${to}.json`);
  const cache = JSON.parse(fs.readFileSync(cacheFp, 'utf8')) as any;
  const rows: any[] = Array.isArray(cache?.rows) ? cache.rows : [];

  // Only consider non-mail Hisab expenses as match targets.
  const his = rows.filter((r) => !r.messageId && String(r.type || '').toUpperCase() === 'EXPENSE');

  // Index by date (YYYY-MM-DD)
  const byDate = new Map<string, any[]>();
  for (const r of his) {
    const d = String(r.date || '');
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(r);
  }

  // Build mail orders list (email invoices) in range±buffer
  const mailOrders: Array<{ messageId: string; date: string; merchant: string; total: number; items: number }> = [];
  for (const o of orders) {
    if (o?.parse_status && String(o.parse_status) !== 'ok') continue;
    const ms = Number(o?.internalDateMs || 0);
    if (!ms) continue;
    if (ms < range.start - bufferDays * 86400000 || ms >= range.endExclusive + bufferDays * 86400000) continue;

    const date = dateFromMsIST(ms);
    const items = parseItems(o);
    if (!items.length) continue;
    const total = Number(o?.total || 0) || items.reduce((s, it) => s + it.amount, 0);

    mailOrders.push({
      messageId: String(o?.messageId || ''),
      date,
      merchant: String(o?.merchant || '').toUpperCase(),
      total,
      items: items.length
    });
  }

  // Matching
  const report: any = {
    ok: true,
    from,
    to,
    bufferDays,
    tol,
    mailOrders: mailOrders.length,
    hisabExpenses: his.length,
    matches: { unique: 0, ambiguous: 0, none: 0 },
    matchedBy: { amountDate: 0, amountDateMerchantHint: 0 },
    examples: { ambiguous: [] as any[], none: [] as any[] }
  };

  for (const mo of mailOrders) {
    const candidates: any[] = [];
    for (const [d, list] of byDate.entries()) {
      const dd = daysBetween(mo.date, d);
      if (dd === null) continue;
      if (Math.abs(dd) > bufferDays) continue;
      for (const r of list) {
        const amt = Number(r.amount || 0);
        if (Math.abs(amt - mo.total) <= tol) {
          candidates.push({ r, dayDelta: dd, amtDelta: amt - mo.total });
        }
      }
    }

    if (!candidates.length) {
      report.matches.none++;
      if (report.examples.none.length < 10) {
        report.examples.none.push({ mail: mo });
      }
      continue;
    }

    if (candidates.length === 1) {
      report.matches.unique++;
      report.matchedBy.amountDate++;
      continue;
    }

    // Try resolve ambiguity using merchant hints in raw_text/notes
    const hints = merchantHints(mo.merchant);
    const scored = candidates
      .map((c) => {
        const raw = normText(c.r.raw_text) + ' ' + normText(c.r.notes);
        let score = 0;
        for (const h of hints) if (h && raw.includes(h)) score++;
        return { ...c, score };
      })
      .sort((a, b) => (b.score - a.score) || (Math.abs(a.dayDelta) - Math.abs(b.dayDelta)) || (Math.abs(a.amtDelta) - Math.abs(b.amtDelta)));

    const best = scored[0];
    const tied = scored.filter((x) => x.score === best.score);
    if (best.score > 0 && tied.length === 1) {
      report.matches.unique++;
      report.matchedBy.amountDateMerchantHint++;
    } else {
      report.matches.ambiguous++;
      if (report.examples.ambiguous.length < 10) {
        report.examples.ambiguous.push({
          mail: mo,
          candidates: scored.slice(0, 5).map((x) => ({
            txn_id: x.r.txn_id,
            date: x.r.date,
            amount: x.r.amount,
            source: x.r.source,
            raw_text: x.r.raw_text,
            notes: x.r.notes,
            score: x.score,
            dayDelta: x.dayDelta,
            amtDelta: x.amtDelta
          }))
        });
      }
    }
  }

  const outFp = path.join(baseDir, 'cache', `mail_match_report_${from}_${to}.json`);
  fs.writeFileSync(outFp, JSON.stringify(report, null, 2), 'utf8');

  process.stdout.write(JSON.stringify({ ok: true, out: outFp, summary: report }, null, 2));
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err?.message || err) + '\n');
  process.exit(1);
});
