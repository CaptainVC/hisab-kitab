import fs from 'node:fs';
import path from 'node:path';
function dateFromMsIST(ms) {
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
export function syncMailOrders(baseDir) {
    const ordersFp = path.join(baseDir, 'orders_parsed.json');
    const ordersDoc = readJson(ordersFp, null);
    const orders = Array.isArray(ordersDoc?.orders) ? ordersDoc.orders : [];
    // Respect enabled/disabled merchant rules (soft-disable): disabled merchants are ignored during sync.
    const rulesFp = path.join(baseDir, 'refs', 'email_merchants.json');
    const rules = readJson(rulesFp, {});
    const enabledMerchant = (code) => {
        const c = String(code || '').trim().toUpperCase();
        if (!c)
            return true;
        const r = rules?.[c];
        if (!r)
            return true; // if no rule exists, don't block
        if (r.enabled === undefined)
            return true;
        return !!r.enabled;
    };
    const storeFp = path.join(baseDir, 'staging', 'mail_orders.json');
    const store = readJson(storeFp, { schemaVersion: 1, orders: [] });
    const byMid = new Map(store.orders.map((o) => [o.messageId, o]));
    let added = 0;
    let updated = 0;
    for (const o of orders) {
        if (o?.parse_status && String(o.parse_status) !== 'ok')
            continue;
        const mid = String(o?.messageId || '').trim();
        if (!mid)
            continue;
        const merchant = String(o?.merchant || '').toUpperCase();
        if (!enabledMerchant(merchant))
            continue;
        const ms = Number(o?.internalDateMs || 0);
        if (!ms)
            continue;
        const items = parseItems(o);
        if (!items.length)
            continue;
        const total = Number(o?.total || 0) || items.reduce((s, it) => s + it.amount, 0);
        const date = dateFromMsIST(ms);
        const now = new Date().toISOString();
        const cur = byMid.get(mid);
        if (!cur) {
            const rec = {
                messageId: mid,
                merchant_code: merchant,
                date,
                total,
                items,
                pdfPath: String(o?.pdfPath || '') || undefined,
                status: 'unmatched',
                createdAt: now,
                updatedAt: now
            };
            store.orders.push(rec);
            byMid.set(mid, rec);
            added++;
        }
        else {
            // keep status/match as-is; refresh core facts
            cur.merchant_code = merchant;
            cur.date = date;
            cur.total = total;
            cur.items = items;
            cur.pdfPath = String(o?.pdfPath || '') || undefined;
            cur.updatedAt = now;
            updated++;
        }
    }
    // deterministic order
    store.orders.sort((a, b) => (a.date.localeCompare(b.date) || a.messageId.localeCompare(b.messageId)));
    writeJson(storeFp, store);
    return { storeFp, added, updated, total: store.orders.length };
}
// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    const baseDir = process.argv[2];
    if (!baseDir) {
        // eslint-disable-next-line no-console
        console.error('Usage: node mail_orders_sync.js <baseDir>');
        process.exit(1);
    }
    const r = syncMailOrders(baseDir);
    process.stdout.write(JSON.stringify({ ok: true, ...r }, null, 2));
    process.stdout.write('\n');
}
//# sourceMappingURL=mail_orders_sync.js.map