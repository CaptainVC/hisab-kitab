import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { currentQuarterRange } from '../app/range';
import { DailyLineChart, CategoryDoughnut } from '../components/Charts';

type DataResp = { ok: true; stale: boolean; ageMs: number; data: any };

type RebuildResp = { ok: true; jobId: string; outJson: string; outHtml: string };

type JobResp = { ok: true; job: { status: string } };

function msToAge(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return `${m}m`;
}

export default function DashboardPage() {
  const def = useMemo(() => currentQuarterRange(), []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cacheFile, setCacheFile] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ stale: boolean; ageMs: number; generatedAt?: string } | null>(null);
  const [rows, setRows] = useState<any[]>([]);

  async function loadData() {
    try {
      const r = await apiGet<DataResp>(`/api/v1/data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setMeta({ stale: r.stale, ageMs: r.ageMs, generatedAt: r.data?.generatedAt });
      setRows(Array.isArray(r.data?.rows) ? r.data.rows : []);
      setErr(null);
      setCacheFile(null);
    } catch (e: any) {
      // If cache missing, surface it and keep UI usable.
      setMeta(null);
      setRows([]);
      setErr(String(e?.message || e));
      setCacheFile((e as any)?.data?.cacheFile || null);
      throw e;
    }
  }

  async function rebuild() {
    setBusy(true);
    setErr(null);
    try {
      const { jobId } = await apiPost<RebuildResp>('/api/v1/rebuild', { from, to });
      setLastJobId(jobId);
      try { localStorage.setItem(`hk:lastRebuildJob:${from}:${to}`, jobId); } catch {}
      // poll job
      for (let i = 0; i < 60; i++) {
        const jr = await apiGet<JobResp>(`/api/v1/jobs/${jobId}`);
        if (jr.job.status === 'succeeded') break;
        if (jr.job.status === 'failed') throw new Error('rebuild_failed');
        await new Promise(r => setTimeout(r, 1000));
      }
      await loadData();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    try {
      const j = localStorage.getItem(`hk:lastRebuildJob:${from}:${to}`);
      if (j) setLastJobId(j);
    } catch {}

    // try load if cache exists; ignore errors
    loadData().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cacheMissing = err === 'cache_missing';

  const expenseRows = rows.filter(r => r.type === 'EXPENSE');

  const daily = (() => {
    const sums: Record<string, number> = {};
    for (const r of expenseRows) {
      const k = r.date;
      sums[k] = (sums[k] || 0) + Number(r.amount || 0);
    }
    return Object.entries(sums).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const topCats = (() => {
    const sums: Record<string, number> = {};
    for (const r of expenseRows) {
      const k = r.category_name || r.category || 'Uncategorized';
      sums[k] = (sums[k] || 0) + Number(r.amount || 0);
    }
    return Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 12);
  })();

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          {meta ? (
            <div className="text-sm text-zinc-400 mt-1">
              {meta.generatedAt ? <>Generated: {meta.generatedAt}</> : null}{' '}
              {meta ? <>({meta.stale ? 'stale' : 'fresh'}; age {msToAge(meta.ageMs)})</> : null}
            </div>
          ) : (
            <div className="text-sm text-zinc-500 mt-1">No cache loaded yet.</div>
          )}
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-zinc-400">From (YYYY-MM)</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">To (YYYY-MM)</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button
            className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50"
            disabled={busy}
            onClick={rebuild}
          >
            {busy ? 'Rebuilding…' : 'Rebuild'}
          </button>
        </div>
      </div>

      {cacheMissing ? (
        <div className="mt-3 p-3 border border-yellow-800 rounded bg-yellow-950/20 text-yellow-200 text-sm space-y-1">
          <div>Cache is missing for this range. Click <b>Rebuild</b> to generate it.</div>
          {cacheFile ? <div className="text-xs text-yellow-200/80 font-mono">Expected: {cacheFile}</div> : null}
          {lastJobId ? (
            <div className="text-xs text-yellow-200/80">
              Last rebuild job: <span className="font-mono">{lastJobId}</span> (see <a className="underline" href="/ingest">Ingest</a> → jobs)
            </div>
          ) : null}
        </div>
      ) : err ? (
        <div className="mt-3 text-sm text-red-400">{err}</div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="text-sm font-semibold">Daily expense trend</div>
          <div className="mt-2">
            <DailyLineChart labels={daily.map(x => x[0])} values={daily.map(x => Math.round(x[1]))} />
          </div>
        </div>

        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="text-sm font-semibold">Top categories (share)</div>
          <div className="mt-2">
            <CategoryDoughnut labels={topCats.map(x => x[0])} values={topCats.map(x => Math.round(x[1]))} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="text-sm font-semibold">Top subcategories (expense only)</div>
          <div className="mt-2 border border-zinc-800 rounded overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th className="text-left px-3 py-2">Subcategory</th>
                  <th className="text-right px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sums: Record<string, number> = {};
                  for (const r of expenseRows) {
                    const k = r.subcategory_name || r.subcategory || 'Uncategorized';
                    sums[k] = (sums[k] || 0) + Number(r.amount || 0);
                  }
                  return Object.entries(sums)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([k, v]) => (
                      <tr key={k} className="border-t border-zinc-800">
                        <td className="px-3 py-2">{k}</td>
                        <td className="px-3 py-2 text-right">{Math.round(v)}</td>
                      </tr>
                    ));
                })()}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="text-sm font-semibold">Top merchants (expense only)</div>
          <div className="mt-2 border border-zinc-800 rounded overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th className="text-left px-3 py-2">Merchant</th>
                  <th className="text-right px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sums: Record<string, number> = {};
                  for (const r of expenseRows) {
                    const k = r.merchant_name || r.merchant_code || 'Unknown';
                    sums[k] = (sums[k] || 0) + Number(r.amount || 0);
                  }
                  return Object.entries(sums)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([k, v]) => (
                      <tr key={k} className="border-t border-zinc-800">
                        <td className="px-3 py-2">{k}</td>
                        <td className="px-3 py-2 text-right">{Math.round(v)}</td>
                      </tr>
                    ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Transactions (first 200)</h2>
        <div className="mt-2 border border-zinc-800 rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-300">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2">Merchant</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Subcategory</th>
                <th className="text-left px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.txn_id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2 text-right">{r.amount}</td>
                  <td className="px-3 py-2">{r.merchant_name || r.merchant_code || ''}</td>
                  <td className="px-3 py-2">{r.category_name || r.category || ''}</td>
                  <td className="px-3 py-2">{r.subcategory_name || r.subcategory || ''}</td>
                  <td className="px-3 py-2">{r.notes}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-zinc-500" colSpan={7}>No rows loaded (run rebuild).</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
