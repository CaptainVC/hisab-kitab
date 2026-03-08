import { useState } from 'react';
import { apiGet, apiPost } from '../api/client';

type ParseResp = { ok: true; dryRun: true; imported: number; rows: any[]; errors: any[] };

type CommitResp = { ok: true; jobId: string; stagingFile: string };

type JobLogResp = { ok: true; offset: number; nextOffset: number; log: string };

type JobResp = { ok: true; job: { status: string } };

export default function StagingPage() {
  const [text, setText] = useState('');
  const [parseRows, setParseRows] = useState<any[]>([]);
  const [parseErrors, setParseErrors] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLog, setJobLog] = useState('');
  const [jobOffset, setJobOffset] = useState(0);

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

  async function doCommit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiPost<CommitResp>('/api/v1/staging/commit', { text });
      setJobId(r.jobId);
      setJobLog('');
      setJobOffset(0);
      // simple poll loop
      for (let i = 0; i < 120; i++) {
        const lr = await apiGet<JobLogResp>(`/api/v1/jobs/${r.jobId}/log?offset=${jobOffset}`);
        if (lr.log) setJobLog((t) => t + lr.log);
        setJobOffset(lr.nextOffset);

        const jr = await apiGet<JobResp>(`/api/v1/jobs/${r.jobId}`);
        if (jr.job.status === 'succeeded') break;
        if (jr.job.status === 'failed') throw new Error('commit_failed');
        await new Promise(res => setTimeout(res, 1000));
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Staging</h1>
      <p className="text-zinc-400 mt-1">Paste a /hisab block. Parse preview first, then commit to Excel.</p>

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
            <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50" disabled={busy || !text.trim()} onClick={() => doCommit()}>
              Commit to Excel
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
                    <td className="px-2 py-1 text-right">{r.amount}</td>
                    <td className="px-2 py-1">{r.source}</td>
                    <td className="px-2 py-1">{r.merchant_code}</td>
                    <td className="px-2 py-1">{r.category}</td>
                    <td className="px-2 py-1">{r.subcategory}</td>
                    <td className="px-2 py-1">{r.notes}</td>
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
