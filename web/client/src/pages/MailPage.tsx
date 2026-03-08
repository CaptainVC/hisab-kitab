import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { loadRange, saveRange } from '../app/range';
import { formatINR } from '../app/format';

type StatsResp = {
  ok: true;
  from: string | null;
  to: string | null;
  oldestOrderMs?: number | null;
  oldestPaymentMs?: number | null;
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
  const [bufferDays, setBufferDays] = useState(2);
  const [crossrefBusy, setCrossrefBusy] = useState(false);
  const [crossrefReport, setCrossrefReport] = useState<any | null>(null);
  const [crossrefOrders, setCrossrefOrders] = useState<any[]>([]);
  const [crossrefStatus, setCrossrefStatus] = useState<'matched' | 'unmatched'>('matched');

  async function loadCrossref() {
    try {
      const r = await apiGet<{ ok: true; file: string; report: any }>(`/api/v1/mail/crossrefReport?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setCrossrefReport(r.report);
    } catch {
      setCrossrefReport(null);
    }

    try {
      const o = await apiGet<{ ok: true; orders: any[] }>(`/api/v1/mail/crossrefOrders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=${encodeURIComponent(crossrefStatus)}`);
      setCrossrefOrders(o.orders || []);
    } catch {
      setCrossrefOrders([]);
    }
  }

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
          <p className="text-[color:var(--hk-muted)] mt-1">Derived from HisabKitab-labeled parsed emails.</p>
          {data ? (
            <div className="mt-1 text-xs text-[color:var(--hk-faint)]">
              Oldest in range: orders {data.oldestOrderMs ? new Date(data.oldestOrderMs).toISOString().slice(0, 10) : '—'} • payments {data.oldestPaymentMs ? new Date(data.oldestPaymentMs).toISOString().slice(0, 10) : '—'}
            </div>
          ) : null}
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">From</label>
            <input className="block mt-1 hk-input" value={from} onChange={e => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">To</label>
            <input className="block mt-1 hk-input" value={to} onChange={e => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
          </div>
          <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy} onClick={() => load().catch(() => {})}>
            {busy ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      <div className="mt-4 p-4 hk-card">
        <div className="text-sm font-semibold">Ingest from mail (orders → Excel)</div>
        <div className="mt-1 text-xs text-[color:var(--hk-muted)]">Imports only when a matching overall Hisab expense exists (date±buffer + amount tol). Unknown items → SHOP_MISC.</div>
        <div className="mt-3 flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Buffer days</label>
            <input className="block mt-1 hk-input w-24" type="number" value={bufferDays} onChange={(e) => setBufferDays(Number(e.target.value))} />
          </div>
          <button
            className="hk-btn-secondary disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              try {
                setBusy(true);
                setErr(null);
                const r = await apiPost<{ ok: true; jobId: string }>('/api/v1/mail/matchReport', { from, to, bufferDays });
                alert(`Started match report job ${r.jobId}. Check Jobs page for output.`);
              } catch (e: any) {
                setErr(String(e?.message || e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Match report (dry-run)
          </button>

          <button
            className="hk-btn-secondary disabled:opacity-50"
            disabled={busy || crossrefBusy}
            onClick={async () => {
              try {
                setCrossrefBusy(true);
                setErr(null);
                const r = await apiPost<{ ok: true; jobId: string }>('/api/v1/mail/crossref', { from, to, bufferDays });
                alert(`Started crossref job ${r.jobId}. Check Jobs page for progress.`);
              } catch (e: any) {
                setErr(String(e?.message || e));
              } finally {
                setCrossrefBusy(false);
              }
            }}
          >
            Cross-reference unmatched
          </button>

          <button
            className="hk-btn-primary disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              try {
                setBusy(true);
                setErr(null);
                const r = await apiPost<{ ok: true; jobId: string }>('/api/v1/mail/ingestOrders', { from, to, bufferDays });
                alert(`Started mail ingest job ${r.jobId}. Check Jobs page for progress.`);
              } catch (e: any) {
                setErr(String(e?.message || e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Run mail ingest
          </button>
        </div>
      </div>

      <div className="mt-4 p-4 hk-card">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Crossref status</div>
            <div className="mt-1 text-xs text-[color:var(--hk-muted)]">Shows matches between unmatched mail invoices and your overall Hisab entries (no Excel edits).</div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">View</label>
              <select className="mt-1 hk-input" value={crossrefStatus} onChange={(e) => setCrossrefStatus(e.target.value as any)}>
                <option value="matched">Matched</option>
                <option value="unmatched">Unmatched</option>
              </select>
            </div>
            <button className="hk-btn-secondary" disabled={busy} onClick={() => loadCrossref().catch(() => {})}>Refresh</button>
          </div>
        </div>

        {crossrefReport ? (
          <div className="mt-3 text-xs text-[color:var(--hk-faint)]">
            Considered: <span className="font-mono">{crossrefReport.considered}</span> • Matched: <span className="font-mono">{crossrefReport.matched}</span> • Ambiguous: <span className="font-mono">{crossrefReport.ambiguous}</span> • None: <span className="font-mono">{crossrefReport.none}</span>
          </div>
        ) : (
          <div className="mt-3 text-xs text-[color:var(--hk-faint)]">No crossref report found for this range yet.</div>
        )}

        <div className="mt-3 border border-zinc-800 rounded overflow-auto max-h-80">
          <table className="w-full text-sm">
            <thead className="hk-table-head">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Merchant</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Matched txn_id</th>
              </tr>
            </thead>
            <tbody>
              {crossrefOrders.map((o) => (
                <tr key={o.messageId} className="hover:bg-white/5">
                  <td className="px-3 py-2 whitespace-nowrap">{o.date}</td>
                  <td className="px-3 py-2">{o.merchant_code}</td>
                  <td className="px-3 py-2 text-right">{Number(o.total || 0).toFixed(0)}</td>
                  <td className="px-3 py-2">{o.status}</td>
                  <td className="px-3 py-2 font-mono text-xs">{o.matched_txn_id || '—'}</td>
                </tr>
              ))}
              {!crossrefOrders.length ? (
                <tr>
                  <td className="px-3 py-4 text-center text-[color:var(--hk-faint)]" colSpan={5}>No rows</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {data ? (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 hk-card">
            <div className="text-sm text-[color:var(--hk-muted)]">Orders parsed (range)</div>
            <div className="text-2xl font-semibold mt-1">{data.totals.orders}</div>
          </div>
          <div className="p-4 hk-card">
            <div className="text-sm text-[color:var(--hk-muted)]">Payments parsed (range)</div>
            <div className="text-2xl font-semibold mt-1">{data.totals.payments}</div>
          </div>
          <div className="p-4 hk-card">
            <div className="text-sm text-[color:var(--hk-muted)]">Totals (all time)</div>
            <div className="text-sm mt-2 text-[color:var(--hk-muted)]">Orders: {data.totals.orders_total}</div>
            <div className="text-sm text-[color:var(--hk-muted)]">Payments: {data.totals.payments_total}</div>
          </div>
        </div>
      ) : null}

      {data ? (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="hk-card overflow-auto">
            <div className="px-3 py-2 hk-table-head text-sm font-semibold">Top merchants (orders)</div>
            <table className="w-full text-sm">
              <tbody>
                {topMerchants.map(([k, v]) => (
                  <tr key={k} className="">
                    <td className="px-3 py-2 font-mono text-xs">{k}</td>
                    <td className="px-3 py-2 text-right">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hk-card overflow-auto">
            <div className="px-3 py-2 hk-table-head text-sm font-semibold">Top payment sources</div>
            <table className="w-full text-sm">
              <tbody>
                {topSources.map(([k, v]) => (
                  <tr key={k} className="">
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
        <div className="mt-6 hk-card overflow-auto">
          <div className="px-3 py-2 hk-table-head text-sm font-semibold">Recent payment emails</div>
          <table className="w-full text-sm">
            <thead className="hk-table-head">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Subject</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recentPayments.map((p, idx) => (
                <tr key={idx} className="">
                  <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)] whitespace-nowrap">{new Date(p.internalDateMs).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.source}</td>
                  <td className="px-3 py-2">{p.subject}</td>
                  <td className="px-3 py-2 text-right">{formatINR(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
