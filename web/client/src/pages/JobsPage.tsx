import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';

type Job = {
  jobId: string;
  type: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
};

type JobsResp = { ok: true; jobs: Job[] };

type JobLogResp = { ok: true; offset: number; nextOffset: number; log: string };

type JobResp = { ok: true; job: any };

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [log, setLog] = useState('');
  const [offset, setOffset] = useState(0);

  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<JobsResp>('/api/v1/jobs');
      setJobs(r.jobs);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function selectJob(jobId: string) {
    setSelectedJobId(jobId);
    setSelectedJob(null);
    setLog('');
    setOffset(0);
    try {
      const jr = await apiGet<JobResp>(`/api/v1/jobs/${jobId}`);
      setSelectedJob(jr.job);
    } catch {
      // ignore
    }
  }

  async function pollLog() {
    if (!selectedJobId) return;
    const r = await apiGet<JobLogResp>(`/api/v1/jobs/${selectedJobId}/log?offset=${offset}`);
    if (r.log) setLog((t) => t + r.log);
    setOffset(r.nextOffset);
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    const t = setInterval(() => {
      pollLog().catch(() => {});
    }, 1200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, offset]);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Jobs</h1>
          <p className="text-[color:var(--hk-muted)] mt-1">Background jobs (ingest, rebuild, staging commit).</p>
          <div className="mt-1 text-xs text-[color:var(--hk-faint)]">
            Oldest visible job: {jobs.length ? new Date(jobs.reduce((min, j) => (j.createdAt < min ? j.createdAt : min), jobs[0].createdAt)).toLocaleString() : '—'}
          </div>
        </div>
        <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy} onClick={() => refresh().catch(() => {})}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="hk-card overflow-auto max-h-[520px]">
          <table className="w-full text-sm">
            <thead className="hk-table-head">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.jobId} className={`cursor-pointer ${selectedJobId === j.jobId ? 'bg-zinc-900/40' : 'hover:bg-zinc-900/30'}`} onClick={() => selectJob(j.jobId).catch(() => {})}>
                  <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)] whitespace-nowrap">{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-xs">{j.type}</td>
                  <td className="px-3 py-2">
                    {j.status}
                    {j.exitCode !== undefined ? <span className="text-xs text-[color:var(--hk-faint)]"> (code {j.exitCode})</span> : null}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 ? (
                <tr><td className="px-3 py-3 text-[color:var(--hk-faint)]" colSpan={3}>No jobs yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="hk-card p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Job details {selectedJobId ? <span className="font-mono text-xs text-[color:var(--hk-muted)]">({selectedJobId})</span> : null}</div>
            {selectedJobId ? (
              <div className="flex gap-2">
                <button
                  className="px-2 py-1 hk-btn-secondary text-xs"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(selectedJobId);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    } catch {
                      // ignore
                    }
                  }}
                >
                  {copied ? 'Copied' : 'Copy jobId'}
                </button>
                <a
                  className="px-2 py-1 hk-btn-secondary text-xs"
                  href={`/api/v1/jobs/${selectedJobId}/log?offset=0`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open raw log
                </a>
              </div>
            ) : null}
          </div>

          {selectedJob ? (
            <pre className="mt-2 text-xs overflow-auto max-h-[160px] whitespace-pre-wrap text-[color:var(--hk-muted)]">{JSON.stringify(selectedJob.params || {}, null, 2)}</pre>
          ) : (
            <div className="mt-2 text-xs text-[color:var(--hk-faint)]">(select a job)</div>
          )}

          <div className="mt-3 text-sm font-semibold">Log</div>
          <pre className="mt-2 text-xs overflow-auto max-h-[300px] whitespace-pre-wrap text-[color:var(--hk-muted)]">{selectedJobId ? (log || '(loading...)') : '(select a job)'}</pre>
        </div>
      </div>
    </div>
  );
}
