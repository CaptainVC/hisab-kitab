import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client';

type HealthResp = { ok: true; appVersion: string; time: string };

type MeResp = { ok: true; authenticated: boolean; loginAt: string | null };

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [me, setMe] = useState<MeResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-zinc-400 mt-1">Server info + session.</p>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700" onClick={() => load().catch(() => {})}>Refresh</button>
          <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium" onClick={() => logout().catch(() => {})}>Logout</button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="text-sm font-semibold">Server</div>
          <div className="mt-2 text-sm text-zinc-300">Version: <span className="font-mono">{health?.appVersion || '—'}</span></div>
          <div className="mt-1 text-sm text-zinc-300">Time: <span className="font-mono">{health?.time || '—'}</span></div>
        </div>

        <div className="p-4 border border-zinc-800 rounded-lg">
          <div className="text-sm font-semibold">Session</div>
          <div className="mt-2 text-sm text-zinc-300">Authenticated: <span className="font-mono">{me ? String(me.authenticated) : '—'}</span></div>
          <div className="mt-1 text-sm text-zinc-300">Login at: <span className="font-mono">{me?.loginAt || '—'}</span></div>
        </div>
      </div>

      <div className="mt-6 p-4 border border-zinc-800 rounded-lg">
        <div className="text-sm font-semibold">Ops</div>
        <ul className="mt-2 text-sm text-zinc-300 list-disc pl-5 space-y-1">
          <li>Service logs: <span className="font-mono">journalctl --user -u hisab-kitab-web.service -f</span></li>
          <li>Restart: <span className="font-mono">./web/scripts/restart_web.sh</span></li>
          <li>Build: <span className="font-mono">./web/scripts/build_web.sh</span></li>
        </ul>
      </div>
    </div>
  );
}
