import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function getArg(args, name) {
    const i = args.indexOf(name);
    if (i === -1)
        return null;
    return args[i + 1] ?? null;
}
function monthRangeToMs(fromYm, toYm) {
    const [fy, fm] = fromYm.split('-').map(Number);
    const [ty, tm] = toYm.split('-').map(Number);
    if (!fy || !fm || !ty || !tm)
        return null;
    const start = Date.UTC(fy, fm - 1, 1, 0, 0, 0, 0);
    const endExclusive = Date.UTC(ty, tm, 1, 0, 0, 0, 0);
    return { start, endExclusive };
}
function dateFromMsIST(ms) {
    // Compute YYYY-MM-DD in IST without luxon dependency (keep script small)
    // IST = UTC+5:30
    const ist = ms + (5.5 * 60 * 60 * 1000);
    return new Date(ist).toISOString().slice(0, 10);
}
function parseItems(order) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const out = [];
    for (const it of items) {
        const name = String(it?.name || it?.title || '').trim();
        const amt = Number(it?.total ?? it?.amount ?? 0);
        if (!name || !amt)
            continue;
        out.push({ name, amount: amt });
    }
    return out;
}
function categorizeInstamartItem(name) {
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
    for (const r of rules)
        if (r.re.test(t))
            return { category: r.cat, subcategory: r.sub };
    return null;
}
function categorizeMailItem(merchant, name) {
    const m = String(merchant || '').toUpperCase();
    if (m === 'SWIGGY' || m === 'ZOMATO' || m === 'EATCLUB' || m === 'DOMINOS') {
        return { category: 'FOOD_DINING', subcategory: 'FOOD_ONLINE_DELIVERY' };
    }
    if (m === 'UBER') {
        return { category: 'TRANSPORT', subcategory: 'TRANSPORT_CAB' };
    }
    if (m === 'BLINKIT' || m === 'SWIGGY_INSTAMART' || m === 'ZEPTO') {
        const c = categorizeInstamartItem(name);
        if (c)
            return c;
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
    if (!baseDir)
        throw new Error('missing_base_dir');
    if (!from || !to)
        throw new Error('missing_range');
    const range = monthRangeToMs(from, to);
    if (!range)
        throw new Error('bad_range');
    const ordersFp = path.join(baseDir, 'orders_parsed.json');
    const ordersDoc = JSON.parse(fs.readFileSync(ordersFp, 'utf8'));
    const orders = Array.isArray(ordersDoc?.orders) ? ordersDoc.orders : [];
    // load existing cache rows for dedupe if present
    const cacheFp = path.join(baseDir, 'cache', `hisab_data_${from}_${to}.json`);
    let existing = [];
    try {
        const cache = JSON.parse(fs.readFileSync(cacheFp, 'utf8'));
        existing = Array.isArray(cache?.rows) ? cache.rows : [];
    }
    catch {
        existing = [];
    }
    // Build lookup: date -> list of existing txns (for dedupe/cross-ref)
    const byDate = new Map();
    for (const r of existing) {
        const d = String(r?.date || '');
        const amt = Number(r?.amount || 0);
        const type = String(r?.type || '');
        const merch = String(r?.merchant_code || '');
        const source = String(r?.source || '');
        const tags = String(r?.tags || '');
        const txn_id = String(r?.txn_id || '');
        if (!d || !amt)
            continue;
        if (!byDate.has(d))
            byDate.set(d, []);
        byDate.get(d).push({ txn_id, amount: amt, type, merchant: merch.toUpperCase(), source, tags });
    }
    const withinBuffer = (d0, d1) => {
        const t0 = Date.parse(d0 + 'T00:00:00Z');
        const t1 = Date.parse(d1 + 'T00:00:00Z');
        if (!Number.isFinite(t0) || !Number.isFinite(t1))
            return false;
        const days = Math.abs(t0 - t1) / (24 * 60 * 60 * 1000);
        return days <= bufferDays;
    };
    const findMatch = (dateIso, amount) => {
        // check any date within buffer
        for (const [d, list] of byDate.entries()) {
            if (!withinBuffer(d, dateIso))
                continue;
            for (const x of list) {
                if (String(x.type || '').toUpperCase() !== 'EXPENSE')
                    continue;
                if (Math.abs(Number(x.amount) - amount) <= tol)
                    return x;
            }
        }
        return null;
    };
    const outRows = [];
    let considered = 0;
    let skippedDup = 0;
    const alreadyImportedMessageIds = new Set(existing.map((r) => String(r?.messageId || '')).filter(Boolean));
    const supersedePatches = [];
    for (const o of orders) {
        const merchant = String(o?.merchant || '').toUpperCase();
        if (!merchant)
            continue;
        if (o?.parse_status && String(o.parse_status) !== 'ok')
            continue;
        const ms = Number(o?.internalDateMs || 0);
        if (!ms)
            continue;
        if (ms < range.start - bufferDays * 86400000 || ms >= range.endExclusive + bufferDays * 86400000)
            continue;
        const date = dateFromMsIST(ms);
        const items = parseItems(o);
        if (!items.length)
            continue;
        // Skip if this email was already ingested earlier.
        const mid = String(o?.messageId || '');
        if (mid && alreadyImportedMessageIds.has(mid)) {
            skippedDup++;
            continue;
        }
        considered++;
        // Cross-reference with an existing Hisab expense entry (overall txn) to inherit its payment source.
        // IMPORTANT: If no match is found, we do NOT import to Excel (to avoid duplicates).
        const total = Number(o?.total || 0) || items.reduce((s, it) => s + it.amount, 0);
        const match = findMatch(date, total);
        if (!match) {
            skippedDup++;
            continue;
        }
        const group_id = `mail_${mid || ''}_${Date.now()}`;
        const inheritedSource = String(match?.source || '').trim() || 'UNKNOWN';
        const linkedTxnId = String(match?.txn_id || '').trim();
        if (linkedTxnId) {
            const curTags = String(match?.tags || '');
            const parts = curTags.split(',').map(s => s.trim()).filter(Boolean);
            if (!parts.includes('superseded'))
                parts.push('superseded');
            supersedePatches.push({ txn_id: linkedTxnId, tags: parts.join(',') });
        }
        for (const it of items) {
            const cat = categorizeMailItem(merchant, it.name);
            outRows.push({
                txn_id: `mail_${mid || ''}_${Math.random().toString(16).slice(2)}`,
                group_id,
                date,
                type: 'EXPENSE',
                amount: it.amount,
                source: inheritedSource,
                location: 'BENGALURU',
                merchant_code: merchant,
                category: cat.category,
                subcategory: cat.subcategory,
                tags: 'from_mail',
                beneficiary: '',
                reimb_status: '',
                counterparty: '',
                linked_txn_id: linkedTxnId,
                notes: `mail:${mid}`,
                raw_text: it.name,
                parse_status: match ? 'mail_ingest_matched' : 'mail_ingest',
                parse_error: '',
                messageId: mid
            });
        }
    }
    // Append
    const headers = [
        'txn_id', 'group_id', 'date', 'type', 'amount', 'source', 'location', 'merchant_code', 'category', 'subcategory', 'tags',
        'beneficiary', 'reimb_status', 'counterparty', 'linked_txn_id', 'notes', 'raw_text', 'parse_status', 'parse_error',
        'messageId'
    ];
    // CommonJS module
    const { storeAppend } = require(path.join(process.cwd(), 'src', 'excel', 'workbook_store'));
    const outputs = storeAppend({ baseDir, headers, rows: outRows });
    // Mark matched overall Hisab transactions as superseded (excluded from dashboard) to avoid double counting.
    const patchedTxnIds = new Set();
    for (const p of supersedePatches) {
        if (!p.txn_id || patchedTxnIds.has(p.txn_id))
            continue;
        patchedTxnIds.add(p.txn_id);
        const patchFile = path.join(baseDir, 'cache', `txn_patch_${p.txn_id}_${Date.now()}.json`);
        fs.mkdirSync(path.dirname(patchFile), { recursive: true });
        fs.writeFileSync(patchFile, JSON.stringify({ tags: p.tags, parse_status: 'superseded_by_mail' }, null, 2), 'utf8');
        const editScript = path.join(process.cwd(), 'web', 'server', 'dist', 'scripts', 'edit_txn.js');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { spawnSync } = require('node:child_process');
        const er = spawnSync(process.execPath, [editScript, '--base-dir', baseDir, '--txn-id', p.txn_id, '--patch-file', patchFile], { encoding: 'utf8' });
        if (er.status !== 0) {
            // non-fatal; continue
        }
    }
    // Auto rebuild dashboard cache for the same range (so UI updates without manual rebuild).
    const outJsonRel = path.join('cache', `hisab_data_${from}_${to}.json`);
    const outHtmlRel = path.join('cache', `hisab_dashboard_${from}_${to}.html`);
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
//# sourceMappingURL=ingest_orders_to_excel.js.map