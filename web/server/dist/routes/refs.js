import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import { readJson, writeJson } from '../storage/jsonStore.js';
function refsPath(baseDir, name) {
    return path.join(baseDir, 'refs', name);
}
function monthRangeToMs(fromYm, toYm) {
    // from/to are inclusive months in YYYY-MM
    const [fy, fm] = fromYm.split('-').map(Number);
    const [ty, tm] = toYm.split('-').map(Number);
    if (!fy || !fm || !ty || !tm)
        return null;
    const start = Date.UTC(fy, fm - 1, 1, 0, 0, 0, 0);
    const endExclusive = Date.UTC(ty, tm, 1, 0, 0, 0, 0); // next month
    return { start, endExclusive };
}
export async function registerRefsRoutes(app, opts) {
    // Merchants
    app.get('/api/v1/refs/merchants', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const fp = refsPath(opts.baseDir, 'merchants.json');
        const merchants = readJson(fp, {});
        const list = Object.entries(merchants)
            .map(([code, m]) => ({ code, ...m }))
            .sort((a, b) => a.code.localeCompare(b.code));
        return reply.send({ ok: true, merchants: list });
    });
    app.put('/api/v1/refs/merchants/:code', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { code } = req.params;
        const c = String(code || '').trim();
        if (!c)
            return reply.code(400).send({ ok: false, error: 'missing_code' });
        const body = (req.body || {});
        const patch = {};
        if (body.name !== undefined)
            patch.name = String(body.name || '').trim();
        if (body.archived !== undefined)
            patch.archived = !!body.archived;
        if (body.defaultCategory !== undefined)
            patch.defaultCategory = body.defaultCategory ? String(body.defaultCategory) : undefined;
        if (body.defaultSubcategory !== undefined)
            patch.defaultSubcategory = body.defaultSubcategory ? String(body.defaultSubcategory) : undefined;
        if (body.defaultTags !== undefined)
            patch.defaultTags = Array.isArray(body.defaultTags) ? body.defaultTags.map(String) : undefined;
        const fp = refsPath(opts.baseDir, 'merchants.json');
        const merchants = readJson(fp, {});
        const cur = merchants[c] || { name: c };
        merchants[c] = { ...cur, ...patch };
        writeJson(fp, merchants);
        return reply.send({ ok: true, code: c, merchant: merchants[c] });
    });
    app.post('/api/v1/refs/merchants/:code/archive', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { code } = req.params;
        const c = String(code || '').trim();
        if (!c)
            return reply.code(400).send({ ok: false, error: 'missing_code' });
        const fp = refsPath(opts.baseDir, 'merchants.json');
        const merchants = readJson(fp, {});
        if (!merchants[c])
            return reply.code(404).send({ ok: false, error: 'not_found' });
        merchants[c].archived = true;
        writeJson(fp, merchants);
        return reply.send({ ok: true });
    });
    // Categories
    app.get('/api/v1/refs/categories', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const fp = refsPath(opts.baseDir, 'categories.json');
        const categories = readJson(fp, {});
        const list = Object.entries(categories)
            .map(([code, c]) => ({ code, ...c }))
            .sort((a, b) => a.code.localeCompare(b.code));
        return reply.send({ ok: true, categories: list });
    });
    app.put('/api/v1/refs/categories/:code', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { code } = req.params;
        const c = String(code || '').trim();
        if (!c)
            return reply.code(400).send({ ok: false, error: 'missing_code' });
        const body = (req.body || {});
        const patch = {};
        if (body.name !== undefined)
            patch.name = String(body.name || '').trim();
        if (body.archived !== undefined)
            patch.archived = !!body.archived;
        const fp = refsPath(opts.baseDir, 'categories.json');
        const cats = readJson(fp, {});
        const cur = cats[c] || { name: c };
        cats[c] = { ...cur, ...patch };
        writeJson(fp, cats);
        return reply.send({ ok: true, code: c, category: cats[c] });
    });
    app.post('/api/v1/refs/categories/:code/archive', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { code } = req.params;
        const c = String(code || '').trim();
        if (!c)
            return reply.code(400).send({ ok: false, error: 'missing_code' });
        const fp = refsPath(opts.baseDir, 'categories.json');
        const cats = readJson(fp, {});
        if (!cats[c])
            return reply.code(404).send({ ok: false, error: 'not_found' });
        cats[c].archived = true;
        writeJson(fp, cats);
        return reply.send({ ok: true });
    });
    // Subcategories
    app.get('/api/v1/refs/subcategories', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const fp = refsPath(opts.baseDir, 'subcategories.json');
        const subs = readJson(fp, {});
        const list = Object.entries(subs)
            .map(([code, s]) => ({ code, ...s }))
            .sort((a, b) => a.code.localeCompare(b.code));
        return reply.send({ ok: true, subcategories: list });
    });
    app.put('/api/v1/refs/subcategories/:code', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { code } = req.params;
        const c = String(code || '').trim();
        if (!c)
            return reply.code(400).send({ ok: false, error: 'missing_code' });
        const body = (req.body || {});
        const patch = {};
        if (body.name !== undefined)
            patch.name = String(body.name || '').trim();
        if (body.category !== undefined)
            patch.category = String(body.category || '').trim();
        if (body.archived !== undefined)
            patch.archived = !!body.archived;
        const fp = refsPath(opts.baseDir, 'subcategories.json');
        const subs = readJson(fp, {});
        const cur = subs[c] || { name: c, category: patch.category || '' };
        subs[c] = { ...cur, ...patch };
        if (!subs[c].category)
            subs[c].category = '';
        writeJson(fp, subs);
        return reply.send({ ok: true, code: c, subcategory: subs[c] });
    });
    app.post('/api/v1/refs/subcategories/:code/archive', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { code } = req.params;
        const c = String(code || '').trim();
        if (!c)
            return reply.code(400).send({ ok: false, error: 'missing_code' });
        const fp = refsPath(opts.baseDir, 'subcategories.json');
        const subs = readJson(fp, {});
        if (!subs[c])
            return reply.code(404).send({ ok: false, error: 'not_found' });
        subs[c].archived = true;
        writeJson(fp, subs);
        return reply.send({ ok: true });
    });
    // Email rules view-only
    app.get('/api/v1/refs/email_rules', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const merchants = readJson(refsPath(opts.baseDir, 'email_merchants.json'), {});
        const payments = readJson(refsPath(opts.baseDir, 'email_payments.json'), {});
        return reply.send({ ok: true, merchants, payments });
    });
    // Merchant email coverage (derived from HisabKitab labeled parsed outputs)
    app.get('/api/v1/refs/merchants/coverage', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        const range = from && to ? monthRangeToMs(from, to) : null;
        const ordersFp = path.join(opts.baseDir, 'orders_parsed.json');
        const orders = readJson(ordersFp, null);
        const list = Array.isArray(orders?.orders) ? orders.orders : [];
        const counts = {};
        for (const o of list) {
            const m = String(o?.merchant || '').trim();
            if (!m)
                continue;
            const ms = Number(o?.internalDateMs || 0);
            if (range) {
                if (!ms)
                    continue;
                if (ms < range.start || ms >= range.endExclusive)
                    continue;
            }
            if (!counts[m])
                counts[m] = { count: 0, lastMs: 0 };
            counts[m].count++;
            if (ms && ms > counts[m].lastMs)
                counts[m].lastMs = ms;
        }
        const merchants = readJson(refsPath(opts.baseDir, 'merchants.json'), {});
        const ruleMerchants = readJson(refsPath(opts.baseDir, 'email_merchants.json'), {});
        const out = Object.keys(merchants).sort().map((code) => {
            const seen = counts[code];
            const lastEmailAt = seen?.lastMs ? new Date(seen.lastMs).toISOString() : null;
            const emailSeenCount = seen?.count || 0;
            const ruleConfigured = !!(ruleMerchants && (ruleMerchants[code] || ruleMerchants[String(code).toLowerCase()]));
            const emailSupport = emailSeenCount > 0 ? 'YES' : 'NO';
            return {
                code,
                emailSupport,
                emailSeenCount,
                lastEmailAt,
                parsersUsed: [],
                ruleConfigured,
            };
        });
        return reply.send({ ok: true, from: from || null, to: to || null, coverage: out });
    });
}
//# sourceMappingURL=refs.js.map