import fs from 'node:fs';
import { requireAuth } from '../auth/session.js';
export async function registerJobRoutes(app, opts) {
    app.get('/api/v1/jobs', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        return reply.send({ ok: true, jobs: opts.runner.listJobs(50) });
    });
    app.get('/api/v1/jobs/:jobId', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { jobId } = req.params;
        const job = opts.runner.getJob(String(jobId));
        if (!job)
            return reply.code(404).send({ ok: false, error: 'not_found' });
        return reply.send({ ok: true, job });
    });
    app.get('/api/v1/jobs/:jobId/log', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { jobId } = req.params;
        const job = opts.runner.getJob(String(jobId));
        if (!job)
            return reply.code(404).send({ ok: false, error: 'not_found' });
        if (!fs.existsSync(job.logFile))
            return reply.send({ ok: true, log: '' });
        const offset = Number(req.query?.offset || 0);
        const buf = fs.readFileSync(job.logFile);
        const slice = buf.subarray(Math.max(0, offset));
        return reply.send({ ok: true, offset, nextOffset: buf.length, log: slice.toString('utf8') });
    });
}
//# sourceMappingURL=jobs.js.map