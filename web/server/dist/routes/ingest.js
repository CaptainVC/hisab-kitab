import path from 'node:path';
import { requireAuth } from '../auth/session.js';
export async function registerIngestRoutes(app, opts) {
    app.post('/api/v1/ingest/run', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const body = (req.body || {});
        const from = String(body.from || '');
        const to = String(body.to || '');
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
        const minConfidence = Number(body.minConfidence ?? 0.85);
        const maxOrders = Number(body.maxOrders ?? 200);
        const maxPayments = Number(body.maxPayments ?? 500);
        const splitFromOrders = !!body.splitFromOrders;
        const pollScript = path.join(opts.repoDir, 'src', 'pipeline', 'poll_ingest.js');
        const dashScript = path.join(opts.repoDir, 'src', 'dashboard', 'build_dashboard.js');
        // We keep current poll_ingest behavior (no range filter) for v1; dashboard build uses quarterly scan.
        // Cache file naming will be handled by rebuild job (separate endpoint) in v1.
        const args = [
            pollScript,
            '--base-dir', opts.baseDir,
            '--label', 'HisabKitab',
            '--min-confidence', String(minConfidence),
            '--max-orders', String(maxOrders),
            '--max-payments', String(maxPayments)
        ];
        if (splitFromOrders)
            args.push('--split-from-orders');
        try {
            const job = await opts.runner.startJob('ingest', { from, to, minConfidence, maxOrders, maxPayments, splitFromOrders }, process.execPath, args);
            return reply.send({ ok: true, jobId: job.jobId });
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running') {
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            }
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
}
//# sourceMappingURL=ingest.js.map