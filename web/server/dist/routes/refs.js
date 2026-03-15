import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import { readJson, writeJson } from '../storage/jsonStore.js';
function refsPath(baseDir, name) {
    return path.join(baseDir, 'refs', name);
}
import { parseRangeToMs } from '../utils/range.js';
export async function registerRefsRoutes(app, opts) {
    function refsRepoDir() {
        return path.join(opts.baseDir, 'refs');
    }
    async function queueRefsGitSync(reason) {
        const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'refs_git_sync.js');
        const args = [
            script,
            '--refs-dir', refsRepoDir(),
            '--branch', 'main',
            '--message', `refs: ${reason}`
        ];
        try {
            await opts.runner.startJob('refsGitSync', { reason }, process.execPath, args, { cwd: opts.repoDir });
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running')
                return;
            // non-fatal; refs changes are still saved locally
        }
    }
    // Overview (oldest data in range for email-derived datasets)
    app.get('/api/v1/refs/overview', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        const range = from && to ? parseRangeToMs(from, to) : null;
        const ordersFp = path.join(opts.baseDir, 'orders_parsed.json');
        const paymentsFp = path.join(opts.baseDir, 'payments_parsed.json');
        const ordersJ = readJson(ordersFp, null);
        const paymentsJ = readJson(paymentsFp, null);
        const orders = Array.isArray(ordersJ?.orders) ? ordersJ.orders : [];
        const payments = Array.isArray(paymentsJ?.payments) ? paymentsJ.payments : [];
        const inRange = (x) => {
            const ms = Number(x?.internalDateMs || 0);
            if (!range)
                return true;
            if (!ms)
                return false;
            return ms >= range.start && ms < range.endExclusive;
        };
        const o2 = orders.filter(inRange);
        const p2 = payments.filter(inRange);
        const oldestOrderMs = o2.reduce((min, o) => {
            const ms = Number(o?.internalDateMs || 0);
            if (!ms)
                return min;
            if (min === null)
                return ms;
            return ms < min ? ms : min;
        }, null);
        const oldestPaymentMs = p2.reduce((min, p) => {
            const ms = Number(p?.internalDateMs || 0);
            if (!ms)
                return min;
            if (min === null)
                return ms;
            return ms < min ? ms : min;
        }, null);
        return reply.send({ ok: true, from: from || null, to: to || null, oldestOrderMs, oldestPaymentMs });
    });
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
        // default mappings
        if (body.default !== undefined && body.default && typeof body.default === 'object') {
            const d = body.default;
            patch.default = {
                category: d.category !== undefined ? String(d.category || '') : undefined,
                subcategory: d.subcategory !== undefined ? String(d.subcategory || '') : undefined,
                tags: Array.isArray(d.tags) ? d.tags.map(String) : undefined
            };
        }
        else {
            // allow flat keys too
            const hasFlat = body.defaultCategory !== undefined || body.defaultSubcategory !== undefined || body.defaultTags !== undefined;
            if (hasFlat) {
                patch.default = {
                    category: body.defaultCategory !== undefined ? String(body.defaultCategory || '') : undefined,
                    subcategory: body.defaultSubcategory !== undefined ? String(body.defaultSubcategory || '') : undefined,
                    tags: Array.isArray(body.defaultTags) ? body.defaultTags.map(String) : undefined
                };
            }
        }
        const fp = refsPath(opts.baseDir, 'merchants.json');
        const merchants = readJson(fp, {});
        const cur = merchants[c] || { name: c };
        const next = { ...cur, ...patch };
        // merge default object instead of clobbering
        if (patch.default) {
            next.default = { ...(cur.default || {}), ...(patch.default || {}) };
        }
        merchants[c] = next;
        writeJson(fp, merchants);
        await queueRefsGitSync(`update merchant ${c}`);
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
        await queueRefsGitSync(`archive merchant ${c}`);
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
        await queueRefsGitSync(`update category ${c}`);
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
        await queueRefsGitSync(`archive category ${c}`);
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
        await queueRefsGitSync(`update subcategory ${c}`);
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
        await queueRefsGitSync(`archive subcategory ${c}`);
        return reply.send({ ok: true });
    });
    // Email rules
    app.get('/api/v1/refs/email_rules', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const merchants = readJson(refsPath(opts.baseDir, 'email_merchants.json'), {});
        const payments = readJson(refsPath(opts.baseDir, 'email_payments.json'), {});
        return reply.send({ ok: true, merchants, payments });
    });
    // Toggle a merchant in email_merchants.json (controls which labeled emails get parsed)
    app.post('/api/v1/refs/email_rules/merchants/:code/enabled', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { code } = req.params;
        const c = String(code || '').trim().toUpperCase();
        if (!c)
            return reply.code(400).send({ ok: false, error: 'missing_code' });
        const body = (req.body || {});
        const enabled = body.enabled;
        if (enabled === undefined)
            return reply.code(400).send({ ok: false, error: 'missing_enabled' });
        const fp = refsPath(opts.baseDir, 'email_merchants.json');
        const rules = readJson(fp, {});
        if (!rules[c])
            return reply.code(404).send({ ok: false, error: 'not_found' });
        rules[c].enabled = !!enabled;
        writeJson(fp, rules);
        await queueRefsGitSync(`toggle email merchant ${c} ${rules[c].enabled ? 'on' : 'off'}`);
        return reply.send({ ok: true, code: c, enabled: !!rules[c].enabled });
    });
    // Git sync status (refs are a git working tree)
    app.get('/api/v1/refs/syncStatus', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const refsDir = refsRepoDir();
        const statusFp = path.join(refsDir, '.sync_status.json');
        let status = null;
        try {
            status = JSON.parse(fs.readFileSync(statusFp, 'utf8'));
        }
        catch {
            status = null;
        }
        // also include current dirty flag
        let dirty = null;
        try {
            const r = await (async () => {
                const { spawnSync } = await import('node:child_process');
                const x = spawnSync('git', ['status', '--porcelain'], { cwd: refsDir, encoding: 'utf8' });
                return { ok: x.status === 0, out: String(x.stdout || '') };
            })();
            dirty = r.ok ? r.out.trim().length > 0 : null;
        }
        catch {
            dirty = null;
        }
        return reply.send({ ok: true, refsDir, dirty, status });
    });
    // Trigger git sync now
    app.post('/api/v1/refs/syncNow', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        await queueRefsGitSync('sync now');
        return reply.send({ ok: true });
    });
    // Merchant email coverage (derived from HisabKitab labeled parsed outputs)
    app.get('/api/v1/refs/merchants/coverage', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        const range = from && to ? parseRangeToMs(from, to) : null;
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