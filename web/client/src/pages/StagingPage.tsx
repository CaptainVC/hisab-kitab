import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../api/client';

type MerchantRef = { code: string; name: string; archived?: boolean };
type CategoryRef = { code: string; name: string; archived?: boolean };
type SubcategoryRef = { code: string; name: string; category: string; archived?: boolean };
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

  const [merchRefs, setMerchRefs] = useState<MerchantRef[]>([]);
  const [catRefs, setCatRefs] = useState<CategoryRef[]>([]);
  const [subRefs, setSubRefs] = useState<SubcategoryRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLog, setJobLog] = useState('');

  async function ensureRefsLoaded(force = false) {
    if (!force && merchRefs.length && catRefs.length && subRefs.length) return;
    try {
      const [m, c, s] = await Promise.all([
        apiGet<{ ok: true; merchants: any[] }>('/api/v1/refs/merchants'),
        apiGet<{ ok: true; categories: any[] }>('/api/v1/refs/categories'),
        apiGet<{ ok: true; subcategories: any[] }>('/api/v1/refs/subcategories')
      ]);
      setMerchRefs((m.merchants || []).filter((x) => !x.archived));
      setCatRefs((c.categories || []).filter((x) => !x.archived));
      setSubRefs((s.subcategories || []).filter((x) => !x.archived));
    } catch {
      // non-fatal; staging can work without refs
    }
  }

  async function doParse() {
    setBusy(true);
    setErr(null);
    try {
      await ensureRefsLoaded();
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

  useEffect(() => {
    ensureRefsLoaded().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const merchCodes = useMemo(() => new Set(merchRefs.map((m) => m.code)), [merchRefs]);
  const catCodes = useMemo(() => new Set(catRefs.map((c) => c.code)), [catRefs]);
  const subCodes = useMemo(() => new Map(subRefs.map((s) => [s.code, s.category] as const)), [subRefs]);

  function isValidMerchant(code: string) {
    if (!code) return true;
    if (merchRefs.length === 0) return true;
    return merchCodes.has(code);
  }
  function isValidCategory(code: string) {
    if (!code) return true;
    if (catRefs.length === 0) return true;
    return catCodes.has(code);
  }
  function isValidSubcategory(cat: string, sub: string) {
    if (!sub) return true;
    if (subRefs.length === 0) return true;
    const parent = subCodes.get(sub);
    if (!parent) return false;
    if (!cat) return true;
    return parent === cat;
  }

  function normalizeTagsCsv(csv: string): string {
    const tags = String(csv || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const uniq = Array.from(new Set(tags));
    return uniq.join(',');
  }

  async function quickAddMerchant(code: string) {
    const c = String(code || '').trim();
    if (!c) return;
    if (merchCodes.has(c)) return;
    const name = prompt(`Merchant name for ${c}:`, c);
    if (name === null) return;
    await apiPut(`/api/v1/refs/merchants/${encodeURIComponent(c)}`, { name });
    await ensureRefsLoaded(true);
  }

  async function quickAddCategory(code: string) {
    const c = String(code || '').trim();
    if (!c) return;
    if (catCodes.has(c)) return;
    const name = prompt(`Category name for ${c}:`, c);
    if (name === null) return;
    await apiPut(`/api/v1/refs/categories/${encodeURIComponent(c)}`, { name });
    await ensureRefsLoaded(true);
  }

  async function quickAddSubcategory(category: string, subcategory: string) {
    const sub = String(subcategory || '').trim();
    const cat = String(category || '').trim();
    if (!sub) return;
    const existingParent = subCodes.get(sub);
    if (existingParent) return;
    const name = prompt(`Subcategory name for ${sub}:`, sub);
    if (name === null) return;
    const parent = cat || prompt(`Parent category code for ${sub}:`, '') || '';
    await apiPut(`/api/v1/refs/subcategories/${encodeURIComponent(sub)}`, { name, category: String(parent).trim() });
    await ensureRefsLoaded(true);
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Staging</h1>
          <p className="text-[color:var(--hk-muted)] mt-1">Paste a /hisab block. Parse preview first, then commit to Excel.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Rebuild from</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={from} onChange={(e) => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Rebuild to</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={to} onChange={(e) => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 hk-card">
          <label className="text-xs text-[color:var(--hk-muted)]">Hisab text</label>
          <textarea
            className="mt-1 w-full h-56 px-3 py-2 rounded bg-zinc-900 border [var(--hk-border)] font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="/hisab Day (08/03/26)\n260/- Something (mk)"
          />
          {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}
          <div className="mt-3 flex gap-2 flex-wrap">
            <button className="px-3 py-2 rounded-md hk-btn-secondary disabled:opacity-50" disabled={busy || !text.trim()} onClick={() => doParse()}>
              {busy ? 'Working…' : 'Parse preview'}
            </button>
            <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy || !text.trim()} onClick={() => doCommitText(false)}>
              Commit text
            </button>
            <button
              className="px-3 py-2 rounded-md hk-btn-secondary disabled:opacity-50 text-zinc-100"
              disabled={busy || parseRows.length === 0}
              onClick={() => setParseRows((xs) => xs.map((r) => ({ ...r, tags: normalizeTagsCsv(r.tags || '') })))}
            >
              Normalize tags
            </button>
            <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy || parseRows.length === 0} onClick={() => doCommitRows(false)}>
              Commit edited rows
            </button>
            <button className="px-3 py-2 rounded-md hk-btn-primary disabled:opacity-50" disabled={busy || parseRows.length === 0} onClick={() => doCommitRows(true)}>
              Commit rows + rebuild cache
            </button>
          </div>
        </div>

        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Preview</div>
          <div className="mt-2 text-xs text-[color:var(--hk-faint)]">Rows: {parseRows.length} • Errors: {parseErrors.length}</div>

          {parseErrors.length ? (
            <pre className="mt-2 p-2 rounded bg-zinc-950 border [var(--hk-border)] text-xs overflow-auto max-h-40 whitespace-pre-wrap">{JSON.stringify(parseErrors, null, 2)}</pre>
          ) : null}

          <div className="mt-3 border [var(--hk-border)] rounded overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="hk-table-head">
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
                  <tr key={r.txn_id} className="border-t [var(--hk-border)]">
                    <td className="px-2 py-1 whitespace-nowrap">{r.date}</td>
                    <td className="px-2 py-1 text-right">{formatINR(r.amount)}</td>
                    <td className="px-2 py-1">{r.source}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          list="hk_merchants"
                          className={`w-28 px-1 py-0.5 rounded bg-zinc-950 border ${isValidMerchant(r.merchant_code || '') ? '[var(--hk-border)]' : 'border-amber-500'}`}
                          value={r.merchant_code || ''}
                          onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, merchant_code: e.target.value } : it))}
                        />
                        {!isValidMerchant(r.merchant_code || '') ? (
                          <button className="px-1.5 py-0.5 rounded bg-emerald-500 text-emerald-950 text-[11px]" onClick={() => quickAddMerchant(r.merchant_code || '').catch(() => {})}>
                            +
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          list="hk_categories"
                          className={`w-24 px-1 py-0.5 rounded bg-zinc-950 border ${isValidCategory(r.category || '') ? '[var(--hk-border)]' : 'border-amber-500'}`}
                          value={r.category || ''}
                          onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, category: e.target.value } : it))}
                        />
                        {!isValidCategory(r.category || '') ? (
                          <button className="px-1.5 py-0.5 rounded bg-emerald-500 text-emerald-950 text-[11px]" onClick={() => quickAddCategory(r.category || '').catch(() => {})}>
                            +
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          list={`hk_subcats_${r.txn_id}`}
                          className={`w-28 px-1 py-0.5 rounded bg-zinc-950 border ${isValidSubcategory(r.category || '', r.subcategory || '') ? '[var(--hk-border)]' : 'border-amber-500'}`}
                          value={r.subcategory || ''}
                          onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, subcategory: e.target.value } : it))}
                        />
                        {!isValidSubcategory(r.category || '', r.subcategory || '') ? (
                          <button className="px-1.5 py-0.5 rounded bg-emerald-500 text-emerald-950 text-[11px]" onClick={() => quickAddSubcategory(r.category || '', r.subcategory || '').catch(() => {})}>
                            +
                          </button>
                        ) : null}
                      </div>
                      <datalist id={`hk_subcats_${r.txn_id}`}>
                        {subRefs
                          .filter((s) => !r.category || s.category === r.category)
                          .map((s) => (
                            <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                          ))}
                      </datalist>
                      <div className="mt-1">
                        <input className="w-28 px-1 py-0.5 rounded bg-zinc-950 border [var(--hk-border)] text-[11px]" value={r.tags || ''} placeholder="tags" onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, tags: e.target.value } : it))} />
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-40 px-1 py-0.5 rounded bg-zinc-950 border [var(--hk-border)]" value={r.notes || ''} onChange={(e) => setParseRows((xs) => xs.map((it) => it.txn_id === r.txn_id ? { ...it, notes: e.target.value } : it))} />
                    </td>
                  </tr>
                ))}
                {parseRows.length === 0 ? (
                  <tr><td className="px-2 py-2 text-[color:var(--hk-faint)]" colSpan={7}>Parse something to see preview.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <datalist id="hk_merchants">
        {merchRefs.map((m) => (
          <option key={m.code} value={m.code}>{m.code} — {m.name}</option>
        ))}
      </datalist>
      <datalist id="hk_categories">
        {catRefs.map((c) => (
          <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
        ))}
      </datalist>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Commit job log {jobId ? `(job ${jobId})` : ''}</h2>
        <pre className="mt-2 p-3 hk-card bg-zinc-950 text-xs overflow-auto max-h-[320px] whitespace-pre-wrap">{jobLog || '(no commit run yet)'}</pre>
      </div>
    </div>
  );
}
