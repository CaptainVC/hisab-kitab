import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/session.js';
function cachePath(cacheDir, from, to) {
    return path.join(cacheDir, `hisab_data_${from}_${to}.json`);
}
export async function registerDataRoutes(app, opts) {
    app.get('/api/v1/data/summary', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
        const fp = cachePath(opts.cacheDir, from, to);
        if (!fs.existsSync(fp)) {
            return reply.code(404).send({ ok: false, error: 'cache_missing', cacheFile: fp });
        }
        const st = fs.statSync(fp);
        const age = Date.now() - st.mtimeMs;
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        let oldestDate = null;
        let newestDate = null;
        for (const r of rows) {
            const d = r?.date ? String(r.date) : '';
            if (!d)
                continue;
            if (!oldestDate || d < oldestDate)
                oldestDate = d;
            if (!newestDate || d > newestDate)
                newestDate = d;
        }
        return reply.send({
            ok: true,
            stale: age > opts.cacheFreshMs,
            ageMs: age,
            rows: rows.length,
            oldestDate,
            newestDate,
            generatedAt: data?.generatedAt || null
        });
    });
    app.get('/api/v1/data', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
        const fp = cachePath(opts.cacheDir, from, to);
        if (!fs.existsSync(fp)) {
            return reply.code(404).send({ ok: false, error: 'cache_missing', cacheFile: fp });
        }
        const st = fs.statSync(fp);
        const age = Date.now() - st.mtimeMs;
        if (age > opts.cacheFreshMs) {
            // still return data, but mark stale
            const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
            return reply.send({ ok: true, stale: true, ageMs: age, data });
        }
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        return reply.send({ ok: true, stale: false, ageMs: age, data });
    });
}
//# sourceMappingURL=data.js.map