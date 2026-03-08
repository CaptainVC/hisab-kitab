import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import type { JobRunner } from '../jobs/jobRunner.js';

export async function registerRebuildRoutes(app: FastifyInstance, opts: { runner: JobRunner; baseDir: string; repoDir: string; cacheDir: string }) {
  app.post('/api/v1/rebuild', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as any;
    const from = String(body.from || '');
    const to = String(body.to || '');
    if (!from || !to) return reply.code(400).send({ ok: false, error: 'missing_range' });

    // build_dashboard.js treats output paths as relative to baseDir.
    // So we pass relative outputs and then refer to absolute files via cacheDir in API reads.
    const { rangeKey } = await import('../utils/rangeKey.js');
    const key = rangeKey(from, to);
    const outJsonRel = path.join('cache', `hisab_data_${key}.json`);
    const outHtmlRel = path.join('cache', `hisab_dashboard_${key}.html`);
    const outJsonAbs = path.join(opts.baseDir, outJsonRel);
    const outHtmlAbs = path.join(opts.baseDir, outHtmlRel);

    const dashScript = path.join(opts.repoDir, 'src', 'dashboard', 'build_dashboard.js');

    const args = [
      dashScript,
      opts.baseDir,
      outJsonRel,
      outHtmlRel
    ];

    try {
      const job = await opts.runner.startJob('rebuild', { from, to, outJson: outJsonAbs, outHtml: outHtmlAbs }, process.execPath, args);
      return reply.send({ ok: true, jobId: job.jobId, outJson: outJsonAbs, outHtml: outHtmlAbs });
    } catch (e: any) {
      if (String(e?.message || e) === 'job_already_running') {
        return reply.code(409).send({ ok: false, error: 'job_already_running' });
      }
      return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
    }
  });
}
