import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { writeJson, readJson } from '../storage/jsonStore.js';
export class JobRunner {
    reportsDir;
    running = null;
    constructor(reportsDir) {
        this.reportsDir = reportsDir;
        fs.mkdirSync(this.reportsDir, { recursive: true });
    }
    getRunning() {
        return this.running;
    }
    listJobs(limit = 20) {
        const dir = this.reportsDir;
        if (!fs.existsSync(dir))
            return [];
        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith('job_') && f.endsWith('.json'))
            .map(f => path.join(dir, f));
        const recs = [];
        for (const fp of files) {
            const r = readJson(fp, null);
            if (r)
                recs.push(r);
        }
        return recs
            .sort((a, b) => (b.createdAt.localeCompare(a.createdAt)))
            .slice(0, limit);
    }
    getJob(jobId) {
        const fp = path.join(this.reportsDir, `job_${jobId}.json`);
        return readJson(fp, null);
    }
    async startJob(type, params, command, args, options) {
        if (this.running && this.running.status === 'running') {
            throw new Error('job_already_running');
        }
        const jobId = nanoid();
        const logFile = path.join(this.reportsDir, `job_${jobId}.log`);
        const rec = {
            schemaVersion: 1,
            jobId,
            type,
            status: 'queued',
            createdAt: new Date().toISOString(),
            params,
            logFile,
        };
        writeJson(path.join(this.reportsDir, `job_${jobId}.json`), rec);
        // Start
        rec.status = 'running';
        rec.startedAt = new Date().toISOString();
        writeJson(path.join(this.reportsDir, `job_${jobId}.json`), rec);
        this.running = rec;
        await new Promise((resolve) => {
            const out = fs.openSync(logFile, 'a');
            const child = spawn(command, args, {
                stdio: ['ignore', out, out],
                env: { ...process.env, ...(options?.env || {}) },
                cwd: options?.cwd
            });
            child.on('exit', (code) => {
                try {
                    fs.closeSync(out);
                }
                catch { }
                rec.finishedAt = new Date().toISOString();
                rec.exitCode = code ?? undefined;
                rec.status = code === 0 ? 'succeeded' : 'failed';
                writeJson(path.join(this.reportsDir, `job_${jobId}.json`), rec);
                this.running = null;
                resolve();
            });
            child.on('error', (err) => {
                rec.finishedAt = new Date().toISOString();
                rec.status = 'failed';
                rec.error = String(err?.message || err);
                writeJson(path.join(this.reportsDir, `job_${jobId}.json`), rec);
                this.running = null;
                resolve();
            });
        });
        return rec;
    }
}
//# sourceMappingURL=jobRunner.js.map