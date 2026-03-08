import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { requireAuth } from '../auth/session.js';
export async function registerStagingRoutes(app, opts) {
    // Parse-only preview (no job): runs hk import --dry-run
    app.post('/api/v1/staging/parse', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const body = (req.body || {});
        const text = String(body.text || '');
        if (!text.trim())
            return reply.code(400).send({ ok: false, error: 'missing_text' });
        const tmp = path.join(os.tmpdir(), `hk_staging_${Date.now()}_${Math.random().toString(16).slice(2)}.txt`);
        fs.writeFileSync(tmp, text, 'utf8');
        const hkCli = path.join(opts.repoDir, 'src', 'cli', 'hk.js');
        const args = [hkCli, 'import', '--dry-run', '--base-dir', opts.baseDir, '--text-file', tmp];
        // Synchronous run (fast for typical payload). Capture stdout.
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        if (r.status !== 0) {
            return reply.code(500).send({ ok: false, error: 'parse_failed', detail: (r.stderr || r.stdout || '').slice(0, 4000) });
        }
        try {
            const j = JSON.parse(r.stdout || '{}');
            return reply.send(j);
        }
        catch {
            return reply.code(500).send({ ok: false, error: 'bad_parse_output', detail: String(r.stdout || '').slice(0, 2000) });
        }
    });
    // Commit to Excel (job): hk import --text-file
    app.post('/api/v1/staging/commit', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const body = (req.body || {});
        const text = String(body.text || '');
        if (!text.trim())
            return reply.code(400).send({ ok: false, error: 'missing_text' });
        fs.mkdirSync(opts.stagingDir, { recursive: true });
        const fp = path.join(opts.stagingDir, `staging_${Date.now()}.txt`);
        fs.writeFileSync(fp, text, 'utf8');
        const hkCli = path.join(opts.repoDir, 'src', 'cli', 'hk.js');
        const args = [hkCli, 'import', '--base-dir', opts.baseDir, '--text-file', fp];
        try {
            const job = await opts.runner.startJob('stageCommit', { stagingFile: fp }, process.execPath, args);
            return reply.send({ ok: true, jobId: job.jobId, stagingFile: fp });
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running') {
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            }
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
    // Commit edited parsed rows (job): append rows directly to Excel using workbook_store
    app.post('/api/v1/staging/commitRows', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const body = (req.body || {});
        const rows = body.rows;
        if (!Array.isArray(rows) || rows.length === 0)
            return reply.code(400).send({ ok: false, error: 'missing_rows' });
        fs.mkdirSync(opts.stagingDir, { recursive: true });
        const fp = path.join(opts.stagingDir, `staging_rows_${Date.now()}.json`);
        fs.writeFileSync(fp, JSON.stringify(rows, null, 2), 'utf8');
        const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'staging_commit_rows.js');
        const args = [script, '--base-dir', opts.baseDir, '--rows-file', fp];
        try {
            const job = await opts.runner.startJob('stageCommitRows', { rowsFile: fp }, process.execPath, args, { cwd: opts.repoDir });
            return reply.send({ ok: true, jobId: job.jobId, rowsFile: fp });
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running') {
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            }
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
}
//# sourceMappingURL=staging.js.map