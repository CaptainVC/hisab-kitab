import { useMemo, useState } from 'react';
import { apiPost } from '../api/client';
import { loadRange, saveRange } from '../app/range';

type MatchResp = {
  ok: true;
  parsed: number;
  matched: number;
  exact1: number;
  daysWindow: number;
  results: Array<{
    idx: number;
    date: string;
    amount: number;
    narration: string;
    candidates: Array<{ txn_id: string; date: string; amount: number; raw_text: string; type: string }>;
  }>;
};

export default function StatementMatchPage() {
  const def = useMemo(() => loadRange(), []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');
  const [resp, setResp] = useState<MatchResp | null>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setErr('');
    setResp(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/v1/statement/match?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        method: 'POST',
        body: fd,
        credentials: 'include'
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'match_failed');
      setResp(j as MatchResp);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Statement match</h1>
          <p className="text-[color:var(--hk-muted)] mt-1">Upload HDFC PDF statement and see how many entries map to existing Excel transactions. Read-only.</p>
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
        </div>
      </div>

      <div className="mt-4 p-4 hk-card">
        <label className="text-xs text-[color:var(--hk-muted)]">PDF statement</label>
        <input className="mt-1 block" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <div className="mt-3 flex gap-2">
          <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy || !file} onClick={run}>
            {busy ? 'Matching…' : 'Upload + match'}
          </button>
        </div>
        {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}
      </div>

      {resp ? (
        <div className="mt-4 grid grid-cols-1 gap-4">
          <div className="p-4 hk-card text-sm">
            <div>Parsed: <b>{resp.parsed}</b></div>
            <div>Matched (&gt;=1 candidate): <b>{resp.matched}</b></div>
            <div>Exact matches (1 candidate): <b>{resp.exact1}</b></div>
            <div className="text-xs text-[color:var(--hk-faint)] mt-1">Match rule: amount exact, date within ±{resp.daysWindow} days.</div>
          </div>

          <div className="p-4 hk-card">
            <div className="text-sm font-semibold">Results (top 200)</div>
            <div className="mt-2 overflow-auto max-h-[520px]">
              <table className="w-full text-xs">
                <thead className="hk-table-head sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">Stmt</th>
                    <th className="text-left px-2 py-1">Date</th>
                    <th className="text-right px-2 py-1">Amt</th>
                    <th className="text-left px-2 py-1">Narration</th>
                    <th className="text-left px-2 py-1">Candidates</th>
                  </tr>
                </thead>
                <tbody>
                  {resp.results.slice(0, 200).map((r) => (
                    <tr key={r.idx} className="border-b [var(--hk-border)]">
                      <td className="px-2 py-1">{r.idx + 1}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.date}</td>
                      <td className="px-2 py-1 text-right">{r.amount}</td>
                      <td className="px-2 py-1 max-w-[420px] truncate" title={r.narration}>{r.narration}</td>
                      <td className="px-2 py-1">
                        {r.candidates.length ? (
                          <div className="space-y-1">
                            {r.candidates.slice(0, 3).map((c) => (
                              <div key={c.txn_id} className="text-[11px] text-[color:var(--hk-muted)]">
                                <span className="font-mono">{c.txn_id}</span> • {c.date} • {c.type} • {c.amount} • {String(c.raw_text || '').slice(0, 60)}
                              </div>
                            ))}
                            {r.candidates.length > 3 ? <div className="text-[11px] text-[color:var(--hk-faint)]">+{r.candidates.length - 3} more</div> : null}
                          </div>
                        ) : (
                          <span className="text-[color:var(--hk-faint)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
