import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/session.js';
export async function registerTxnRoutes(app, opts) {
    app.put('/api/v1/txns/:txnId', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { txnId } = req.params;
        const txn_id = String(txnId || '').trim();
        if (!txn_id)
            return reply.code(400).send({ ok: false, error: 'missing_txn_id' });
        const body = (req.body || {});
        const patch = {};
        const allowed = ['merchant_code', 'category', 'subcategory', 'tags', 'notes', 'source', 'location', 'amount'];
        for (const k of allowed) {
            if (body[k] === undefined)
                continue;
            if (k === 'amount') {
                const n = Number(body[k]);
                if (!Number.isFinite(n) || n <= 0)
                    return reply.code(400).send({ ok: false, error: 'bad_amount' });
                patch[k] = n;
            }
            else {
                patch[k] = String(body[k] ?? '');
            }
        }
        if (Object.keys(patch).length === 0)
            return reply.code(400).send({ ok: false, error: 'missing_patch' });
        fs.mkdirSync(opts.stagingDir, { recursive: true });
        const patchFile = path.join(opts.stagingDir, `txn_patch_${txn_id}_${Date.now()}.json`);
        fs.writeFileSync(patchFile, JSON.stringify(patch, null, 2), 'utf8');
        const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'edit_txn.js');
        const args = [script, '--base-dir', opts.baseDir, '--txn-id', txn_id, '--patch-file', patchFile];
        try {
            const job = await opts.runner.startJob('editTxn', { txn_id, patch, patchFile }, process.execPath, args, { cwd: opts.repoDir });
            return reply.send({ ok: true, jobId: job.jobId });
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running')
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
    // Split one transaction into multiple child transactions.
    // Patches the original txn to add tag `superseded` so it is excluded from dashboard totals.
    app.post('/api/v1/txns/:txnId/split', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { txnId } = req.params;
        const txn_id = String(txnId || '').trim();
        if (!txn_id)
            return reply.code(400).send({ ok: false, error: 'missing_txn_id' });
        const body = (req.body || {});
        const splits = Array.isArray(body.splits) ? body.splits : null;
        if (!splits || !splits.length)
            return reply.code(400).send({ ok: false, error: 'missing_splits' });
        fs.mkdirSync(opts.stagingDir, { recursive: true });
        const splitsFile = path.join(opts.stagingDir, `txn_splits_${txn_id}_${Date.now()}.json`);
        fs.writeFileSync(splitsFile, JSON.stringify(splits, null, 2), 'utf8');
        const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'split_txn.js');
        const args = [script, '--base-dir', opts.baseDir, '--txn-id', txn_id, '--splits-file', splitsFile];
        try {
            const job = await opts.runner.startJob('splitTxn', { txn_id, splitsFile, splitsCount: splits.length }, process.execPath, args, { cwd: opts.repoDir });
            return reply.send({ ok: true, jobId: job.jobId });
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running')
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
}
//# sourceMappingURL=txns.js.map