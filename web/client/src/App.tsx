import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiGet } from './api/client';
import DashboardPage from './pages/DashboardPage';
import ReviewPage from './pages/ReviewPage';
import MailPage from './pages/MailPage';
import IngestPage from './pages/IngestPage';
import StagingPage from './pages/StagingPage';
import RefsPage from './pages/RefsPage';
import SettingsPage from './pages/SettingsPage';
import JobsPage from './pages/JobsPage';
import LoginPage from './pages/LoginPage';

function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 rounded-md text-sm ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`
      }
    >
      {label}
    </NavLink>
  );
}

type MeResp = { ok: true; authenticated: boolean };

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  async function refreshAuth() {
    try {
      const me = await apiGet<MeResp>('/api/v1/auth/me');
      setAuthed(!!me.authenticated);
    } catch {
      setAuthed(false);
    }
  }

  useEffect(() => {
    refreshAuth();
  }, []);

  if (authed === null) {
    return <div className="p-8 text-zinc-400">Loading…</div>;
  }

  if (!authed) {
    return <LoginPage onAuthed={refreshAuth} />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="font-semibold">Hisab Kitab</div>
          <div className="flex items-center gap-3">
            <nav className="flex gap-2">
            <TabLink to="/dashboard" label="Dashboard" />
            <TabLink to="/review" label="Needs Review" />
            <TabLink to="/mail" label="Mail Stats" />
            <TabLink to="/ingest" label="Ingest" />
            <TabLink to="/staging" label="Staging" />
            <TabLink to="/refs" label="Refs" />
            <TabLink to="/jobs" label="Jobs" />
            <TabLink to="/settings" label="Settings" />
            </nav>
            <button
              className="px-3 py-2 rounded-md text-sm text-zinc-300 hover:bg-zinc-900"
              onClick={async () => {
                try {
                  await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
                } finally {
                  window.location.href = '/';
                }
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/ingest" element={<IngestPage />} />
          <Route path="/staging" element={<StagingPage />} />
          <Route path="/refs" element={<RefsPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
