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
import { JobRunner } from './jobs/jobRunner.js';
const appVersion = process.env.HK_APP_VERSION || 'dev';
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
    await registerHealthRoutes(app, { appVersion });
    await registerAuthRoutes(app, { authFile: cfg.authFile });
    await registerJobRoutes(app, { runner });
    await registerDataRoutes(app, { cacheDir: cfg.cacheDir, cacheFreshMs: cfg.cacheFreshMs });
    // Repo dir = monorepo root
    const repoDir = path.resolve(path.join(import.meta.dirname, '..', '..', '..'));
    await registerIngestRoutes(app, { runner, baseDir: cfg.baseDir, repoDir });
    await registerRebuildRoutes(app, { runner, baseDir: cfg.baseDir, repoDir, cacheDir: cfg.cacheDir });
    // Serve frontend build (once we build it)
    const clientDist = path.join(repoDir, 'web', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
        await app.register(staticPlugin, {
            root: clientDist,
            prefix: '/',
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