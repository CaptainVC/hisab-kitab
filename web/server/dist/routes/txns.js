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
        const allowed = ['merchant_code', 'category', 'subcategory', 'tags', 'notes'];
        for (const k of allowed) {
            if (body[k] !== undefined)
                patch[k] = String(body[k] ?? '');
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
}
//# sourceMappingURL=txns.js.map