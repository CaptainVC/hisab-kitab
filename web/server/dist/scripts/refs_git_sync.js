import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function getArg(args, name) {
    const i = args.indexOf(name);
    if (i === -1)
        return null;
    return args[i + 1] ?? null;
}
function run(cmd, args, cwd) {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    return {
        ok: r.status === 0,
        status: r.status,
        stdout: String(r.stdout || ''),
        stderr: String(r.stderr || '')
    };
}
function writeStatus(refsDir, status) {
    const fp = path.join(refsDir, '.sync_status.json');
    fs.writeFileSync(fp, JSON.stringify(status, null, 2), 'utf8');
    return fp;
}
export async function main() {
    const args = process.argv.slice(2);
    const refsDir = String(getArg(args, '--refs-dir') || '');
    const branch = String(getArg(args, '--branch') || 'main');
    const message = String(getArg(args, '--message') || 'refs: update via web');
    if (!refsDir)
        throw new Error('missing_refs_dir');
    const startedAt = new Date().toISOString();
    const status = {
        ok: false,
        branch,
        startedAt,
        finishedAt: null,
        steps: [],
        lastCommit: null,
        error: null
    };
    const step = (name, r) => {
        status.steps.push({ name, ok: r.ok, status: r.status, stdout: r.stdout.slice(0, 4000), stderr: r.stderr.slice(0, 4000) });
        if (!r.ok && !status.error)
            status.error = `${name} failed`;
    };
    // Ensure we're on the right branch
    step('git_checkout', run('git', ['checkout', branch], refsDir));
    // Stage changes
    step('git_add', run('git', ['add', '-A'], refsDir));
    // Commit if there are changes
    const diff = run('git', ['status', '--porcelain'], refsDir);
    step('git_status_porcelain', diff);
    const dirty = diff.stdout.trim().length > 0;
    if (dirty) {
        const commit = run('git', ['commit', '-m', message], refsDir);
        step('git_commit', commit);
    }
    else {
        status.steps.push({ name: 'git_commit', ok: true, status: 0, stdout: '(no changes)', stderr: '' });
    }
    // Pull with rebase to reduce non-fast-forward errors
    step('git_pull_rebase', run('git', ['pull', '--rebase', 'origin', branch], refsDir));
    // Push
    step('git_push', run('git', ['push', 'origin', branch], refsDir));
    // Capture last commit
    const last = run('git', ['rev-parse', 'HEAD'], refsDir);
    step('git_rev_parse', last);
    if (last.ok)
        status.lastCommit = last.stdout.trim();
    status.ok = status.steps.every((s) => s.ok);
    status.finishedAt = new Date().toISOString();
    const fp = writeStatus(refsDir, status);
    process.stdout.write(JSON.stringify({ ok: status.ok, statusFile: fp, lastCommit: status.lastCommit }, null, 2));
    process.stdout.write('\n');
}
main().catch((err) => {
    process.stderr.write(String(err?.stack || err?.message || err) + '\n');
    process.exit(1);
});
//# sourceMappingURL=refs_git_sync.js.map