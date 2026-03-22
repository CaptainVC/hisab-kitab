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
function readJson(fp, fallback) {
    try {
        return JSON.parse(fs.readFileSync(fp, 'utf8'));
    }
    catch {
        return fallback;
    }
}
function writeJson(fp, obj) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8');
}
function listQuarterlyFiles(baseDir) {
    const files = fs.readdirSync(baseDir).filter((f) => /^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f));
    return files.map((f) => path.join(baseDir, f));
}
function parseTags(tags) {
    return String(tags || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
function hasTag(tags, t) {
    return parseTags(tags).map((x) => x.toLowerCase()).includes(String(t).toLowerCase());
}
function daysBetween(a, b) {
    const t0 = Date.parse(a + 'T00:00:00Z');
    const t1 = Date.parse(b + 'T00:00:00Z');
    if (!Number.isFinite(t0) || !Number.isFinite(t1))
        return null;
    return Math.round((t1 - t0) / 86400000);
}
function inRange(d, start, end) {
    return d >= start && d <= end;
}
function loadMailOrders(baseDir, merchantCode, from, to) {
    const fp = path.join(baseDir, 'staging', 'mail_orders.json');
    const store = readJson(fp, { schemaVersion: 1, orders: [] });
    const orders = Array.isArray(store.orders) ? store.orders : [];
    return orders
        .filter((o) => String(o?.merchant_code || '').toUpperCase() === merchantCode)
        .map((o) => {
        const items = Array.isArray(o.items) ? o.items : [];
        return {
            messageId: String(o.messageId || ''),
            date: String(o.date || '').slice(0, 10),
            total: Number(o.total || 0),
            items: items
                .map((it) => ({ name: String(it.name || it.title || '').trim(), amount: Number(it.amount || it.total || 0) }))
                .filter((it) => it.name && Number.isFinite(it.amount) && it.amount > 0),
            merchant_code: merchantCode
        };
    })
        .filter((o) => o.date && Number.isFinite(o.total) && o.total > 0)
        .filter((o) => inRange(o.date, from, to));
}
function loadTxnCandidates(baseDir, merchantCode, from, to, includeRawMention) {
    const XLSX = require('xlsx');
    const files = listQuarterlyFiles(baseDir);
    const reMention = new RegExp(`\\b${merchantCode.toLowerCase()}\\b`, 'i');
    const out = [];
    for (const fp of files) {
        const wb = XLSX.readFile(fp);
        for (const sheet of wb.SheetNames) {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
            if (!rows.length)
                continue;
            for (const r of rows) {
                const date = String(r.date || '').slice(0, 10);
                if (!date || !inRange(date, from, to))
                    continue;
                const tags = String(r.tags || '');
                if (hasTag(tags, 'archived') || hasTag(tags, 'superseded'))
                    continue;
                // normalize: transfer-category rows should be treated as TRANSFER
                const rowCat = String(r.category || '');
                const rowCatName = String(r.category_name || '');
                const normType = (rowCat === 'TRANSFER' || rowCatName === 'Transfers') ? 'TRANSFER' : String(r.type || '');
                if (String(normType).toUpperCase() !== 'EXPENSE')
                    continue;
                const amt = Number(r.amount || 0);
                if (!Number.isFinite(amt) || amt === 0)
                    continue;
                const mc = String(r.merchant_code || '').trim().toUpperCase();
                const raw = String(r.raw_text || '');
                const notes = String(r.notes || '');
                const mention = includeRawMention ? (reMention.test(raw) || reMention.test(notes)) : false;
                if (mc === merchantCode || (!mc && mention)) {
                    out.push({
                        txn_id: String(r.txn_id || ''),
                        date,
                        amount: amt,
                        merchant_code: mc,
                        raw_text: raw,
                        notes,
                        source: String(r.source || ''),
                        location: String(r.location || ''),
                        file: path.basename(fp),
                        sheet
                    });
                }
            }
        }
    }
    return out;
}
function reconcile(mailOrders, txns, bufferDays, tol) {
    const byDate = new Map();
    for (const t of txns) {
        if (!byDate.has(t.date))
            byDate.set(t.date, []);
        byDate.get(t.date).push(t);
    }
    function datesWithin(dateIso) {
        const out = [];
        for (const d of byDate.keys()) {
            const dd = daysBetween(dateIso, d);
            if (dd === null)
                continue;
            if (Math.abs(dd) <= bufferDays)
                out.push({ date: d, dd });
        }
        out.sort((a, b) => Math.abs(a.dd) - Math.abs(b.dd));
        return out;
    }
    const rows = [];
    for (const mo of mailOrders) {
        const candidates = [];
        for (const { date, dd } of datesWithin(mo.date)) {
            for (const t of byDate.get(date) || []) {
                const diff = Number(t.amount) - Number(mo.total);
                if (Math.abs(diff) <= tol) {
                    const boost = t.merchant_code ? 1 : 0;
                    candidates.push({ txn: t, dayDelta: dd, amtDelta: diff, boost });
                }
            }
        }
        candidates.sort((a, b) => (b.boost - a.boost) || (Math.abs(a.amtDelta) - Math.abs(b.amtDelta)) || (Math.abs(a.dayDelta) - Math.abs(b.dayDelta)));
        if (!candidates.length) {
            rows.push({ status: 'unmatched', mail: mo });
            continue;
        }
        if (candidates.length === 1) {
            rows.push({ status: 'matched', mail: mo, match: candidates[0] });
            continue;
        }
        const c0 = candidates[0];
        const c1 = candidates[1];
        const s0 = (Math.abs(c0.amtDelta) * 10 + Math.abs(c0.dayDelta)) - c0.boost * 5;
        const s1 = (Math.abs(c1.amtDelta) * 10 + Math.abs(c1.dayDelta)) - c1.boost * 5;
        if (s0 + 2 < s1) {
            rows.push({ status: 'matched', mail: mo, match: c0, note: 'clear_best' });
        }
        else {
            rows.push({ status: 'ambiguous', mail: mo, candidates: candidates.slice(0, 5).map((c) => ({
                    txn_id: c.txn.txn_id,
                    date: c.txn.date,
                    amount: c.txn.amount,
                    merchant_code: c.txn.merchant_code,
                    raw_text: c.txn.raw_text,
                    source: c.txn.source,
                    location: c.txn.location,
                    file: c.txn.file,
                    sheet: c.txn.sheet,
                    dayDelta: c.dayDelta,
                    amtDelta: c.amtDelta,
                    boost: c.boost
                })) });
        }
    }
    return rows;
}
async function main() {
    const args = process.argv.slice(2);
    const baseDir = String(getArg(args, '--base-dir') || '');
    const merchant = String(getArg(args, '--merchant-code') || '').trim().toUpperCase();
    const from = String(getArg(args, '--from') || '');
    const to = String(getArg(args, '--to') || '');
    const bufferDays = Number(getArg(args, '--buffer-days') || 3);
    const tol = Number(getArg(args, '--tol') || 10);
    const includeRawMention = String(getArg(args, '--include-raw-mention') || '1') !== '0';
    const enableSplitSuggestions = String(getArg(args, '--enable-split-suggestions') || '0') === '1';
    const reportId = String(getArg(args, '--report-id') || '').trim();
    if (!baseDir)
        throw new Error('missing_base_dir');
    if (!merchant)
        throw new Error('missing_merchant');
    if (!from || !to)
        throw new Error('missing_range');
    if (!reportId)
        throw new Error('missing_report_id');
    const mailOrders = loadMailOrders(baseDir, merchant, from, to);
    const txns = loadTxnCandidates(baseDir, merchant, from, to, includeRawMention);
    const rows = reconcile(mailOrders, txns, bufferDays, tol);
    const summary = {
        mailOrders: mailOrders.length,
        txnCandidates: txns.length,
        matched: rows.filter((r) => r.status === 'matched').length,
        ambiguous: rows.filter((r) => r.status === 'ambiguous').length,
        unmatched: rows.filter((r) => r.status === 'unmatched').length
    };
    const outFp = path.join(baseDir, 'cache', 'reconcile', `${reportId}.json`);
    writeJson(outFp, {
        ok: true,
        reportId,
        merchant_code: merchant,
        from,
        to,
        bufferDays,
        tol,
        includeRawMention,
        enableSplitSuggestions,
        generatedAt: new Date().toISOString(),
        summary,
        rows
    });
    process.stdout.write(JSON.stringify({ ok: true, reportId, out: outFp, summary }, null, 2));
    process.stdout.write('\n');
}
main().catch((err) => {
    process.stderr.write(String(err?.stack || err?.message || err) + '\n');
    process.exit(1);
});
//# sourceMappingURL=mail_reconcile.js.map