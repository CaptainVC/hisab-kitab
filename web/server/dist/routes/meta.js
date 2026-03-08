import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import { readJson } from '../storage/jsonStore.js';
export async function registerMetaRoutes(app, opts) {
    app.get('/api/v1/meta/sources', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const fp = path.join(opts.baseDir, 'refs', 'sources.json');
        const j = readJson(fp, {});
        const list = Object.entries(j)
            .map(([code, v]) => ({ code, display: String(v?.display || code) }))
            .sort((a, b) => a.display.localeCompare(b.display));
        return reply.send({ ok: true, sources: list });
    });
    app.get('/api/v1/meta/locations', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const fp = path.join(opts.baseDir, 'refs', 'locations.json');
        const j = readJson(fp, {});
        const list = Object.entries(j)
            .map(([code, v]) => ({ code, name: String(v?.name || code) }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return reply.send({ ok: true, locations: list });
    });
}
//# sourceMappingURL=meta.js.map