import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
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
  // Save+resolve removed: resolving is explicit per item.

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
    await resolveOne(txn_id);
  }

  const [reimbOpen, setReimbOpen] = useState(false);
  const [reimbTxn, setReimbTxn] = useState<ReviewItem | null>(null);
  const [reimbAmount, setReimbAmount] = useState('');
  const [reimbCounterparty, setReimbCounterparty] = useState('');
  const [reimbNote, setReimbNote] = useState('');
  const [banner, setBanner] = useState<string | null>(null);

  async function submitReimbursement() {
    if (!reimbTxn) return;
    const amount = Number(reimbAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('bad_amount');

    const r = await apiPost<{ ok: true; jobId: string }>('/api/v1/review/reimburse', {
      from,
      to,
      txn_id: reimbTxn.txn_id,
      amount,
      counterparty: reimbCounterparty,
      note: reimbNote
    });

    // Auto-resolve after queuing reimbursement
    await resolve(reimbTxn.txn_id);

    setReimbOpen(false);
    setReimbTxn(null);
    setReimbAmount('');
    setReimbCounterparty('');
    setReimbNote('');

    setBanner(`Reimbursement queued (job ${r.jobId}). See Jobs for details.`);
    setTimeout(() => setBanner(null), 6000);
  }

  function openReimburse(x: ReviewItem) {
    setReimbTxn(x);
    setReimbAmount('');
    setReimbCounterparty('');
    setReimbNote('');
    setReimbOpen(true);
  }

  async function resolveOne(txn_id: string) {
    await apiPost('/api/v1/review/resolve', { txn_id });
    setItems((xs) => xs.filter((x) => x.txn_id !== txn_id));
    setEditing((m) => {
      const n = { ...m };
      delete n[txn_id];
      return n;
    });
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
          <option key={m.code} value={m.code} />
        ))}
      </datalist>

      <datalist id="hk_categories">
        {catRefs.map((c) => (
          <option key={c.code} value={c.code} />
        ))}
      </datalist>

      <datalist id="hk_subcategories">
        {subRefs.map((s) => (
          <option key={s.code} value={s.code} />
        ))}
      </datalist>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Needs Review</h1>
          <p className="text-[color:var(--hk-muted)] mt-1">Auto-generated list: parse errors + missing category/subcategory (excluding resolved).</p>
          <div className="mt-1 text-xs text-[color:var(--hk-faint)]">Oldest pending item: {oldestDate || '—'}</div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">From</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={from} onChange={e => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">To</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={to} onChange={e => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
          </div>
          <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy} onClick={() => load().catch(() => {})}>
            {busy ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {banner ? (
        <div className="mt-3 text-sm border border-emerald-900 bg-emerald-950/20 text-emerald-200 rounded p-2">
          {banner} <a className="underline" href="/jobs">Open Jobs</a>
        </div>
      ) : null}
      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      {/* Save+resolve removed; resolve actions are per-item. */}

      <div className="mt-6 hk-card overflow-auto">
        <table className="w-full text-sm min-w-[1400px]">
          <thead className="hk-table-head">
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
              <tr key={x.txn_id} className="">
                <td className="px-3 py-2 whitespace-nowrap">{x.date}</td>
                <td className="px-3 py-2 text-right">{formatINR(x.amount)}</td>
                <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)] whitespace-nowrap">
                  <div>{x.origin || (x.messageId ? 'MAIL' : 'HISAB')}</div>
                  {x.source ? <div className="text-[11px] text-[color:var(--hk-faint)] font-mono">{x.source}</div> : null}
                </td>
                <td className="px-3 py-2">
                  <input
                    list="hk_merchants"
                    className="w-36 px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]"
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
                  <input
                    list="hk_categories"
                    className="w-40 px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]"
                    value={(editing[x.txn_id]?.category ?? x.category) || ''}
                    placeholder="Category"
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
                  />
                </td>
                <td className="px-3 py-2">
                  {(() => {
                    const cat = (editing[x.txn_id]?.category ?? x.category) || '';
                    const subVal = (editing[x.txn_id]?.subcategory ?? x.subcategory) || '';
                    const opts = subRefs.filter((s) => s.category === cat);
                    return (
                      <>
                        <input
                          list="hk_subcategories"
                          className="w-44 px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)] disabled:opacity-50"
                          disabled={!cat}
                          value={subVal}
                          placeholder="Subcategory"
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
                        />
                        <div className="mt-1">
                          <input
                            className="w-44 px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)] text-xs"
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
                <td className="px-3 py-2 text-[color:var(--hk-muted)]">{x.reason}</td>
                <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)]">
                  <div className="max-w-[280px] truncate" title={x.notes || ''}>{x.notes || '—'}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    {/* Save + resolve removed */}
                    <button className="px-2 py-1 hk-btn-secondary" onClick={() => openReimburse(x)}>
                      Add reimbursement
                    </button>
                    <button className="px-2 py-1 hk-btn-secondary" onClick={() => resolve(x.txn_id).catch(() => {})}>
                      Resolve
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-[color:var(--hk-faint)]" colSpan={9}>Nothing to review.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {reimbOpen ? (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setReimbOpen(false)}>
          <div className="w-full max-w-md bg-zinc-950 hk-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[color:var(--hk-muted)]">Add reimbursement</div>
                <div className="text-xs text-[color:var(--hk-faint)] font-mono">txn {reimbTxn?.txn_id}</div>
              </div>
              <button className="text-[color:var(--hk-muted)] hover:text-white" onClick={() => setReimbOpen(false)}>✕</button>
            </div>

            <div className="mt-3 text-sm text-[color:var(--hk-muted)]">
              Base: {reimbTxn ? `${reimbTxn.date} • ${formatINR(reimbTxn.amount)} • ${reimbTxn.merchant}` : ''}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Amount (INR)</label>
                <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={reimbAmount} onChange={(e) => setReimbAmount(e.target.value)} placeholder="30" />
              </div>
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Reimbursed by</label>
                <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={reimbCounterparty} onChange={(e) => setReimbCounterparty(e.target.value)} placeholder="Name" />
              </div>
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Note (optional)</label>
                <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={reimbNote} onChange={(e) => setReimbNote(e.target.value)} placeholder="Split with ..." />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 hk-btn-secondary" onClick={() => setReimbOpen(false)}>Cancel</button>
              <button
                className="px-3 py-2 rounded hk-btn-primary"
                onClick={() => submitReimbursement().catch((e) => setErr(String(e?.message || e)))}
              >
                Queue reimbursement + resolve
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
