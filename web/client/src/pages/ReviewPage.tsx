import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { currentQuarterRange } from '../app/range';

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
};

type ItemsResp = { ok: true; count: number; items: ReviewItem[] };

export default function ReviewPage() {
  const def = useMemo(() => currentQuarterRange(), []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<ItemsResp>(`/api/v1/review/items?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setItems(r.items);
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

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Needs Review</h1>
          <p className="text-zinc-400 mt-1">Auto-generated list: parse errors + missing category/subcategory (excluding resolved).</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-zinc-400">From</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">To</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50" disabled={busy} onClick={() => load().catch(() => {})}>
            {busy ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 border border-zinc-800 rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-300">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-right px-3 py-2">Amt</th>
              <th className="text-left px-3 py-2">Merchant</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Subcategory</th>
              <th className="text-left px-3 py-2">Reason</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.txn_id} className="border-t border-zinc-800">
                <td className="px-3 py-2 whitespace-nowrap">{x.date}</td>
                <td className="px-3 py-2 text-right">{x.amount}</td>
                <td className="px-3 py-2">{x.merchant}</td>
                <td className="px-3 py-2">{x.category}</td>
                <td className="px-3 py-2">{x.subcategory}</td>
                <td className="px-3 py-2 text-zinc-400">{x.reason}</td>
                <td className="px-3 py-2">
                  <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => resolve(x.txn_id).catch(() => {})}>Resolve</button>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-zinc-500" colSpan={7}>Nothing to review.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
