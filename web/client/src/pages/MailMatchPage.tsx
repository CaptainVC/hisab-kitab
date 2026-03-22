import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { SearchSelect } from '../components/SearchSelect';

type MerchantStat = {
  merchant_code: string;
  count: number;
  oldestDate: string | null;
  newestDate: string | null;
  withItems: number;
};

type MerchantsResp = { ok: true; merchants: MerchantStat[] };

type RunResp = { ok: true; jobId: string; reportId: string };

type JobResp = { ok: true; job: { status: string } };

type ReportRow =
  | { status: 'matched'; mail: any; match: any }
  | { status: 'ambiguous'; mail: any; candidates: any[] }
  | { status: 'unmatched'; mail: any };

type ReportResp = {
  ok: true;
  reportId: string;
  merchant_code: string;
  from: string;
  to: string;
  bufferDays: number;
  tol: number;
  includeRawMention: boolean;
  generatedAt: string;
  summary: { mailOrders: number; txnCandidates: number; matched: number; ambiguous: number; unmatched: number };
  rows: ReportRow[];
};

export default function MailMatchPage() {
  const [merchants, setMerchants] = useState<MerchantStat[]>([]);
  const [selected, setSelected] = useState<string>('');

  const [from, setFrom] = useState('2025-04-01');
  const [to, setTo] = useState('2026-03-31');
  const [bufferDays, setBufferDays] = useState(3);
  const [tol, setTol] = useState(10);
  const [includeRawMention, setIncludeRawMention] = useState(true);
  const [enableSplitSuggestions, setEnableSplitSuggestions] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResp | null>(null);
  const [tab, setTab] = useState<'unmatched' | 'ambiguous' | 'matched'>('unmatched');

  async function loadMerchants() {
    const r = await apiGet<MerchantsResp>('/api/v1/mail/merchants');
    setMerchants(r.merchants || []);
    if (!selected && r.merchants?.length) setSelected(r.merchants[0].merchant_code);
  }

  useEffect(() => {
    loadMerchants().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedStat = useMemo(() => merchants.find((m) => m.merchant_code === selected) || null, [merchants, selected]);

  async function pollJob(id: string) {
    for (let i = 0; i < 600; i++) {
      const jr = await apiGet<JobResp>(`/api/v1/jobs/${id}`);
      if (jr.job.status === 'succeeded') return;
      if (jr.job.status === 'failed') throw new Error('job_failed');
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error('job_timeout');
  }

  async function run() {
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const r = await apiPost<RunResp>('/api/v1/mail/reconcile/run', {
        merchant_code: selected,
        from,
        to,
        bufferDays,
        tol,
        includeRawMention,
        enableSplitSuggestions
      });
      setJobId(r.jobId);
      await pollJob(r.jobId);
      const rep = await apiGet<ReportResp>(`/api/v1/mail/reconcile/report/${encodeURIComponent(r.reportId)}`);
      setReport(rep);
      setTab('unmatched');
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const rows = report?.rows || [];
  const rowsByTab = rows.filter((r: any) => r.status === tab);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Mail Match</h1>
          <p className="text-[color:var(--hk-muted)] mt-1">Run on-demand cross-referencing between email orders and Excel transactions. No Excel changes are made.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Controls</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">Email merchant</label>
              <div className="mt-1">
                <SearchSelect
                  portal
                  value={selected}
                  onChange={(v) => { setSelected(v); setReport(null); }}
                  options={merchants.map((m) => ({ value: m.merchant_code, label: m.merchant_code }))}
                  placeholder="(none)"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">Include raw mention (when merchant missing)</label>
              <div className="mt-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={includeRawMention} onChange={(e) => setIncludeRawMention(e.target.checked)} />
                  Enabled
                </label>
              </div>
            </div>

            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">Auto-split suggestions</label>
              <div className="mt-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enableSplitSuggestions}
                    onChange={(e) => setEnableSplitSuggestions(e.target.checked)}
                    disabled={!['AMAZON', 'BLINKIT', 'ZEPTO', 'SWIGGY_INSTAMART'].includes(String(selected || '').toUpperCase())}
                  />
                  Enable (Amazon/Blinkit/Zepto/Instamart)
                </label>
                <div className="text-[11px] text-[color:var(--hk-faint)]">Suggestions only (nothing committed until you explicitly apply).</div>
              </div>
            </div>

            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">From</label>
              <input className="mt-1 hk-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">To</label>
              <input className="mt-1 hk-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">Buffer days (±)</label>
              <input className="mt-1 hk-input" type="number" value={bufferDays} onChange={(e) => setBufferDays(Number(e.target.value || 0))} />
            </div>
            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">Amount tolerance (₹)</label>
              <input className="mt-1 hk-input" type="number" value={tol} onChange={(e) => setTol(Number(e.target.value || 0))} />
            </div>
          </div>

          {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

          <div className="mt-4 flex items-center gap-2">
            <button className="hk-btn-primary disabled:opacity-50" disabled={busy || !selected} onClick={run}>
              {busy ? 'Running…' : 'Run cross-reference'}
            </button>
            {jobId ? <div className="text-xs text-[color:var(--hk-faint)]">job {jobId}</div> : null}
          </div>
        </div>

        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Merchant stats</div>
          {!selectedStat ? (
            <div className="mt-2 text-sm text-[color:var(--hk-faint)]">Select a merchant</div>
          ) : (
            <div className="mt-3 text-sm">
              <div className="flex justify-between"><span className="text-[color:var(--hk-muted)]">Total emails/orders</span><span className="font-semibold">{selectedStat.count}</span></div>
              <div className="flex justify-between"><span className="text-[color:var(--hk-muted)]">Oldest</span><span className="font-mono">{selectedStat.oldestDate || '—'}</span></div>
              <div className="flex justify-between"><span className="text-[color:var(--hk-muted)]">Newest</span><span className="font-mono">{selectedStat.newestDate || '—'}</span></div>
              <div className="flex justify-between"><span className="text-[color:var(--hk-muted)]">With items</span><span className="font-semibold">{selectedStat.withItems}</span></div>
            </div>
          )}
        </div>
      </div>

      {report ? (
        <div className="mt-6">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Results</div>
              <div className="text-xs text-[color:var(--hk-faint)]">{report.merchant_code} • {report.from}..{report.to} • buffer ±{report.bufferDays} • tol ₹{report.tol}</div>
            </div>
            <div className="text-xs text-[color:var(--hk-muted)]">
              Matched {report.summary.matched} • Ambiguous {report.summary.ambiguous} • Unmatched {report.summary.unmatched}
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button className={`hk-btn-secondary ${tab==='unmatched' ? 'ring-1 ring-white/20' : ''}`} onClick={() => setTab('unmatched')}>Unmatched ({report.summary.unmatched})</button>
            <button className={`hk-btn-secondary ${tab==='ambiguous' ? 'ring-1 ring-white/20' : ''}`} onClick={() => setTab('ambiguous')}>Ambiguous ({report.summary.ambiguous})</button>
            <button className={`hk-btn-secondary ${tab==='matched' ? 'ring-1 ring-white/20' : ''}`} onClick={() => setTab('matched')}>Matched ({report.summary.matched})</button>
          </div>

          <div className="mt-3 hk-card overflow-auto max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="hk-table-head sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2">Mail date</th>
                  <th className="text-right px-3 py-2">Mail total</th>
                  <th className="text-left px-3 py-2">Items (preview)</th>
                  <th className="text-left px-3 py-2">Match / candidates</th>
                </tr>
              </thead>
              <tbody>
                {rowsByTab.slice(0, 300).map((r: any, idx: number) => {
                  const mail = r.mail;
                  const items = (mail?.items || []).map((x: any) => x.name).filter(Boolean).slice(0, 2).join(' | ');
                  return (
                    <tr key={idx} className="border-t" style={{ borderColor: 'var(--hk-border)' }}>
                      <td className="px-3 py-2 font-mono text-xs">{mail?.date}</td>
                      <td className="px-3 py-2 text-right">₹{Number(mail?.total || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)]">{items || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.status === 'matched' ? (
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="font-mono">{r.match?.txn?.txn_id} • ₹{r.match?.txn?.amount} • Δd {r.match?.dayDelta} • Δ₹ {Number(r.match?.amtDelta||0).toFixed(2)}</div>
                            <a className="hk-btn-secondary px-2 py-1" href={`/dashboard?q=${encodeURIComponent(r.match?.txn?.txn_id || '')}&edit=${encodeURIComponent(r.match?.txn?.txn_id || '')}`}>Edit</a>
                          </div>
                        ) : r.status === 'ambiguous' ? (
                          <div className="space-y-2">
                            {r.candidates?.slice(0, 5).map((c: any) => (
                              <div key={c.txn_id} className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="font-mono">{c.txn_id} • ₹{c.amount} • Δd {c.dayDelta} • Δ₹ {Number(c.amtDelta||0).toFixed(2)}</div>
                                <a className="hk-btn-secondary px-2 py-1" href={`/dashboard?q=${encodeURIComponent(c.txn_id)}&edit=${encodeURIComponent(c.txn_id)}`}>Edit</a>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <button
                            className="hk-btn-secondary px-2 py-1"
                            onClick={() => {
                              // Prefill staging with a minimal /hisab block.
                              const mm = mail;
                              const d = String(mm?.date || '');
                              const [yy, mo, dd] = d.split('-');
                              const dmy = yy && mo && dd ? `${dd}/${mo}/${String(yy).slice(2)}` : d;
                              const amt = Math.round(Number(mm?.total || 0));
                              const preview = (mm?.items || []).map((x: any) => x.name).filter(Boolean).slice(0, 2).join(' | ');
                              const line = `${amt}/- ${String(selected)} ${preview ? `; ${preview}` : ''} {msg:${mm?.messageId || ''}}`;
                              const text = `/hisab\nDay (${dmy})\n${line}`;
                              try { localStorage.setItem('hk_staging_prefill_text', text); } catch {}
                              window.location.href = '/staging';
                            }}
                          >
                            Send to Staging
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!rowsByTab.length ? (
                  <tr><td className="px-3 py-3 text-[color:var(--hk-faint)]" colSpan={4}>No rows.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
