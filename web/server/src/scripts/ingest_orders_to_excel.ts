import fs from 'node:fs';
import path from 'node:path';

function getArg(args: string[], name: string) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function monthRangeToMs(fromYm: string, toYm: string) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return null;
  const start = Date.UTC(fy, fm - 1, 1, 0, 0, 0, 0);
  const endExclusive = Date.UTC(ty, tm, 1, 0, 0, 0, 0);
  return { start, endExclusive };
}

function dateFromMsIST(ms: number) {
  // Compute YYYY-MM-DD in IST without luxon dependency (keep script small)
  // IST = UTC+5:30
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

function categorizeInstamartItem(name: string): { category: string; subcategory: string } | null {
  const t = String(name || '').toLowerCase();
  const rules = [
    { re: /\bwater\b|\bcan\b|\bbottle\b/, cat: 'FOOD_DINING', sub: 'FOOD_WATER' },
    { re: /\bmilk\b|\bcurd\b|\byogurt\b|\bpaneer\b|\bcheese\b/, cat: 'FOOD_DINING', sub: 'FOOD_MILK' },
    { re: /\bbanana\b|\bapple\b|\bmango\b|\borange\b|\bgrape\b|\bwatermelon\b|\bfruit\b/, cat: 'FOOD_DINING', sub: 'FOOD_FRUITS' },
    { re: /\bprotein\b|\bwhey\b|\bgatorade\b|\belectrolyte\b/, cat: 'FOOD_DINING', sub: 'FOOD_PROTEIN' },
    { re: /\bchips\b|\bchocolate\b|\bbiscuit\b|\bcookie\b|\bnoodles\b|\bsnack\b/, cat: 'FOOD_DINING', sub: 'FOOD_SNACKS' },
    { re: /\bsoap\b|\bshampoo\b|\btoothpaste\b|\bdetergent\b|\bcleaner\b/, cat: 'SHOPPING', sub: 'SHOP_TOILETRIES' },
    { re: /\bnotebook\b|\bpen\b|\bpencil\b|\bstationery\b/, cat: 'SHOPPING', sub: 'SHOP_STATIONERY' },
    { re: /\bflask\b/, cat: 'SHOPPING', sub: 'SHOP_BOTTLES' },
    { re: /\bvegetable\b|\bpotato\b|\bonion\b|\btomato\b|\bcarrot\b|\bspinach\b|\blettuce\b/, cat: 'SHOPPING', sub: 'SHOP_GROCERIES' },
    { re: /\bmasala\b|\brice\b|\bdal\b|\bflour\b|\batta\b|\boil\b|\bsugar\b|\bsalt\b/, cat: 'SHOPPING', sub: 'SHOP_GROCERIES' }
  ];
  for (const r of rules) if (r.re.test(t)) return { category: r.cat, subcategory: r.sub };
  return null;
}

function categorizeMailItem(merchant: string, name: string): { category: string; subcategory: string } {
  const m = String(merchant || '').toUpperCase();
  if (m === 'SWIGGY' || m === 'ZOMATO' || m === 'EATCLUB' || m === 'DOMINOS') {
    return { category: 'FOOD_DINING', subcategory: 'FOOD_ONLINE_DELIVERY' };
  }
  if (m === 'UBER') {
    return { category: 'TRANSPORT', subcategory: 'TRANSPORT_CAB' };
  }
  if (m === 'BLINKIT' || m === 'SWIGGY_INSTAMART' || m === 'ZEPTO') {
    const c = categorizeInstamartItem(name);
    if (c) return c;
    return { category: 'SHOPPING', subcategory: 'SHOP_MISC' };
  }
  // fallback
  return { category: 'SHOPPING', subcategory: 'SHOP_MISC' };
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

  const range = monthRangeToMs(from, to);
  if (!range) throw new Error('bad_range');

  const ordersFp = path.join(baseDir, 'orders_parsed.json');
  const ordersDoc = JSON.parse(fs.readFileSync(ordersFp, 'utf8')) as any;
  const orders = Array.isArray(ordersDoc?.orders) ? ordersDoc.orders : [];

  // load existing cache rows for dedupe if present
  const cacheFp = path.join(baseDir, 'cache', `hisab_data_${from}_${to}.json`);
  let existing: any[] = [];
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFp, 'utf8')) as any;
    existing = Array.isArray(cache?.rows) ? cache.rows : [];
  } catch {
    existing = [];
  }

  // Build lookup: date -> list of {amount, merchant_code}
  const byDate = new Map<string, Array<{ amount: number; merchant: string }>>();
  for (const r of existing) {
    const d = String(r?.date || '');
    const amt = Number(r?.amount || 0);
    const merch = String(r?.merchant_code || '');
    if (!d || !amt) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push({ amount: amt, merchant: merch.toUpperCase() });
  }

  const withinBuffer = (d0: string, d1: string) => {
    const t0 = Date.parse(d0 + 'T00:00:00Z');
    const t1 = Date.parse(d1 + 'T00:00:00Z');
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
    const days = Math.abs(t0 - t1) / (24 * 60 * 60 * 1000);
    return days <= bufferDays;
  };

  const alreadyLogged = (dateIso: string, merchant: string, amount: number) => {
    // check any date within buffer
    for (const [d, list] of byDate.entries()) {
      if (!withinBuffer(d, dateIso)) continue;
      for (const x of list) {
        if (x.merchant && merchant && x.merchant !== merchant.toUpperCase()) continue;
        if (Math.abs(Number(x.amount) - amount) <= tol) return true;
      }
    }
    return false;
  };

  const outRows: any[] = [];
  let considered = 0;
  let skippedDup = 0;

  for (const o of orders) {
    const merchant = String(o?.merchant || '').toUpperCase();
    if (!merchant) continue;
    if (o?.parse_status && String(o.parse_status) !== 'ok') continue;

    const ms = Number(o?.internalDateMs || 0);
    if (!ms) continue;
    if (ms < range.start - bufferDays * 86400000 || ms >= range.endExclusive + bufferDays * 86400000) continue;

    const date = dateFromMsIST(ms);
    const items = parseItems(o);
    if (!items.length) continue;

    considered++;

    // Dedupe based on total (best-effort)
    const total = Number(o?.total || 0) || items.reduce((s, it) => s + it.amount, 0);
    if (alreadyLogged(date, merchant, total)) {
      skippedDup++;
      continue;
    }

    const group_id = `mail_${o.messageId || ''}_${Date.now()}`;

    for (const it of items) {
      const cat = categorizeMailItem(merchant, it.name);
      outRows.push({
        txn_id: `mail_${o.messageId || ''}_${Math.random().toString(16).slice(2)}`,
        group_id,
        date,
        type: 'EXPENSE',
        amount: it.amount,
        source: '',
        location: 'BENGALURU',
        merchant_code: merchant,
        category: cat.category,
        subcategory: cat.subcategory,
        tags: 'from_mail',
        beneficiary: '',
        reimb_status: '',
        counterparty: '',
        linked_txn_id: '',
        notes: `mail:${o.messageId || ''}`,
        raw_text: it.name,
        parse_status: 'mail_ingest',
        parse_error: '',
        messageId: o.messageId || ''
      });
    }
  }

  // Append
  const headers = [
    'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error',
    'messageId'
  ];

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { storeAppend } = require(path.join(process.cwd(), 'src', 'excel', 'workbook_store'));
  const outputs = storeAppend({ baseDir, headers, rows: outRows });

  // Auto rebuild dashboard cache for the same range (so UI updates without manual rebuild).
  const outJsonRel = path.join('cache', `hisab_data_${from}_${to}.json`);
  const outHtmlRel = path.join('cache', `hisab_dashboard_${from}_${to}.html`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require('node:child_process');
  const dashScript = path.join(process.cwd(), 'src', 'dashboard', 'build_dashboard.js');
  const dash = spawnSync(process.execPath, [dashScript, baseDir, outJsonRel, outHtmlRel], { encoding: 'utf8' });
  const rebuild = {
    ok: dash.status === 0,
    exitCode: dash.status,
    outJson: path.join(baseDir, outJsonRel),
    outHtml: path.join(baseDir, outHtmlRel),
    stderr: (dash.stderr || '').slice(0, 2000)
  };

  process.stdout.write(JSON.stringify({ ok: true, from, to, considered, skippedDup, imported: outRows.length, outputs, rebuild }, null, 2));
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err?.message || err) + '\n');
  process.exit(1);
});
