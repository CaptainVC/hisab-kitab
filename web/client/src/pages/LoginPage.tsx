import { useState } from 'react';
import { apiPost } from '../api/client';

export default function LoginPage({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expiredMsg, setExpiredMsg] = useState(false);

  // show session expired banner if redirected due to 401
  if (!expiredMsg) {
    try {
      const v = localStorage.getItem('hk:sessionExpired');
      if (v) {
        localStorage.removeItem('hk:sessionExpired');
        setExpiredMsg(true);
      }
    } catch {}
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await apiPost('/api/v1/auth/login', { password });
      onAuthed();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-12 p-6 border border-zinc-800 rounded-lg bg-zinc-950">
      <h1 className="text-xl font-semibold">Hisab Kitab</h1>
      <p className="text-zinc-400 mt-1">Login</p>
      {expiredMsg ? (
        <div className="mt-4 p-3 border border-yellow-800 rounded bg-yellow-950/20 text-yellow-200 text-sm">
          Session expired. Please login again.
        </div>
      ) : null}

      <div className="mt-4">
        <label className="text-sm text-zinc-300">Password</label>
        <input
          className="mt-1 w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}
      <button
        className="mt-4 w-full px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50"
        disabled={busy || !password}
        onClick={submit}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
  );
}
