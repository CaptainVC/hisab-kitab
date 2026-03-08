import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../api/client';
import { loadRange, saveRange } from '../app/range';
import { formatINR } from '../app/format';

type ReviewItem = {
  txn_id: string;
  date: string;
  amount: number;
  type: string;
  merchant: string;
  category: string;
  subcategory: string;
  notes: string;
  reason: string;
  origin?: 'MAIL' | 'HISAB';
  source?: string;
  messageId?: string;
  parse_status?: string;
  parse_error?: string;
};

type MerchantRef = { code: string; name: string; archived?: boolean };
type CategoryRef = { code: string; name: string; archived?: boolean };
type SubcategoryRef = { code: string; name: string; category: string; archived?: boolean };

type ItemsResp = { ok: true; count: number; oldestDate?: string | null; items: ReviewItem[] };

export default function ReviewPage() {
  const def = useMemo(() => loadRange(), []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [oldestDate, setOldestDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<Record<string, { merchant: string; category: string; subcategory: string; tags: string }>>({});

  const [merchRefs, setMerchRefs] = useState<MerchantRef[]>([]);
  const [catRefs, setCatRefs] = useState<CategoryRef[]>([]);
  const [subRefs, setSubRefs] = useState<SubcategoryRef[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<'off' | 'merchant'>('merchant');

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<ItemsResp>(`/api/v1/review/items?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setItems(r.items);
      setOldestDate((r.oldestDate as any) ?? null);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(txn_id: string) {
    await apiPost('/api/v1/review/resolve', { txn_id });
    setItems((xs) => xs.filter((x) => x.txn_id !== txn_id));
  }

  async function saveAndResolve(x: ReviewItem) {
    const ed = editing[x.txn_id] || { merchant: x.merchant, category: x.category, subcategory: x.subcategory, tags: '' };
    const merchant = String(ed.merchant || '').trim();
    const category = String(ed.category || '').trim();
    const subcategory = String(ed.subcategory || '').trim();
    const tags = String(ed.tags || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!merchant) throw new Error('missing_merchant');
    if (!category || !subcategory) throw new Error('missing_category');

    const toResolve = bulkMode === 'merchant'
      ? items.filter((it) => (editing[it.txn_id]?.merchant ?? it.merchant) === merchant).map((it) => it.txn_id)
      : [x.txn_id];

    setSavingId(x.txn_id);
    try {
      // Persist as merchant default mapping so future imports auto-classify.
      await apiPut(`/api/v1/refs/merchants/${encodeURIComponent(merchant)}`, {
        defaultCategory: category,
        defaultSubcategory: subcategory,
        defaultTags: tags
      });

      // Resolve current (and optionally other items for same merchant)
      for (const id of toResolve) {
        // eslint-disable-next-line no-await-in-loop
        await apiPost('/api/v1/review/resolve', { txn_id: id });
      }

      setItems((xs) => xs.filter((it) => !toResolve.includes(it.txn_id)));
      setEditing((m) => {
        const n = { ...m };
        for (const id of toResolve) delete n[id];
        return n;
      });
    } finally {
      setSavingId(null);
    }
  }

  async function ensureRefsLoaded() {
    if (merchRefs.length && catRefs.length && subRefs.length) return;
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
      // ignore
    }
  }

  useEffect(() => {
    ensureRefsLoaded().catch(() => {});
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto reload when range changes (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      load().catch(() => {});
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  return (
    <div>
      <datalist id="hk_merchants">
        {merchRefs.map((m) => (
          <option key={m.code} value={m.code}>{m.code} — {m.name}</option>
        ))}
      </datalist>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Needs Review</h1>
          <p className="text-zinc-400 mt-1">Auto-generated list: parse errors + missing category/subcategory (excluding resolved).</p>
          <div className="mt-1 text-xs text-zinc-500">Oldest pending item: {oldestDate || '—'}</div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-zinc-400">From</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={from} onChange={e => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">To</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={to} onChange={e => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
          </div>
          <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50" disabled={busy} onClick={() => load().catch(() => {})}>
            {busy ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      <div className="mt-4 flex items-center gap-3 text-sm">
        <div className="text-zinc-400">Bulk resolve on Save:</div>
        <label className="flex items-center gap-2">
          <input type="radio" name="bulk" checked={bulkMode === 'merchant'} onChange={() => setBulkMode('merchant')} />
          <span>Same merchant</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="bulk" checked={bulkMode === 'off'} onChange={() => setBulkMode('off')} />
          <span>Only this item</span>
        </label>
      </div>

      <div className="mt-6 border border-zinc-800 rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-300">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-right px-3 py-2">Amt</th>
              <th className="text-left px-3 py-2">Origin</th>
              <th className="text-left px-3 py-2">Merchant</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Subcategory</th>
              <th className="text-left px-3 py-2">Reason</th>
              <th className="text-left px-3 py-2">Note</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.txn_id} className="border-t border-zinc-800">
                <td className="px-3 py-2 whitespace-nowrap">{x.date}</td>
                <td className="px-3 py-2 text-right">{formatINR(x.amount)}</td>
                <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">
                  <div>{x.origin || (x.messageId ? 'MAIL' : 'HISAB')}</div>
                  {x.source ? <div className="text-[11px] text-zinc-500 font-mono">{x.source}</div> : null}
                </td>
                <td className="px-3 py-2">
                  <input
                    list="hk_merchants"
                    className="w-36 px-2 py-1 rounded bg-zinc-900 border border-zinc-800"
                    value={(editing[x.txn_id]?.merchant ?? x.merchant) || ''}
                    placeholder="Merchant"
                    onChange={(e) =>
                      setEditing((m) => ({
                        ...m,
                        [x.txn_id]: {
                          merchant: e.target.value,
                          category: m[x.txn_id]?.category ?? x.category,
                          subcategory: m[x.txn_id]?.subcategory ?? x.subcategory,
                          tags: m[x.txn_id]?.tags ?? ''
                        }
                      }))
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    className="w-40 px-2 py-1 rounded bg-zinc-900 border border-zinc-800"
                    value={(editing[x.txn_id]?.category ?? x.category) || ''}
                    onChange={(e) =>
                      setEditing((m) => ({
                        ...m,
                        [x.txn_id]: {
                          merchant: m[x.txn_id]?.merchant ?? x.merchant,
                          category: e.target.value,
                          subcategory: '',
                          tags: m[x.txn_id]?.tags ?? ''
                        }
                      }))
                    }
                  >
                    <option value="">(select)</option>
                    {catRefs.map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {(() => {
                    const cat = (editing[x.txn_id]?.category ?? x.category) || '';
                    const subVal = (editing[x.txn_id]?.subcategory ?? x.subcategory) || '';
                    const opts = subRefs.filter((s) => s.category === cat);
                    return (
                      <>
                        <select
                          className="w-44 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 disabled:opacity-50"
                          disabled={!cat}
                          value={subVal}
                          onChange={(e) =>
                            setEditing((m) => ({
                              ...m,
                              [x.txn_id]: {
                                merchant: m[x.txn_id]?.merchant ?? x.merchant,
                                category: cat,
                                subcategory: e.target.value,
                                tags: m[x.txn_id]?.tags ?? ''
                              }
                            }))
                          }
                        >
                          <option value="">(select)</option>
                          {opts.map((s) => (
                            <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                          ))}
                        </select>
                        <div className="mt-1">
                          <input
                            className="w-44 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs"
                            value={editing[x.txn_id]?.tags ?? ''}
                            placeholder="tags (comma-separated)"
                            onChange={(e) =>
                              setEditing((m) => ({
                                ...m,
                                [x.txn_id]: {
                                  merchant: m[x.txn_id]?.merchant ?? x.merchant,
                                  category: cat,
                                  subcategory: m[x.txn_id]?.subcategory ?? '',
                                  tags: e.target.value
                                }
                              }))
                            }
                          />
                        </div>
                      </>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-zinc-400">{x.reason}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">
                  <div className="max-w-[280px] truncate" title={x.notes || ''}>{x.notes || '—'}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button
                      className="px-2 py-1 rounded bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50"
                      disabled={savingId === x.txn_id}
                      onClick={() => saveAndResolve(x).catch((e) => setErr(String(e?.message || e)))}
                    >
                      {savingId === x.txn_id ? 'Saving…' : 'Save + resolve'}
                    </button>
                    <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => resolve(x.txn_id).catch(() => {})}>
                      Resolve only
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-zinc-500" colSpan={9}>Nothing to review.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
