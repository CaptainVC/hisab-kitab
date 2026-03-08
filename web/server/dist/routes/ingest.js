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
        // Run ingest + rebuild in one job (as per spec: ingest always rebuilds).
        const jobScript = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'ingest_and_rebuild.js');
        const env = {
            HK_RANGE_FROM: from,
            HK_RANGE_TO: to,
            HK_MIN_CONFIDENCE: String(minConfidence),
            HK_MAX_ORDERS: String(maxOrders),
            HK_MAX_PAYMENTS: String(maxPayments),
            HK_SPLIT_FROM_ORDERS: splitFromOrders ? '1' : '0'
        };
        const args = [jobScript];
        try {
            const job = await opts.runner.startJob('ingest', { from, to, minConfidence, maxOrders, maxPayments, splitFromOrders }, process.execPath, args, { env });
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