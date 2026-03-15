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
  const [editTxnErr, setEditTxnErr] = useState<string>('');
  const [editMerchant, setEditMerchant] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editSubcategory, setEditSubcategory] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSource, setEditSource] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editReimbStatus, setEditReimbStatus] = useState('');

  function parseAmountExpr(input: string): { ok: true; value: number } | { ok: false; error: string } {
    const raw = String(input || '').trim();
    if (!raw) return { ok: false, error: 'empty' };

    // Allow: plain number OR expressions like "=3373-2650".
    const expr0 = raw.startsWith('=') ? raw.slice(1) : raw;
    const expr = expr0.replace(/\s+/g, '');

    // Validate characters
    if (!/^[0-9+\-*.()]+$/.test(expr)) return { ok: false, error: 'bad_chars' };

    // Tokenize
    const tokens: string[] = [];
    let i = 0;
    while (i < expr.length) {
      const ch = expr[i];
      if (ch >= '0' && ch <= '9' || ch === '.') {
        let j = i + 1;
        while (j < expr.length && ((expr[j] >= '0' && expr[j] <= '9') || expr[j] === '.')) j++;
        tokens.push(expr.slice(i, j));
        i = j;
        continue;
      }
      if ('+-*()'.includes(ch)) {
        tokens.push(ch);
        i++;
        continue;
      }
      return { ok: false, error: 'bad_token' };
    }

    // Shunting-yard -> RPN (supports unary minus)
    const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2 };
    const out: string[] = [];
    const ops: string[] = [];

    const isOp = (t: string) => t === '+' || t === '-' || t === '*';
    const isNum = (t: string) => /^\d+(?:\.\d+)?$/.test(t);

    let prev: string | null = null;
    for (const t of tokens) {
      if (isNum(t)) {
        out.push(t);
        prev = 'num';
        continue;
      }

      if (t === '(') {
        ops.push(t);
        prev = '(';
        continue;
      }

      if (t === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
        if (!ops.length) return { ok: false, error: 'mismatched_parens' };
        ops.pop();
        prev = ')';
        continue;
      }

      if (isOp(t)) {
        // unary minus: if '-' and previous is start or '(' or another operator
        if (t === '-' && (!prev || prev === '(' || prev === 'op')) {
          // encode unary minus as 'u-'
          ops.push('u-');
          prev = 'op';
          continue;
        }

        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top === '(') break;
          if (top === 'u-') {
            out.push(ops.pop()!);
            continue;
          }
          if (prec[top] >= prec[t]) out.push(ops.pop()!);
          else break;
        }
        ops.push(t);
        prev = 'op';
        continue;
      }

      return { ok: false, error: 'bad_syntax' };
    }

    while (ops.length) {
      const op = ops.pop()!;
      if (op === '(') return { ok: false, error: 'mismatched_parens' };
      out.push(op);
    }

    // Evaluate RPN
    const st: number[] = [];
    for (const t of out) {
      if (isNum(t)) {
        st.push(Number(t));
        continue;
      }
      if (t === 'u-') {
        if (st.length < 1) return { ok: false, error: 'bad_unary' };
        st.push(-st.pop()!);
        continue;
      }
      if (t === '+' || t === '-' || t === '*') {
        if (st.length < 2) return { ok: false, error: 'bad_op' };
        const b = st.pop()!;
        const a = st.pop()!;
        const v = t === '+' ? a + b : t === '-' ? a - b : a * b;
        st.push(v);
        continue;
      }
      return { ok: false, error: 'bad_rpn' };
    }

    if (st.length !== 1 || !Number.isFinite(st[0])) return { ok: false, error: 'bad_result' };
    return { ok: true, value: st[0] };
  }

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitLines, setSplitLines] = useState<Array<{ amount: string; raw_text: string; merchant_code: string; category: string; subcategory: string; reimbursable?: boolean;  }>>([]);

  function openEditTxn(r: any) {
    setEditTxn(r);

    setEditMerchant(String(r.merchant_code || ''));
    setEditCategory(String(r.category || ''));
    setEditSubcategory(String(r.subcategory || ''));

    setEditTags(String(r.tags || ''));
    setEditNotes(String(r.notes || ''));
    setEditSource(String(r.source || ''));
    setEditLocation(String(r.location || ''));
    setEditAmount(String(r.amount ?? ''));
    setEditReimbStatus(String(r.reimb_status || ''));
    setEditTxnErr('');

    // prime split UI with 2 lines (common case)
    setSplitLines([
      { amount: '', raw_text: '', merchant_code: String(r.merchant_code || ''), category: String(r.category || ''), subcategory: String(r.subcategory || ''), reimbursable: false },
      { amount: '', raw_text: '', merchant_code: String(r.merchant_code || ''), category: String(r.category || ''), subcategory: String(r.subcategory || ''), reimbursable: false }
    ]);

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
  const [fSearch, setFSearch] = useState<string>('');
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

    const merch = r.merchant_known ? (r.merchant_name || '') : '';
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

    const tags: string[] = Array.isArray(r._tags)
      ? r._tags
      : String(r.tags || '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);

    // Hide archived rows by default. To see them, explicitly filter by the 'archived' tag.
    if (tags.includes('archived') && !fTags.includes('archived')) return false;

    if (fTags.length) {
      // Any-match (OR)
      if (!fTags.some((t) => tags.includes(t))) return false;
    }

    if (fSearch.trim()) {
      const hay = [
        r.txn_id,
        r.type,
        r.amount,
        r.raw_text,
        r.notes,
        r.merchant_name,
        r.merchant_code,
        r.category_name,
        r.category,
        r.subcategory_name,
        r.subcategory,
        r.source_name,
        r.source,
        r.location_name,
        r.location,
        tags.join(','),
      ]
        .filter(Boolean)
        .join(' | ');

      try {
        const re = new RegExp(fSearch, 'i');
        if (!re.test(hay)) return false;
      } catch {
        // fallback: substring match if regex is invalid
        if (!hay.toLowerCase().includes(fSearch.trim().toLowerCase())) return false;
      }
    }

    return true;
  });

  // Analytics rows (charts):
  // - If Type filter is EXPENSE, exclude rows categorized as TRANSFER (common data error).
  // - Otherwise (All / TRANSFER / INCOME), chart whatever is currently filtered.
  const analyticsRows = fType === 'EXPENSE'
    ? filteredRows.filter((r: any) => {
        if (r.type !== 'EXPENSE') return false;

        const rowCat = String(r.category || '');
        const rowCatName = String(r.category_name || '');
        const isTransferRow = rowCat === 'TRANSFER' || rowCatName === 'Transfers';

        const wantsTransfer = fCategory === 'TRANSFER' || fCategory === 'Transfers';

        // Common data error: transfer-category rows marked as EXPENSE.
        // Hide them for expense analytics by default, but if the user explicitly filters Transfers,
        // then show them (user intent is clear).
        if (isTransferRow && !wantsTransfer) return false;

        return true;
      })
    : filteredRows;

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageStart = (curPage - 1) * pageSize;
  const pageRows = filteredRows.slice(pageStart, pageStart + pageSize);

  const daily = (() => {
    const sums: Record<string, number> = {};
    for (const r of analyticsRows) {
      const k = r.date;
      sums[k] = (sums[k] || 0) + Number(r.amount || 0);
    }
    return Object.entries(sums).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const topCats = (() => {
    const sums: Record<string, number> = {};
    for (const r of analyticsRows) {
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

        <div className="flex gap-2 items-end">
          <div className="min-w-[240px]">
            <label className="text-[11px] text-[color:var(--hk-muted)]">Search</label>
            <input
              className="mt-1 hk-input"
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              placeholder="regex / text"
            />
          </div>
          <button
            className="px-3 py-2 rounded-md hk-btn-secondary"
            onClick={() => { setFDate(''); setFType(''); setFSource(''); setFLocation(''); setFMerchant(''); setFCategory(''); setFSubcategory(''); setFTags([]); setFSearch(''); setPage(1); }}
          >
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
          {/* Global search moved to header bar (next to Clear filters) */}

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
              {Array.from(new Set(rows.filter((r:any)=>r.merchant_known).map((r:any)=>r.merchant_name).filter(Boolean))).sort().map((m) => (
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
            <button className="w-full px-3 py-2 rounded-md hk-btn-secondary" onClick={() => { setFDate(''); setFType(''); setFSource(''); setFLocation(''); setFMerchant(''); setFCategory(''); setFSubcategory(''); setFTags([]); setFSearch(''); setPage(1); }}>
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
          <div className="text-sm font-semibold">Daily {fType ? fType.toLowerCase() : 'amount'} (trend)</div>
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
          <div className="text-sm font-semibold">Top categories ({fType ? fType.toLowerCase() : 'all'})</div>
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
          <div className="text-sm font-semibold">Top merchants ({fType ? fType.toLowerCase() : 'all'})</div>
          <div className="mt-2 h-[220px]">
            {(() => {
              const sums: Record<string, number> = {};
              for (const r of analyticsRows) {
                const k = r.merchant_known ? (r.merchant_name || 'Unknown') : 'Unknown';
                sums[k] = (sums[k] || 0) + Number(r.amount || 0);
              }
              const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 8);
              return (
                <SimpleBarChart
                  labels={top.map(x => x[0])}
                  values={top.map(x => Math.round(x[1]))}
                  height={Math.max(260, top.length * 28)}
                  label={fType ? fType : 'Amount'}
                  indexAxis="y"
                  tickMax={50}
                  showValueLabels
                  formatValue={(v) => formatINR(v)}
                  onBarClick={(label) => {
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
              for (const r of analyticsRows) {
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
                  for (const r of analyticsRows) {
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
                  for (const r of analyticsRows) {
                    const k = r.merchant_known ? (r.merchant_name || 'Unknown') : 'Unknown';
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
          <div className="w-full max-w-6xl hk-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Edit transaction</div>
                <div className="text-xs text-[color:var(--hk-faint)] font-mono">{editTxn?.txn_id}</div>
              </div>
              <button className="text-[color:var(--hk-muted)] hover:text-white" onClick={() => setEditTxnOpen(false)}>✕</button>
            </div>

            <div className="mt-3 text-sm text-[color:var(--hk-muted)]">{editTxn ? `${editTxn.date} • ${formatINR(editTxn.amount)} • ${editTxn.raw_text || ''}` : ''}</div>
            {/* notice removed */}

            <div className={`mt-4 grid grid-cols-1 ${splitOpen ? 'lg:grid-cols-[1fr_420px]' : ''} gap-4`}>
              {/* Left: main edit form */}
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Amount</label>
                    <input
                      className="mt-1 w-full hk-input"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const r = parseAmountExpr(editAmount);
                          if (r.ok) setEditAmount(String(Math.round(r.value * 100) / 100));
                        }
                      }}
                      placeholder="e.g. 498 or =3373-2650"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Merchant</label>
                    <SearchSelect
                      value={editMerchant}
                      onChange={(v) => {
                        setEditMerchant(v);
                        const m = merchantOptions.find((x: any) => x.code === v) as any;
                        const defCat = String(m?.default?.category || m?.defaultCategory || '').trim();
                        const defSub = String(m?.default?.subcategory || m?.defaultSubcategory || '').trim();
                        if (defCat) {
                          setEditCategory(defCat);
                          if (defSub) {
                            setEditSubcategory(defSub);
                          } else {
                            const first = subcategoryOptions.find((s: any) => s.category === defCat);
                            setEditSubcategory(first ? first.code : '');
                          }
                        }
                      }}
                      options={merchantOptions.map((m: any) => ({ value: m.code, label: m.name || m.code }))}
                      placeholder="(none)"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Category</label>
                    <SearchSelect
                      value={editCategory}
                      onChange={(v) => {
                        setEditCategory(v);
                        const ok = subcategoryOptions.some((s: any) => s.code === editSubcategory && s.category === v);
                        if (!ok) {
                          const first = subcategoryOptions.find((s: any) => s.category === v);
                          setEditSubcategory(first ? first.code : '');
                        }
                      }}
                      options={categoryOptions.map((c: any) => ({ value: c.code, label: c.name || c.code }))}
                      placeholder="(none)"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Subcategory</label>
                    <SearchSelect
                      value={editSubcategory}
                      onChange={setEditSubcategory}
                      options={subcategoryOptions.filter((s) => !editCategory || s.category === editCategory).map((s) => ({ value: s.code, label: s.name }))}
                      placeholder="(none)"
                      disabled={!editCategory}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Tags</label>
                    <input className="mt-1 w-full hk-input" value={editTags} onChange={(e) => setEditTags(e.target.value)} />
                    <div className="mt-2 flex flex-col gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-[color:var(--hk-muted)]">
                        <input
                          type="checkbox"
                          checked={String(editTags || '').split(',').map(s => s.trim()).filter(Boolean).includes('reimbursable')}
                          onChange={(e) => {
                            const parts = String(editTags || '').split(',').map(s => s.trim()).filter(Boolean);
                            const has = parts.includes('reimbursable');
                            const next = e.target.checked ? (has ? parts : parts.concat(['reimbursable'])) : parts.filter(x => x !== 'reimbursable');
                            setEditTags(next.join(','));
                            setEditReimbStatus(e.target.checked ? 'expected' : '');
                          }}
                        />
                        Reimbursable
                      </label>

                      <label className="inline-flex items-center gap-2 text-xs text-[color:var(--hk-muted)]">
                        <input
                          type="checkbox"
                          checked={String(editTags || '').split(',').map(s => s.trim()).filter(Boolean).includes('for_others')}
                          onChange={(e) => {
                            const parts = String(editTags || '').split(',').map(s => s.trim()).filter(Boolean);
                            const has = parts.includes('for_others');
                            const next = e.target.checked ? (has ? parts : parts.concat(['for_others'])) : parts.filter(x => x !== 'for_others');
                            setEditTags(next.join(','));
                          }}
                        />
                        For someone else
                      </label>

                      <label className="inline-flex items-center gap-2 text-xs text-[color:var(--hk-muted)]">
                        <input
                          type="checkbox"
                          checked={String(editTags || '').split(',').map(s => s.trim()).filter(Boolean).includes('archived')}
                          onChange={(e) => {
                            const parts = String(editTags || '').split(',').map(s => s.trim()).filter(Boolean);
                            const has = parts.includes('archived');
                            const next = e.target.checked ? (has ? parts : parts.concat(['archived'])) : parts.filter(x => x !== 'archived');
                            setEditTags(next.join(','));
                          }}
                        />
                        Archived (hide)
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Source</label>
                    <SearchSelect value={editSource} onChange={setEditSource} options={sourceOptions.map((s) => ({ value: s.code, label: s.display }))} placeholder="(none)" />
                  </div>
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Location</label>
                    <SearchSelect value={editLocation} onChange={setEditLocation} options={locationOptions.map((l) => ({ value: l.code, label: l.name }))} placeholder="(none)" />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="text-xs text-[color:var(--hk-muted)]">Notes</label>
                  <input className="mt-1 w-full hk-input" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
                </div>

                <div className="mt-4 flex justify-between gap-2 flex-wrap">
                  <button className="hk-btn-secondary disabled:opacity-50" disabled={busy} onClick={() => { setSplitOpen(!splitOpen); }}>Split…</button>
                  <div className="flex flex-col items-end gap-2">
                    {editTxnErr ? (
                      <div className="max-w-[520px] text-xs text-red-400">{editTxnErr}</div>
                    ) : null}
                    <div className="flex justify-end gap-2">
                      <button className="hk-btn-secondary disabled:opacity-50" disabled={busy} onClick={() => setEditTxnOpen(false)}>Cancel</button>
                      <button
                      className="hk-btn-primary disabled:opacity-50"
                      disabled={busy}
                      onClick={async () => {
                        if (busy) return;
                        try {
                          if (!editTxn?.txn_id) return;
                          setEditTxnErr('');
                          setBusy(true);

                          const pr = parseAmountExpr(editAmount);
                          if (!pr.ok) throw new Error('bad_amount');

                          const r = await apiPut<{ ok: true; jobId: string }>(`/api/v1/txns/${encodeURIComponent(editTxn.txn_id)}`, {
                            amount: pr.value,
                            merchant_code: editMerchant,
                            category: editCategory,
                            subcategory: editSubcategory,
                            source: editSource,
                            location: editLocation,
                            tags: editTags,
                            reimb_status: editReimbStatus,
                            notes: editNotes
                          });

                          for (let i = 0; i < 60; i++) {
                            const jr = await apiGet<JobResp>(`/api/v1/jobs/${r.jobId}`);
                            if (jr.job.status === 'succeeded') break;
                            if (jr.job.status === 'failed') throw new Error('edit_failed');
                            await new Promise(res => setTimeout(res, 1000));
                          }

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
                          setEditTxnOpen(false);
                        } catch (e: any) {
                          setBusy(false);
                          const msg = String(e?.message || e);
                          setEditTxnErr(msg);
                          setErr(msg);
                        }
                      }}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: split drawer */}
              {splitOpen ? (
                <div className="border-l [var(--hk-border)] pl-4 max-h-[80vh] overflow-auto">
                  <div className="text-sm font-semibold">Split transaction</div>
                  <div className="mt-1 text-xs text-[color:var(--hk-muted)]">
                    Original will be tagged <span className="font-mono">superseded</span>.
                  </div>

                  {/* Split uses selects (not SearchSelect) to avoid dropdown clipping inside scroll container */}

                  <div className="mt-3 space-y-2">
                    {splitLines.map((ln, idx) => (
                      <div key={idx} className="grid grid-cols-1 gap-2">
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-xs text-[color:var(--hk-muted)]">Amt</label>
                            <input className="mt-1 w-full hk-input" value={ln.amount} onChange={(e) => setSplitLines(xs => xs.map((x,i)=> i===idx?{...x, amount:e.target.value}:x))} />
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-[color:var(--hk-muted)]">Text</label>
                            <input className="mt-1 w-full hk-input" value={ln.raw_text} onChange={(e) => setSplitLines(xs => xs.map((x,i)=> i===idx?{...x, raw_text:e.target.value}:x))} />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          <div>
                            <label className="text-xs text-[color:var(--hk-muted)]">Merchant</label>
                            <SearchSelect
                              portal
                              value={ln.merchant_code}
                              onChange={(v) => {
                                setSplitLines(xs => xs.map((x,i)=> {
                                  if (i!==idx) return x;
                                  const m = merchantOptions.find((mm:any) => mm.code === v) as any;
                                  const defCat = String(m?.default?.category || m?.defaultCategory || '').trim();
                                  const defSub = String(m?.default?.subcategory || m?.defaultSubcategory || '').trim();
                                  const nextCat = defCat || x.category;
                                  let nextSub = x.subcategory;
                                  if (defCat) {
                                    if (defSub) nextSub = defSub;
                                    else {
                                      const first = subcategoryOptions.find((s:any) => s.category === defCat);
                                      nextSub = first ? first.code : '';
                                    }
                                  }
                                  return { ...x, merchant_code: v, category: nextCat, subcategory: nextSub };
                                }));
                              }}
                              options={merchantOptions.map((m) => ({ value: m.code, label: m.name || m.code }))}
                              placeholder="(none)"
                            />

                            <label className="mt-2 inline-flex items-center gap-2 text-xs text-[color:var(--hk-muted)]">
                              <input
                                type="checkbox"
                                checked={!!ln.reimbursable}
                                onChange={(e) => setSplitLines(xs => xs.map((x,i)=> i===idx?{...x, reimbursable:e.target.checked}:x))}
                              />
                              Reimbursable
                            </label>
                          </div>
                          <div>
                            <label className="text-xs text-[color:var(--hk-muted)]">Category</label>
                            <SearchSelect
                              portal
                              value={ln.category}
                              onChange={(v) => {
                                const first = subcategoryOptions.find((s:any) => s.category === v);
                                setSplitLines(xs => xs.map((x,i)=> i===idx?{...x, category:v, subcategory: first ? first.code : ''}:x));
                              }}
                              options={categoryOptions.map((c) => ({ value: c.code, label: c.name || c.code }))}
                              placeholder="(none)"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-[color:var(--hk-muted)]">Subcategory</label>
                            <SearchSelect
                              portal
                              value={ln.subcategory}
                              onChange={(v) => setSplitLines(xs => xs.map((x,i)=> i===idx?{...x, subcategory:v}:x))}
                              options={subcategoryOptions.filter((s) => !ln.category || s.category === ln.category).map((s) => ({ value: s.code, label: s.name || s.code }))}
                              placeholder="(none)"
                              disabled={!ln.category}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex justify-between gap-2">
                    <button className="hk-btn-secondary" onClick={() => setSplitLines(xs => xs.concat([{ amount:'', raw_text:'', merchant_code: editMerchant, category: editCategory, subcategory: editSubcategory, reimbursable: false }]))}>+ Add line</button>
                    <button
                      className="hk-btn-primary"
                      onClick={async () => {
                        try {
                          if (!editTxn?.txn_id) return;
                          const splits = splitLines
                            .map((x) => ({
                              amount: Number(x.amount),
                              raw_text: x.raw_text,
                              merchant_code: x.merchant_code,
                              category: x.category,
                              subcategory: x.subcategory,
                              reimb_status: x.reimbursable ? 'expected' : '',
                              tags: x.reimbursable ? 'reimbursable' : ''
                            }))
                            .filter((x) => Number.isFinite(x.amount) && x.amount > 0);
                          if (!splits.length) throw new Error('no_split_lines');

                          setBusy(true);
                          setErr(null);
                          const r = await apiPost<{ ok: true; jobId: string }>(`/api/v1/txns/${encodeURIComponent(editTxn.txn_id)}/split`, { splits });
                          for (let i = 0; i < 60; i++) {
                            const jr = await apiGet<JobResp>(`/api/v1/jobs/${r.jobId}`);
                            if (jr.job.status === 'succeeded') break;
                            if (jr.job.status === 'failed') throw new Error('split_failed');
                            await new Promise(res => setTimeout(res, 1000));
                          }

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
                          setSplitOpen(false);
                          setEditTxnOpen(false);
                        } catch (e: any) {
                          setBusy(false);
                          setErr(String(e?.message || e));
                        }
                      }}
                    >
                      Split + rebuild
                    </button>
                  </div>
                </div>
              ) : null}
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
            <div className="flex items-center gap-2">
              <div className="text-[color:var(--hk-faint)]">{page} / {totalPages}</div>
              <input
                className="w-[72px] px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)] text-sm"
                defaultValue={String(page)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const v = Number((e.target as HTMLInputElement).value);
                  if (!Number.isFinite(v)) return;
                  const next = Math.max(1, Math.min(totalPages, Math.floor(v)));
                  setPage(next);
                }}
                placeholder="page"
                title="Type a page number and press Enter"
              />
            </div>
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
                  <td className="px-3 py-2">{r.merchant_known ? (r.merchant_name || '') : ''}</td>
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
