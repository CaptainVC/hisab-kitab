import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { loadRange, saveRange, type Range } from '../app/range';

type HealthResp = { ok: true; appVersion: string; startedAt: string; time: string };

type MeResp = { ok: true; authenticated: boolean; loginAt: string | null };

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [me, setMe] = useState<MeResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [range, setRange] = useState<Range>(() => loadRange());

  async function load() {
    setErr(null);
    try {
      const h = await apiGet<HealthResp>('/api/v1/health');
      const m = await apiGet<MeResp>('/api/v1/auth/me');
      setHealth(h);
      setMe(m);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  async function logout() {
    await apiPost('/api/v1/auth/logout', {});
    window.location.href = '/';
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  function updateRange(patch: Partial<Range>) {
    const next = { ...range, ...patch };
    setRange(next);
    saveRange(next);
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-[color:var(--hk-muted)] mt-1">Server info + session.</p>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded-md hk-btn-secondary" onClick={() => load().catch(() => {})}>Refresh</button>
          <button className="px-3 py-2 hk-btn-primary" onClick={() => logout().catch(() => {})}>Logout</button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Server</div>
          <div className="mt-2 text-sm text-[color:var(--hk-muted)]">Version: <span className="font-mono">{health?.appVersion || '—'}</span></div>
          <div className="mt-1 text-sm text-[color:var(--hk-muted)]">Started: <span className="font-mono">{health?.startedAt || '—'}</span></div>
          <div className="mt-1 text-sm text-[color:var(--hk-muted)]">Time: <span className="font-mono">{health?.time || '—'}</span></div>
        </div>

        <div className="p-4 hk-card">
          <div className="text-sm font-semibold">Session</div>
          <div className="mt-2 text-sm text-[color:var(--hk-muted)]">Authenticated: <span className="font-mono">{me ? String(me.authenticated) : '—'}</span></div>
          <div className="mt-1 text-sm text-[color:var(--hk-muted)]">Login at: <span className="font-mono">{me?.loginAt || '—'}</span></div>
        </div>
      </div>

      <div className="mt-6 p-4 hk-card">
        <div className="text-sm font-semibold">Defaults</div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Default range from (YYYY-MM)</label>
            <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={range.from} onChange={(e) => updateRange({ from: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-[color:var(--hk-muted)]">Default range to (YYYY-MM)</label>
            <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={range.to} onChange={(e) => updateRange({ to: e.target.value })} />
          </div>
        </div>
        <div className="mt-2 text-xs text-[color:var(--hk-faint)]">Used by Dashboard / Needs Review / Mail Stats / Ingest / Refs coverage.</div>
      </div>

      <div className="mt-6 p-4 hk-card">
        <div className="text-sm font-semibold">Ops</div>
        <ul className="mt-2 text-sm text-[color:var(--hk-muted)] list-disc pl-5 space-y-1">
          <li>Service logs: <span className="font-mono">journalctl --user -u hisab-kitab-web.service -f</span></li>
          <li>Restart: <span className="font-mono">./web/scripts/restart_web.sh</span></li>
          <li>Build: <span className="font-mono">./web/scripts/build_web.sh</span></li>
        </ul>
      </div>
    </div>
  );
}
