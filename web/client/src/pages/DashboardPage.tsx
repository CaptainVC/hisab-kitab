import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { loadRange, saveRange } from '../app/range';
import { formatINR } from '../app/format';
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
  const def = useMemo(() => loadRange(), []);
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

  const [fType, setFType] = useState<string>('');
  const [fSource, setFSource] = useState<string>('');
  const [fLocation, setFLocation] = useState<string>('');
  const [fMerchant, setFMerchant] = useState<string>('');
  const [fCategory, setFCategory] = useState<string>('');
  const [fSubcategory, setFSubcategory] = useState<string>('');
  const [fTags, setFTags] = useState<string[]>([]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const filteredRows = rows.filter((r: any) => {
    if (fType && r.type !== fType) return false;
    if (fSource && (r.source_name || r.source) !== fSource && r.source !== fSource) return false;
    if (fLocation && (r.location_name || r.location) !== fLocation && r.location !== fLocation) return false;

    const merch = r.merchant_name || r.merchant_code || '';
    if (fMerchant && merch !== fMerchant) return false;

    const cat = r.category_name || r.category || '';
    if (fCategory && cat !== fCategory && r.category !== fCategory) return false;

    const sub = r.subcategory_name || r.subcategory || '';
    if (fSubcategory && sub !== fSubcategory && r.subcategory !== fSubcategory) return false;

    if (fTags.length) {
      const tags: string[] = Array.isArray(r._tags)
        ? r._tags
        : String(r.tags || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
      // Any-match (OR)
      if (!fTags.some((t) => tags.includes(t))) return false;
    }

    return true;
  });

  const expenseRows = filteredRows.filter((r: any) => r.type === 'EXPENSE');

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageStart = (curPage - 1) * pageSize;
  const pageRows = filteredRows.slice(pageStart, pageStart + pageSize);

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
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={from} onChange={e => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">To (YYYY-MM)</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={to} onChange={e => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
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

      <div className="mt-6 p-4 border border-zinc-800 rounded-lg">
        <div className="text-sm font-semibold">Filters</div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-zinc-400">Type</label>
            <select className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">(all)</option>
              {Array.from(new Set(rows.map((r:any)=>r.type))).filter(Boolean).sort().map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div className="mt-2 flex gap-2">
              <button
                className={`px-2 py-1 rounded border border-zinc-800 text-xs ${fType===''?'bg-zinc-800':'bg-zinc-900 hover:bg-zinc-800'}`}
                onClick={() => setFType('')}
              >All</button>
              <button
                className={`px-2 py-1 rounded border border-zinc-800 text-xs ${fType==='EXPENSE'?'bg-zinc-800':'bg-zinc-900 hover:bg-zinc-800'}`}
                onClick={() => setFType('EXPENSE')}
              >Expense</button>
              <button
                className={`px-2 py-1 rounded border border-zinc-800 text-xs ${fType==='INCOME'?'bg-zinc-800':'bg-zinc-900 hover:bg-zinc-800'}`}
                onClick={() => setFType('INCOME')}
              >Income</button>
              <button
                className={`px-2 py-1 rounded border border-zinc-800 text-xs ${fType==='TRANSFER'?'bg-zinc-800':'bg-zinc-900 hover:bg-zinc-800'}`}
                onClick={() => setFType('TRANSFER')}
              >Transfer</button>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400">Source</label>
            <select className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={fSource} onChange={(e) => setFSource(e.target.value)}>
              <option value="">(all)</option>
              {Array.from(new Set(rows.map((r:any)=>r.source_name || r.source))).filter(Boolean).sort().map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400">Location</label>
            <select className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={fLocation} onChange={(e) => setFLocation(e.target.value)}>
              <option value="">(all)</option>
              {Array.from(new Set(rows.map((r:any)=>r.location_name || r.location))).filter(Boolean).sort().map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400">Tags (any)</label>
            <select
              multiple
              className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 h-24"
              value={fTags}
              onChange={(e) => {
                const sel = Array.from(e.target.selectedOptions).map((o) => o.value);
                setFTags(sel);
              }}
            >
              {Array.from(
                new Set(
                  rows.flatMap((r: any) =>
                    Array.isArray(r._tags)
                      ? r._tags
                      : String(r.tags || '')
                          .split(',')
                          .map((x: string) => x.trim())
                          .filter(Boolean)
                  )
                )
              )
                .filter(Boolean)
                .sort()
                .map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
            </select>
            <div className="mt-1 text-[11px] text-zinc-500">Hold Ctrl/Cmd to select multiple</div>
          </div>
          <div>
            <label className="text-xs text-zinc-400">Merchant</label>
            <select className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={fMerchant} onChange={(e) => setFMerchant(e.target.value)}>
              <option value="">(all)</option>
              {Array.from(new Set(rows.map((r:any)=>r.merchant_name || r.merchant_code).filter(Boolean))).sort().map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400">Category</label>
            <select className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={fCategory} onChange={(e) => { setFCategory(e.target.value); setFSubcategory(''); }}>
              <option value="">(all)</option>
              {Array.from(new Set(rows.map((r:any)=>r.category_name || r.category).filter(Boolean))).sort().map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400">Subcategory</label>
            <select className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={fSubcategory} onChange={(e) => setFSubcategory(e.target.value)}>
              <option value="">(all)</option>
              {Array.from(new Set(rows.filter((r:any)=>!fCategory || (r.category_name||r.category)===fCategory || r.category===fCategory).map((r:any)=>r.subcategory_name || r.subcategory).filter(Boolean))).sort().map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button className="w-full px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700" onClick={() => { setFType(''); setFSource(''); setFLocation(''); setFMerchant(''); setFCategory(''); setFSubcategory(''); setFTags([]); }}>
              Clear filters
            </button>
          </div>
        </div>
        <div className="mt-3 text-xs text-zinc-500">Showing {filteredRows.length} / {rows.length} transactions (filters). Transactions table paginates.</div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 border border-zinc-800 rounded-lg md:col-span-2">
          <div className="text-sm font-semibold">Daily expense trend</div>
          <div className="mt-2">
            <DailyLineChart labels={daily.map(x => x[0])} values={daily.map(x => Math.round(x[1]))} />
          </div>
        </div>

        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="text-sm font-semibold">Cashflow by month</div>
          <div className="mt-2 border border-zinc-800 rounded overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th className="text-left px-3 py-2">Month</th>
                  <th className="text-right px-3 py-2">Income</th>
                  <th className="text-right px-3 py-2">Expense</th>
                  <th className="text-right px-3 py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const by: Record<string, { income: number; expense: number }> = {};
                  for (const r of filteredRows) {
                    const month = String(r.date || '').slice(0, 7) || 'unknown';
                    if (!by[month]) by[month] = { income: 0, expense: 0 };
                    const amt = Number(r.amount || 0);
                    if (r.type === 'INCOME') by[month].income += amt;
                    else if (r.type === 'EXPENSE') by[month].expense += amt;
                  }
                  return Object.entries(by)
                    .sort((a, b) => b[0].localeCompare(a[0]))
                    .slice(0, 24)
                    .map(([m, v]) => {
                      const net = v.income - v.expense;
                      return (
                        <tr key={m} className="border-t border-zinc-800">
                          <td className="px-3 py-2 font-mono text-xs">{m}</td>
                          <td className="px-3 py-2 text-right">{formatINR(v.income)}</td>
                          <td className="px-3 py-2 text-right">{formatINR(v.expense)}</td>
                          <td className={`px-3 py-2 text-right ${net < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{formatINR(net)}</td>
                        </tr>
                      );
                    });
                })()}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-zinc-500">Net = income − expense (transfers ignored)</div>
        </div>

        <div className="p-4 border border-zinc-800 rounded-lg md:col-span-3">
          <div className="text-sm font-semibold">Top categories (share)</div>
          <div className="mt-2">
            <CategoryDoughnut
              labels={topCats.map(x => x[0])}
              values={topCats.map(x => Math.round(x[1]))}
              onSliceClick={(label) => { setFCategory(label); setFSubcategory(''); }}
            />
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
                        <td className="px-3 py-2 text-right">{formatINR(v)}</td>
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
                        <td className="px-3 py-2 text-right">{formatINR(v)}</td>
                      </tr>
                    ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-zinc-200">Transactions</h2>
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="text-zinc-500">Page size</span>
            <select
              className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800"
              value={pageSize}
              onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }}
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <div className="text-zinc-500">{page} / {totalPages}</div>
            <button className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
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
              {pageRows.map((r) => (
                <tr key={r.txn_id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2 text-right">{formatINR(r.amount)}</td>
                  <td className="px-3 py-2">{r.merchant_name || r.merchant_code || ''}</td>
                  <td className="px-3 py-2">{r.category_name || r.category || ''}</td>
                  <td className="px-3 py-2">{r.subcategory_name || r.subcategory || ''}</td>
                  <td className="px-3 py-2">{r.notes}</td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
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
