import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { getTailscaleIPv4 } from './util/tailscale.js';
import { ensureAuthFile } from './auth/authStore.js';
import { sessionPlugin } from './auth/session.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerDataRoutes } from './routes/data.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerRebuildRoutes } from './routes/rebuild.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerStagingRoutes } from './routes/staging.js';
import { registerRefsRoutes } from './routes/refs.js';
import { registerMailRoutes } from './routes/mail.js';
import { JobRunner } from './jobs/jobRunner.js';
const appVersion = process.env.HK_APP_VERSION || 'dev';
const startedAt = new Date().toISOString();
async function main() {
    const cfg = loadConfig();
    fs.mkdirSync(cfg.cacheDir, { recursive: true });
    fs.mkdirSync(cfg.reportsDir, { recursive: true });
    fs.mkdirSync(cfg.stagingDir, { recursive: true });
    await ensureAuthFile(cfg.authFile);
    const bindHost = cfg.bindHost || getTailscaleIPv4();
    if (!bindHost) {
        throw new Error('No tailscale0 IPv4 found. Set HK_BIND_HOST explicitly if needed.');
    }
    const app = Fastify({ logger: true });
    await app.register(sessionPlugin, { cookieSecret: cfg.cookieSecret });
    const runner = new JobRunner(path.join(cfg.reportsDir, 'jobs'));
    await registerHealthRoutes(app, { appVersion, startedAt });
    await registerAuthRoutes(app, { authFile: cfg.authFile, sessionMaxAgeDays: cfg.sessionMaxAgeDays });
    await registerJobRoutes(app, { runner });
    await registerDataRoutes(app, { cacheDir: cfg.cacheDir, cacheFreshMs: cfg.cacheFreshMs });
    // Repo dir = monorepo root
    const repoDir = path.resolve(path.join(import.meta.dirname, '..', '..', '..'));
    await registerIngestRoutes(app, { runner, baseDir: cfg.baseDir, repoDir });
    await registerRebuildRoutes(app, { runner, baseDir: cfg.baseDir, repoDir, cacheDir: cfg.cacheDir });
    await registerReviewRoutes(app, { cacheDir: cfg.cacheDir, reviewStateFile: cfg.reviewStateFile });
    await registerStagingRoutes(app, { runner, baseDir: cfg.baseDir, repoDir, stagingDir: cfg.stagingDir });
    await registerRefsRoutes(app, { baseDir: cfg.baseDir });
    await registerMailRoutes(app, { baseDir: cfg.baseDir });
    // Serve frontend build (once we build it)
    const clientDist = path.join(repoDir, 'web', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
        await app.register(staticPlugin, {
            root: clientDist,
            prefix: '/',
        });
        // SPA fallback: on hard-refresh of /dashboard etc, serve index.html
        const indexHtml = path.join(clientDist, 'index.html');
        app.setNotFoundHandler(async (req, reply) => {
            const url = String(req.url || '');
            if (req.method === 'GET' && !url.startsWith('/api/') && fs.existsSync(indexHtml)) {
                reply.type('text/html').send(fs.readFileSync(indexHtml, 'utf8'));
                return;
            }
            reply.code(404).send({ message: `Route ${req.method}:${url} not found`, error: 'Not Found', statusCode: 404 });
        });
    }
    await app.listen({ host: bindHost, port: cfg.port });
    app.log.info({ bindHost, port: cfg.port }, 'Hisab Kitab web server listening');
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map