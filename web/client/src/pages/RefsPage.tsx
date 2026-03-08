import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { currentQuarterRange } from '../app/range';

type Merchant = { code: string; name: string; archived?: boolean };

type MerchantsResp = { ok: true; merchants: Merchant[] };

type CoverageRow = {
  code: string;
  emailSupport: 'YES' | 'NO' | 'UNKNOWN' | 'SEEN_BUT_UNSUPPORTED';
  emailSeenCount: number;
  lastEmailAt: string | null;
  ruleConfigured: boolean;
};

type CoverageResp = { ok: true; coverage: CoverageRow[] };

export default function RefsPage() {
  const def = useMemo(() => currentQuarterRange(), []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [coverage, setCoverage] = useState<Record<string, CoverageRow>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const m = await apiGet<MerchantsResp>('/api/v1/refs/merchants');
      const c = await apiGet<CoverageResp>(`/api/v1/refs/merchants/coverage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setMerchants(m.merchants);
      const map: Record<string, CoverageRow> = {};
      for (const row of c.coverage) map[row.code] = row;
      setCoverage(map);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function rename(code: string) {
    const cur = merchants.find(x => x.code === code);
    const name = prompt(`Rename ${code} to:`, cur?.name || code);
    if (name === null) return;
    await apiPost(`/api/v1/refs/merchants/${encodeURIComponent(code)}`, { name });
    await load();
  }

  async function archive(code: string) {
    if (!confirm(`Archive merchant ${code}?`)) return;
    await apiPost(`/api/v1/refs/merchants/${encodeURIComponent(code)}/archive`, {});
    await load();
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Refs</h1>
          <p className="text-zinc-400 mt-1">Merchants (v1). Email coverage is derived from HisabKitab-labeled emails.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-zinc-400">Coverage from</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">to</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50" disabled={busy} onClick={() => load().catch(() => {})}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 border border-zinc-800 rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-300">
            <tr>
              <th className="text-left px-3 py-2">Code</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Email support</th>
              <th className="text-right px-3 py-2">Emails seen</th>
              <th className="text-left px-3 py-2">Last email</th>
              <th className="text-left px-3 py-2">Rule</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {merchants.filter(m => !m.archived).map((m) => {
              const c = coverage[m.code];
              return (
                <tr key={m.code} className="border-t border-zinc-800">
                  <td className="px-3 py-2 font-mono text-xs">{m.code}</td>
                  <td className="px-3 py-2">{m.name}</td>
                  <td className="px-3 py-2">{c?.emailSupport || '—'}</td>
                  <td className="px-3 py-2 text-right">{c ? c.emailSeenCount : '—'}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400">{c?.lastEmailAt ? new Date(c.lastEmailAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2">{c ? (c.ruleConfigured ? 'configured' : '—') : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => rename(m.code).catch(() => {})}>Edit</button>
                      <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => archive(m.code).catch(() => {})}>Archive</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {merchants.length === 0 ? (
              <tr><td className="px-3 py-3 text-zinc-500" colSpan={7}>No merchants found.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-zinc-500">
        v1 notes: categories/subcategories management + email rules viewer will be added next.
      </div>
    </div>
  );
}
