import { useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { formatINR } from '../app/format';
import { loadRange, saveRange } from '../app/range';

type ParseResp = { ok: true; dryRun: true; imported: number; rows: any[]; errors: any[] };

type CommitResp = { ok: true; jobId: string; stagingFile: string };

type JobLogResp = { ok: true; offset: number; nextOffset: number; log: string };

type JobResp = { ok: true; job: { status: string } };

export default function StagingPage() {
  const def = useMemo(() => loadRange(), []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const [text, setText] = useState('');
  const [parseRows, setParseRows] = useState<any[]>([]);
  const [parseErrors, setParseErrors] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLog, setJobLog] = useState('');

  async function doParse() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiPost<ParseResp>('/api/v1/staging/parse', { text });
      setParseRows(r.rows || []);
      setParseErrors(r.errors || []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function pollJob(id: string, label: string) {
    let offset = 0;
    for (let i = 0; i < 600; i++) {
      const lr = await apiGet<JobLogResp>(`/api/v1/jobs/${id}/log?offset=${offset}`);
      if (lr.log) setJobLog((t) => t + (t ? '' : '') + lr.log);
      offset = lr.nextOffset;

      const jr = await apiGet<JobResp>(`/api/v1/jobs/${id}`);
      if (jr.job.status === 'succeeded') {
        setJobLog((t) => t + `\n[${label}] succeeded\n`);
        return;
      }
      if (jr.job.status === 'failed') throw new Error(`${label}_failed`);
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error(`${label}_timeout`);
  }

  async function doCommitText(rebuildAfter: boolean) {
    setBusy(true);
    setErr(null);
    try {
      setJobLog('');
      const r = await apiPost<CommitResp>('/api/v1/staging/commit', { text });
      setJobId(r.jobId);
      setJobLog((t) => t + `[stageCommit] job ${r.jobId}\n`);
      await pollJob(r.jobId, 'stageCommit');

      if (rebuildAfter) {
        const rb = await apiPost<{ ok: true; jobId: string }>('/api/v1/rebuild', { from, to });
        setJobId(rb.jobId);
        setJobLog((t) => t + `\n[rebuild] job ${rb.jobId} (range ${from}..${to})\n`);
        await pollJob(rb.jobId, 'rebuild');
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function doCommitRows(rebuildAfter: boolean) {
    setBusy(true);
    setErr(null);
    try {
      setJobLog('');
      const r = await apiPost<{ ok: true; jobId: string }>(
        '/api/v1/staging/commitRows',
        { rows: parseRows }
      );
      setJobId(r.jobId);
      setJobLog((t) => t + `[stageCommitRows] job ${r.jobId}\n`);
      await pollJob(r.jobId, 'stageCommitRows');

      if (rebuildAfter) {
        const rb = await apiPost<{ ok: true; jobId: string }>('/api/v1/rebuild', { from, to });
        setJobId(rb.jobId);
        setJobLog((t) => t + `\n[rebuild] job ${rb.jobId} (range ${from}..${to})\n`);
        await pollJob(rb.jobId, 'rebuild');
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Staging</h1>
          <p className="text-zinc-400 mt-1">Paste a /hisab block. Parse preview first, then commit to Excel.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-zinc-400">Rebuild from</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={from} onChange={(e) => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Rebuild to</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={to} onChange={(e) => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 border border-zinc-800 rounded-lg">
          <label className="text-xs text-zinc-400">Hisab text</label>
          <textarea
            className="mt-1 w-full h-56 px-3 py-2 rounded bg-zinc-900 border border-zinc-800 font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="/hisab Day (08/03/26)\n260/- Something (mk)"
          />
          {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}
          <div className="mt-3 flex gap-2">
            <button className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50" disabled={busy || !text.trim()} onClick={() => doParse()}>
              {busy ? 'Working…' : 'Parse preview'}
            </button>
            <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50" disabled={busy || !text.trim()} onClick={() => doCommitText(false)}>
              Commit text
            </button>
            <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50" disabled={busy || parseRows.length === 0} onClick={() => doCommitRows(false)}>
              Commit edited rows
            </button>
            <button className="px-3 py-2 rounded-md bg-emerald-500 text-emerald-950 font-semibold disabled:opacity-50" disabled={busy || parseRows.length === 0} onClick={() => doCommitRows(true)}>
              Commit rows + rebuild cache
            </button>
          </div>
        </div>

        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="text-sm font-semibold">Preview</div>
          <div className="mt-2 text-xs text-zinc-500">Rows: {parseRows.length} • Errors: {parseErrors.length}</div>

          {parseErrors.length ? (
            <pre className="mt-2 p-2 rounded bg-zinc-950 border border-zinc-800 text-xs overflow-auto max-h-40 whitespace-pre-wrap">{JSON.stringify(parseErrors, null, 2)}</pre>
          ) : null}

          <div className="mt-3 border border-zinc-800 rounded overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th className="text-left px-2 py-1">Date</th>
                  <th className="text-right px-2 py-1">Amt</th>
                  <th className="text-left px-2 py-1">Source</th>
                  <th className="text-left px-2 py-1">Merchant</th>
                  <th className="text-left px-2 py-1">Category</th>
                  <th className="text-left px-2 py-1">Subcat</th>
                  <th className="text-left px-2 py-1">Notes</th>
                </tr>
              </thead>
              <tbody>
                {parseRows.slice(0, 200).map((r) => (
                  <tr key={r.txn_id} className="border-t border-zinc-800">
                    <td className="px-2 py-1 whitespace-nowrap">{r.date}</td>
                    <td className="px-2 py-1 text-right">{formatINR(r.amount)}</td>
                    <td className="px-2 py-1">{r.source}</td>
                    <td className="px-2 py-1">
                      <input className="w-28 px-1 py-0.5 rounded bg-zinc-950 border border-zinc-800" value={r.merchant_code || ''} onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, merchant_code: e.target.value } : it))} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-24 px-1 py-0.5 rounded bg-zinc-950 border border-zinc-800" value={r.category || ''} onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, category: e.target.value } : it))} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-28 px-1 py-0.5 rounded bg-zinc-950 border border-zinc-800" value={r.subcategory || ''} onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, subcategory: e.target.value } : it))} />
                      <div className="mt-1">
                        <input className="w-28 px-1 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[11px]" value={r.tags || ''} placeholder="tags" onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, tags: e.target.value } : it))} />
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-40 px-1 py-0.5 rounded bg-zinc-950 border border-zinc-800" value={r.notes || ''} onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, notes: e.target.value } : it))} />
                    </td>
                  </tr>
                ))}
                {parseRows.length === 0 ? (
                  <tr><td className="px-2 py-2 text-zinc-500" colSpan={7}>Parse something to see preview.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Commit job log {jobId ? `(job ${jobId})` : ''}</h2>
        <pre className="mt-2 p-3 border border-zinc-800 rounded-lg bg-zinc-950 text-xs overflow-auto max-h-[320px] whitespace-pre-wrap">{jobLog || '(no commit run yet)'}</pre>
      </div>
    </div>
  );
}
