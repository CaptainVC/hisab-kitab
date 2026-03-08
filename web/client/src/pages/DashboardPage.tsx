import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../api/client';
import { loadRange, saveRange } from '../app/range';
import { formatINR } from '../app/format';
import { DailyLineChart, CategoryDoughnut, SimpleBarChart } from '../components/Charts';
import { SearchSelect } from '../components/SearchSelect';

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

  const [merchantOptions, setMerchantOptions] = useState<Array<{ code: string; name: string; archived?: boolean }>>([]);
  const [categoryOptions, setCategoryOptions] = useState<Array<{ code: string; name: string; archived?: boolean }>>([]);
  const [subcategoryOptions, setSubcategoryOptions] = useState<Array<{ code: string; name: string; category: string; archived?: boolean }>>([]);
  const [sourceOptions, setSourceOptions] = useState<Array<{ code: string; display: string }>>([]);
  const [locationOptions, setLocationOptions] = useState<Array<{ code: string; name: string }>>([]);

  const [editTxnOpen, setEditTxnOpen] = useState(false);
  const [editTxn, setEditTxn] = useState<any | null>(null);
  const [editMerchant, setEditMerchant] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editSubcategory, setEditSubcategory] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSource, setEditSource] = useState('');
  const [editLocation, setEditLocation] = useState('');

  function openEditTxn(r: any) {
    setEditTxn(r);

    setEditMerchant(String(r.merchant_code || ''));
    setEditCategory(String(r.category || ''));
    setEditSubcategory(String(r.subcategory || ''));

    setEditTags(String(r.tags || ''));
    setEditNotes(String(r.notes || ''));
    setEditSource(String(r.source || ''));
    setEditLocation(String(r.location || ''));
    setEditTxnOpen(true);
  }

  async function loadRefs() {
    try {
      const [m, c, s, so, lo] = await Promise.all([
        apiGet<{ ok: true; merchants: any[] }>('/api/v1/refs/merchants'),
        apiGet<{ ok: true; categories: any[] }>('/api/v1/refs/categories'),
        apiGet<{ ok: true; subcategories: any[] }>('/api/v1/refs/subcategories'),
        apiGet<{ ok: true; sources: any[] }>('/api/v1/meta/sources'),
        apiGet<{ ok: true; locations: any[] }>('/api/v1/meta/locations')
      ]);
      setMerchantOptions((m.merchants || []).filter((x: any) => !x.archived));
      setCategoryOptions((c.categories || []).filter((x: any) => !x.archived));
      setSubcategoryOptions((s.subcategories || []).filter((x: any) => !x.archived));
      setSourceOptions(so.sources || []);
      setLocationOptions(lo.locations || []);
    } catch {
      // non-fatal
    }
  }

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

    loadRefs().catch(() => {});
    // try load if cache exists; ignore errors
    loadData().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cacheMissing = err === 'cache_missing';

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [fType, setFType] = useState<string>('');
  const [fSource, setFSource] = useState<string>('');
  const [fLocation, setFLocation] = useState<string>('');
  const [fMerchant, setFMerchant] = useState<string>('');
  const [fCategory, setFCategory] = useState<string>('');
  const [fSubcategory, setFSubcategory] = useState<string>('');

  // Special tokens for "missing" values from charts/tables
  const MISSING = '__MISSING__';
  const [fTags, setFTags] = useState<string[]>([]);
  const [fDate, setFDate] = useState<string>(''); // YYYY-MM-DD

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  function inSelectedRange(dateStr: string) {
    const d = String(dateStr || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;

    // Support YYYY-MM (month) or YYYY-MM-DD (date) range values.
    let start = '';
    let endExclusive = '';

    if (/^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to)) {
      start = `${from}-01`;
      const [ty, tm] = to.split('-').map(Number);
      endExclusive = new Date(Date.UTC(ty, tm, 1)).toISOString().slice(0, 10);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      start = from;
      endExclusive = new Date(Date.parse(to + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    } else {
      return true; // fallback: don't filter
    }

    return d >= start && d < endExclusive;
  }

  const filteredRows = rows.filter((r: any) => {
    if (!inSelectedRange(String(r.date || ''))) return false;
    if (fDate && String(r.date || '') !== fDate) return false;
    if (fType && r.type !== fType) return false;
    if (fSource) {
      if (fSource === 'Mail') {
        if (!r.messageId) return false;
      } else if ((r.source_name || r.source) !== fSource && r.source !== fSource) {
        return false;
      }
    }
    if (fLocation && (r.location_name || r.location) !== fLocation && r.location !== fLocation) return false;

    const merch = r.merchant_name || r.merchant_code || '';
    if (fMerchant) {
      if (fMerchant === MISSING) {
        if (String(merch || '').trim()) return false;
      } else if (merch !== fMerchant) {
        return false;
      }
    }

    const cat = r.category_name || r.category || '';
    if (fCategory && cat !== fCategory && r.category !== fCategory) return false;

    const sub = r.subcategory_name || r.subcategory || '';
    if (fSubcategory) {
      if (fSubcategory === MISSING) {
        if (String(sub || '').trim()) return false;
      } else if (sub !== fSubcategory && r.subcategory !== fSubcategory) {
        return false;
      }
    }

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
            <div className="text-sm text-[color:var(--hk-muted)] mt-1">
              {meta.generatedAt ? <>Generated: {meta.generatedAt}</> : null}{' '}
              {meta ? <>({meta.stale ? 'stale' : 'fresh'}; age {msToAge(meta.ageMs)})</> : null}
            </div>
          ) : (
            <div className="text-sm text-[color:var(--hk-faint)] mt-1">No cache loaded yet.</div>
          )}
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">From (YYYY-MM-DD)</label>
            <input className="block mt-1 hk-input" type="date" value={from} onChange={e => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">To (YYYY-MM-DD)</label>
            <input className="block mt-1 hk-input" type="date" value={to} onChange={e => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
          </div>
          <button
            className="px-3 py-2 hk-btn-primary disabled:opacity-50"
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

      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-[color:var(--hk-muted)] flex items-center gap-2 flex-wrap">
          <button
            className="px-1 py-0.5 text-lg leading-none text-[color:var(--hk-muted)] hover:text-white"
            title="Open filters"
            onClick={() => setFiltersOpen(true)}
          >
            ›
          </button>
          <span>Filters</span>

          {fDate ? (
            <button className="hk-badge-good group" onClick={() => { setFDate(''); setPage(1); }}>
              <span>Date {fDate}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100">✕</span>
            </button>
          ) : null}

          {fType ? (
            <button className="hk-badge-good group" onClick={() => { setFType(''); setPage(1); }}>
              <span>Type {fType}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100">✕</span>
            </button>
          ) : null}

          {fSource ? (
            <button className="hk-badge-good group" onClick={() => { setFSource(''); setPage(1); }}>
              <span>Source {fSource}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100">✕</span>
            </button>
          ) : null}

          {fLocation ? (
            <button className="hk-badge-good group" onClick={() => { setFLocation(''); setPage(1); }}>
              <span>Location {fLocation}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100">✕</span>
            </button>
          ) : null}

          {fMerchant ? (
            <button className="hk-badge-good group" onClick={() => { setFMerchant(''); setPage(1); }}>
              <span>{fMerchant === MISSING ? 'Merchant missing' : `Merchant ${fMerchant}`}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100">✕</span>
            </button>
          ) : null}

          {fCategory ? (
            <button className="hk-badge-good group" onClick={() => { setFCategory(''); setPage(1); }}>
              <span>{fCategory === MISSING ? 'Category missing' : `Category ${fCategory}`}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100">✕</span>
            </button>
          ) : null}

          {fSubcategory ? (
            <button className="hk-badge-good group" onClick={() => { setFSubcategory(''); setPage(1); }}>
              <span>{fSubcategory === MISSING ? 'Subcategory missing' : `Subcategory ${fSubcategory}`}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100">✕</span>
            </button>
          ) : null}

          {fTags.length ? (
            <button className="hk-badge-good group" onClick={() => { setFTags([]); setPage(1); }}>
              <span>Tags {fTags.join(', ')}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100">✕</span>
            </button>
          ) : null}
        </div>

        <div className="flex gap-2">
          <button className="px-3 py-2 rounded-md hk-btn-secondary" onClick={() => { setFDate(''); setFType(''); setFSource(''); setFLocation(''); setFMerchant(''); setFCategory(''); setFSubcategory(''); setFTags([]); setPage(1); }}>
            Clear filters
          </button>
          {/* open filters moved to left side */}
        </div>
      </div>

      {filtersOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setFiltersOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[320px] md:w-[380px] bg-zinc-950 border-r [var(--hk-border)] p-4 overflow-auto">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Filters</div>
              <button className="text-[color:var(--hk-muted)] hover:text-white" onClick={() => setFiltersOpen(false)}>✕</button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3">
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Type</label>
            <input className="mt-1 w-full hk-input" list="hk-filter-type" value={fType} onChange={(e) => setFType(e.target.value)} placeholder="(all)" />
            <datalist id="hk-filter-type">
              {Array.from(new Set(rows.map((r:any)=>r.type))).filter(Boolean).sort().map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="mt-2 flex gap-2">
              <button
                className={`px-2 py-1 rounded border [var(--hk-border)] text-xs ${fType===''?'bg-zinc-800':'hk-btn-secondary'}`}
                onClick={() => setFType('')}
              >All</button>
              <button
                className={`px-2 py-1 rounded border [var(--hk-border)] text-xs ${fType==='EXPENSE'?'bg-zinc-800':'hk-btn-secondary'}`}
                onClick={() => setFType('EXPENSE')}
              >Expense</button>
              <button
                className={`px-2 py-1 rounded border [var(--hk-border)] text-xs ${fType==='INCOME'?'bg-zinc-800':'hk-btn-secondary'}`}
                onClick={() => setFType('INCOME')}
              >Income</button>
              <button
                className={`px-2 py-1 rounded border [var(--hk-border)] text-xs ${fType==='TRANSFER'?'bg-zinc-800':'hk-btn-secondary'}`}
                onClick={() => setFType('TRANSFER')}
              >Transfer</button>
            </div>
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Source</label>
            <input className="mt-1 w-full hk-input" list="hk-filter-source" value={fSource} onChange={(e) => setFSource(e.target.value)} placeholder="(all)" />
            <datalist id="hk-filter-source">
              {Array.from(new Set(rows.map((r:any)=> (r.messageId ? 'Mail' : (r.source_name || r.source)) )))
                .filter(Boolean)
                .sort()
                .map((s) => (
                  <option key={s} value={s} />
                ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Location</label>
            <input className="mt-1 w-full hk-input" list="hk-filter-location" value={fLocation} onChange={(e) => setFLocation(e.target.value)} placeholder="(all)" />
            <datalist id="hk-filter-location">
              {Array.from(new Set(rows.map((r:any)=>r.location_name || r.location))).filter(Boolean).sort().map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Tags (any)</label>
            <select
              multiple
              className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)] h-24"
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
            <div className="mt-1 text-[11px] text-[color:var(--hk-faint)]">Hold Ctrl/Cmd to select multiple</div>
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Merchant</label>
            <input className="mt-1 w-full hk-input" list="hk-filter-merchant" value={fMerchant} onChange={(e) => setFMerchant(e.target.value)} placeholder="(all)" />
            <datalist id="hk-filter-merchant">
              {Array.from(new Set(rows.map((r:any)=>r.merchant_name || r.merchant_code).filter(Boolean))).sort().map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Category</label>
            <input className="mt-1 w-full hk-input" list="hk-filter-category" value={fCategory} onChange={(e) => { setFCategory(e.target.value); setFSubcategory(''); }} placeholder="(all)" />
            <datalist id="hk-filter-category">
              {Array.from(new Set(rows.map((r:any)=>r.category_name || r.category).filter(Boolean))).sort().map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Subcategory</label>
            <input className="mt-1 w-full hk-input" list="hk-filter-subcategory" value={fSubcategory} onChange={(e) => setFSubcategory(e.target.value)} placeholder="(all)" />
            <datalist id="hk-filter-subcategory">
              {Array.from(new Set(rows.filter((r:any)=>!fCategory || (r.category_name||r.category)===fCategory || r.category===fCategory).map((r:any)=>r.subcategory_name || r.subcategory).filter(Boolean))).sort().map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="flex items-end">
            <button className="w-full px-3 py-2 rounded-md hk-btn-secondary" onClick={() => { setFDate(''); setFType(''); setFSource(''); setFLocation(''); setFMerchant(''); setFCategory(''); setFSubcategory(''); setFTags([]); setPage(1); }}>
              Clear filters
            </button>
          </div>
        </div>

            <div className="mt-4">
              <button className="w-full px-3 py-2 rounded-md hk-btn-secondary" onClick={() => setFiltersOpen(false)}>
                Close
              </button>
            </div>

            <div className="mt-3 text-xs text-[color:var(--hk-faint)]">Showing {filteredRows.length} / {rows.length} transactions</div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 text-xs text-[color:var(--hk-faint)]">
        Oldest loaded: {rows.length ? String(rows.reduce((min:any, r:any)=>{ const d=String(r.date||''); if(!d) return min; if(!min) return d; return d<min?d:min; }, null)) : '—'} • Showing {filteredRows.length} / {rows.length} transactions (filters). Transactions table paginates.
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Daily expense (trend)</div>
          <div className="mt-2 h-[220px]">
            <DailyLineChart
              labels={daily.map(x => x[0])}
              values={daily.map(x => Math.round(x[1]))}
              height={220}
              formatY={(v) => formatINR(v)}
              onPointClick={(label) => { setFDate(label); setPage(1); }}
            />
          </div>
        </div>

        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Top categories (click to filter)</div>
          {(() => {
            const h = Math.max(260, topCats.length * 28);
            return (
              <div className="mt-2" style={{ height: h }}>
                <SimpleBarChart
                  labels={topCats.map(x => x[0])}
                  values={topCats.map(x => Math.round(x[1]))}
                  height={h}
                  label="Expense"
                  indexAxis="y"
                  tickMax={100}
                  showValueLabels
                  formatValue={(v) => formatINR(v)}
                  onBarClick={(label) => { setFCategory(label); setFSubcategory(''); setPage(1); }}
                />
              </div>
            );
          })()}
        </div>

        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Top merchants (expense)</div>
          <div className="mt-2 h-[220px]">
            {(() => {
              const sums: Record<string, number> = {};
              for (const r of expenseRows) {
                const k = r.merchant_name || r.merchant_code || 'Unknown';
                sums[k] = (sums[k] || 0) + Number(r.amount || 0);
              }
              const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 8);
              return (
                <SimpleBarChart
                  labels={top.map(x => x[0])}
                  values={top.map(x => Math.round(x[1]))}
                  height={Math.max(260, top.length * 28)}
                  label="Expense"
                  indexAxis="y"
                  tickMax={50}
                  showValueLabels
                  formatValue={(v) => formatINR(v)}
                  onBarClick={(label) => {
                    setFType('EXPENSE');
                    setFMerchant(label === 'Unknown' ? MISSING : label);
                    setPage(1);
                  }}
                />
              );
            })()}
          </div>
        </div>

        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">By source (amount)</div>
          <div className="mt-2 h-[220px]">
            {(() => {
              const sums: Record<string, number> = {};
              for (const r of expenseRows) {
                // If a row comes from mail ingest, treat its source as "Mail".
                const k = r.messageId ? 'Mail' : (r.source_name || r.source || 'Unknown');
                sums[k] = (sums[k] || 0) + Number(r.amount || 0);
              }
              const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 10);
              return (
                <SimpleBarChart
                  labels={top.map(x => x[0])}
                  values={top.map(x => Math.round(x[1]))}
                  height={Math.max(260, top.length * 28)}
                  label="Expense"
                  indexAxis="y"
                  tickMax={50}
                  showValueLabels
                  formatValue={(v) => formatINR(v)}
                  onBarClick={(label) => { setFSource(label); setPage(1); }}
                />
              );
            })()}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Top subcategories (expense only)</div>
          <div className="mt-2 border [var(--hk-border)] rounded overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="hk-table-head">
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
                      <tr key={k} className="cursor-pointer hover:bg-white/5" onClick={() => { setFType('EXPENSE'); setFSubcategory(k === 'Uncategorized' ? MISSING : k); setPage(1); }}>
                        <td className="px-3 py-2">{k}</td>
                        <td className="px-3 py-2 text-right">{formatINR(v)}</td>
                      </tr>
                    ));
                })()}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Top merchants (expense only)</div>
          <div className="mt-2 border [var(--hk-border)] rounded overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="hk-table-head">
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
                      <tr key={k} className="cursor-pointer hover:bg-white/5" onClick={() => { setFType('EXPENSE'); setFMerchant(k === 'Unknown' ? MISSING : k); setPage(1); }}>
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

      {editTxnOpen ? (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setEditTxnOpen(false)}>
          <div className="w-full max-w-lg hk-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Edit transaction</div>
                <div className="text-xs text-[color:var(--hk-faint)] font-mono">{editTxn?.txn_id}</div>
              </div>
              <button className="text-[color:var(--hk-muted)] hover:text-white" onClick={() => setEditTxnOpen(false)}>✕</button>
            </div>

            <div className="mt-3 text-sm text-[color:var(--hk-muted)]">{editTxn ? `${editTxn.date} • ${formatINR(editTxn.amount)} • ${editTxn.raw_text || ''}` : ''}</div>
            {/* notice removed */}

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Merchant</label>
                <SearchSelect
                  value={editMerchant}
                  onChange={setEditMerchant}
                  options={merchantOptions.map((m) => ({ value: m.code, label: m.name }))}
                  placeholder="(none)"
                />
              </div>
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Category</label>
                <SearchSelect
                  value={editCategory}
                  onChange={(v) => {
                    setEditCategory(v);
                    const ok = subcategoryOptions.some((s) => s.code === editSubcategory && s.category === v);
                    if (!ok) setEditSubcategory('');
                  }}
                  options={categoryOptions.map((c) => ({ value: c.code, label: c.name }))}
                  placeholder="(none)"
                />
              </div>
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Subcategory</label>
                <SearchSelect
                  value={editSubcategory}
                  onChange={setEditSubcategory}
                  options={subcategoryOptions
                    .filter((s) => !editCategory || s.category === editCategory)
                    .map((s) => ({ value: s.code, label: s.name }))}
                  placeholder="(none)"
                  disabled={!editCategory}
                />
              </div>
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Tags</label>
                <input className="mt-1 w-full hk-input" value={editTags} onChange={(e) => setEditTags(e.target.value)} />
              </div>

              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Source</label>
                <SearchSelect
                  value={editSource}
                  onChange={setEditSource}
                  options={sourceOptions.map((s) => ({ value: s.code, label: s.display }))}
                  placeholder="(none)"
                />
              </div>
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Location</label>
                <SearchSelect
                  value={editLocation}
                  onChange={setEditLocation}
                  options={locationOptions.map((l) => ({ value: l.code, label: l.name }))}
                  placeholder="(none)"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-[color:var(--hk-muted)]">Notes</label>
              <input className="mt-1 w-full hk-input" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="hk-btn-secondary" onClick={() => setEditTxnOpen(false)}>Cancel</button>
              <button
                className="hk-btn-primary"
                onClick={async () => {
                  try {
                    if (!editTxn?.txn_id) return;
                    // Close modal immediately
                    setEditTxnOpen(false);

                    // 1) Save into Excel (job)
                    setBusy(true);
                    const r = await apiPut<{ ok: true; jobId: string }>(`/api/v1/txns/${encodeURIComponent(editTxn.txn_id)}`, {
                      merchant_code: editMerchant,
                      category: editCategory,
                      subcategory: editSubcategory,
                      source: editSource,
                      location: editLocation,
                      tags: editTags,
                      notes: editNotes
                    });

                    // Poll edit job
                    for (let i = 0; i < 60; i++) {
                      const jr = await apiGet<JobResp>(`/api/v1/jobs/${r.jobId}`);
                      if (jr.job.status === 'succeeded') break;
                      if (jr.job.status === 'failed') throw new Error('edit_failed');
                      await new Promise(res => setTimeout(res, 1000));
                    }

                    // 2) Rebuild selected range
                    const rb = await apiPost<RebuildResp>('/api/v1/rebuild', { from, to });
                    setLastJobId(rb.jobId);
                    for (let i = 0; i < 60; i++) {
                      const jr = await apiGet<JobResp>(`/api/v1/jobs/${rb.jobId}`);
                      if (jr.job.status === 'succeeded') break;
                      if (jr.job.status === 'failed') throw new Error('rebuild_failed');
                      await new Promise(res => setTimeout(res, 1000));
                    }

                    await loadData();
                    setBusy(false);
                  } catch (e: any) {
                    setBusy(false);
                    setErr(String(e?.message || e));
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-zinc-200">Transactions</h2>
          <div className="flex items-center gap-2 text-sm text-[color:var(--hk-muted)]">
            <span className="text-[color:var(--hk-faint)]">Page size</span>
            <select
              className="px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]"
              value={pageSize}
              onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }}
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button className="px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)] hover:bg-zinc-800 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <div className="text-[color:var(--hk-faint)]">{page} / {totalPages}</div>
            <button className="px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)] hover:bg-zinc-800 disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
        <div className="mt-2 hk-card overflow-auto max-h-[520px]">
          <table className="w-full text-sm">
            <thead className="hk-table-head sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2">Merchant</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Subcategory</th>
                <th className="text-left px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.txn_id} className="">
                  <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2 text-right">{formatINR(r.amount)}</td>
                  <td className="px-3 py-2">{r.merchant_name || r.merchant_code || ''}</td>
                  <td className="px-3 py-2">{r.messageId ? 'Mail' : (r.source_name || r.source || '')}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span>{r.category_name || r.category || ''}</span>
                      <button className="hk-btn-secondary px-2 py-1 text-xs" onClick={() => openEditTxn(r)}>
                        Edit
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.subcategory_name || r.subcategory || ''}</td>
                  <td className="px-3 py-2">{r.notes}</td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-[color:var(--hk-faint)]" colSpan={7}>No rows loaded (run rebuild).</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
