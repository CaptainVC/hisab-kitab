import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { loadRange, saveRange } from '../app/range';

type StartResp = { ok: true; jobId: string };

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

type JobResp = { ok: true; job: Job };

type JobLogResp = { ok: true; offset: number; nextOffset: number; log: string };

export default function IngestPage() {
  const def = useMemo(() => loadRange(), []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const [minConfidence, setMinConfidence] = useState(0.85);
  const [maxOrders, setMaxOrders] = useState(200);
  const [maxPayments, setMaxPayments] = useState(500);
  const [splitFromOrders, setSplitFromOrders] = useState(true);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [logText, setLogText] = useState('');
  const [logOffset, setLogOffset] = useState(0);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refreshJobs() {
    const r = await apiGet<JobsResp>('/api/v1/jobs');
    setJobs(r.jobs);
  }

  async function startIngest() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiPost<StartResp>('/api/v1/ingest/run', {
        from,
        to,
        minConfidence,
        maxOrders,
        maxPayments,
        splitFromOrders
      });
      setSelectedJobId(r.jobId);
      setLogText('');
      setLogOffset(0);
      await refreshJobs();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function pollSelectedJob() {
    if (!selectedJobId) return;
    const jr = await apiGet<JobResp>(`/api/v1/jobs/${selectedJobId}`);
    // tail log
    const lr = await apiGet<JobLogResp>(`/api/v1/jobs/${selectedJobId}/log?offset=${logOffset}`);
    if (lr.log) setLogText((t) => t + lr.log);
    setLogOffset(lr.nextOffset);

    if (jr.job.status === 'succeeded' || jr.job.status === 'failed') {
      await refreshJobs();
    }
  }

  useEffect(() => {
    refreshJobs().catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    const t = setInterval(() => {
      pollSelectedJob().catch(() => {});
    }, 1200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, logOffset]);

  return (
    <div>
      <h1 className="text-xl font-semibold">Ingest</h1>
      <p className="text-zinc-400 mt-1">Runs: poll_ingest + rebuild cache for the selected range.</p>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400">From (YYYY-MM)</label>
              <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={from} onChange={e => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
            </div>
            <div>
              <label className="text-xs text-zinc-400">To (YYYY-MM)</label>
              <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={to} onChange={e => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Min confidence</label>
              <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" type="number" step="0.01" value={minConfidence} onChange={e => setMinConfidence(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Max orders</label>
              <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" type="number" value={maxOrders} onChange={e => setMaxOrders(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Max payments</label>
              <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" type="number" value={maxPayments} onChange={e => setMaxPayments(Number(e.target.value))} />
            </div>
            <div className="flex items-end gap-2">
              <label className="text-sm text-zinc-300 flex items-center gap-2">
                <input type="checkbox" checked={splitFromOrders} onChange={e => setSplitFromOrders(e.target.checked)} />
                Split from orders
              </label>
            </div>
          </div>

          {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

          <button
            className="mt-4 px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50"
            disabled={busy}
            onClick={startIngest}
          >
            {busy ? 'Starting…' : 'Run ingest + rebuild'}
          </button>
        </div>

        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm">Recent jobs</div>
            <button className="text-sm text-zinc-300 hover:text-white" onClick={() => refreshJobs().catch(() => {})}>Refresh</button>
          </div>
          <div className="mt-2 space-y-2 max-h-64 overflow-auto">
            {jobs.map(j => (
              <button
                key={j.jobId}
                className={`w-full text-left px-3 py-2 rounded border ${selectedJobId === j.jobId ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 hover:bg-zinc-900'}`}
                onClick={() => { setSelectedJobId(j.jobId); setLogText(''); setLogOffset(0); }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm">{j.type} • {j.status}</div>
                  <div className="text-xs text-zinc-500">{new Date(j.createdAt).toLocaleString()}</div>
                </div>
                <div className="text-xs text-zinc-500 mt-1">{j.jobId}</div>
              </button>
            ))}
            {jobs.length === 0 ? <div className="text-sm text-zinc-500">No jobs yet.</div> : null}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Job log</h2>
        <pre className="mt-2 p-3 border border-zinc-800 rounded-lg bg-zinc-950 text-xs overflow-auto max-h-[420px] whitespace-pre-wrap">{logText || '(select a job to view logs)'}</pre>
      </div>
    </div>
  );
}
