import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api/client';
import { loadRange, saveRange } from '../app/range';

type StatsResp = {
  ok: true;
  from: string | null;
  to: string | null;
  totals: { orders: number; payments: number; orders_total: number; payments_total: number };
  byMerchant: Record<string, number>;
  byPaymentSource: Record<string, number>;
  recentPayments: Array<{ internalDateMs: number; source: string; subject: string; amount: number; direction: string; instrument: string }>;
};

export default function MailPage() {
  const def = useMemo(() => loadRange(), []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const [data, setData] = useState<StatsResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<StatsResp>(`/api/v1/mail/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setData(r);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topMerchants = data
    ? Object.entries(data.byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 15)
    : [];

  const topSources = data
    ? Object.entries(data.byPaymentSource).sort((a, b) => b[1] - a[1]).slice(0, 15)
    : [];

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Mail Stats</h1>
          <p className="text-zinc-400 mt-1">Derived from HisabKitab-labeled parsed emails.</p>
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

      {data ? (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 border border-zinc-800 rounded-lg">
            <div className="text-sm text-zinc-400">Orders parsed (range)</div>
            <div className="text-2xl font-semibold mt-1">{data.totals.orders}</div>
          </div>
          <div className="p-4 border border-zinc-800 rounded-lg">
            <div className="text-sm text-zinc-400">Payments parsed (range)</div>
            <div className="text-2xl font-semibold mt-1">{data.totals.payments}</div>
          </div>
          <div className="p-4 border border-zinc-800 rounded-lg">
            <div className="text-sm text-zinc-400">Totals (all time)</div>
            <div className="text-sm mt-2 text-zinc-300">Orders: {data.totals.orders_total}</div>
            <div className="text-sm text-zinc-300">Payments: {data.totals.payments_total}</div>
          </div>
        </div>
      ) : null}

      {data ? (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-zinc-800 rounded-lg overflow-auto">
            <div className="px-3 py-2 bg-zinc-900 text-zinc-300 text-sm font-semibold">Top merchants (orders)</div>
            <table className="w-full text-sm">
              <tbody>
                {topMerchants.map(([k, v]) => (
                  <tr key={k} className="border-t border-zinc-800">
                    <td className="px-3 py-2 font-mono text-xs">{k}</td>
                    <td className="px-3 py-2 text-right">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border border-zinc-800 rounded-lg overflow-auto">
            <div className="px-3 py-2 bg-zinc-900 text-zinc-300 text-sm font-semibold">Top payment sources</div>
            <table className="w-full text-sm">
              <tbody>
                {topSources.map(([k, v]) => (
                  <tr key={k} className="border-t border-zinc-800">
                    <td className="px-3 py-2 font-mono text-xs">{k}</td>
                    <td className="px-3 py-2 text-right">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {data ? (
        <div className="mt-6 border border-zinc-800 rounded-lg overflow-auto">
          <div className="px-3 py-2 bg-zinc-900 text-zinc-300 text-sm font-semibold">Recent payment emails</div>
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-zinc-400">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Subject</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recentPayments.map((p, idx) => (
                <tr key={idx} className="border-t border-zinc-800">
                  <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{new Date(p.internalDateMs).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.source}</td>
                  <td className="px-3 py-2">{p.subject}</td>
                  <td className="px-3 py-2 text-right">{p.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
