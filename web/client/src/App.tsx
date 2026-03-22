import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiGet } from './api/client';
import DashboardPage from './pages/DashboardPage';
import ReviewPage from './pages/ReviewPage';
import MailPage from './pages/MailPage';
import MailMatchPage from './pages/MailMatchPage';
import IngestPage from './pages/IngestPage';
import StagingPage from './pages/StagingPage';
import StatementMatchPage from './pages/StatementMatchPage';
import RefsPage from './pages/RefsPage';
import SettingsPage from './pages/SettingsPage';
import JobsPage from './pages/JobsPage';
import LoginPage from './pages/LoginPage';

function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `${isActive ? 'hk-tab hk-tab-active' : 'hk-tab'}`
      }
    >
      {label}
    </NavLink>
  );
}

type MeResp = { ok: true; authenticated: boolean };

type HealthResp = { ok: true; appVersion: string };

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

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
    apiGet<HealthResp>('/api/v1/health').then(h => setAppVersion(h.appVersion)).catch(() => {});
  }, []);

  if (authed === null) {
    return <div className="p-8 text-zinc-400">Loading…</div>;
  }

  if (!authed) {
    return <LoginPage onAuthed={refreshAuth} />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b" style={{ borderColor: 'var(--hk-border)', background: 'var(--hk-panel)' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="font-semibold">Hisab Kitab {appVersion ? <span className="text-xs font-mono" style={{ color: 'var(--hk-faint)' }}>v{appVersion}</span> : null}</div>
          <div className="flex items-center gap-3">
            <nav className="flex gap-2">
            <TabLink to="/dashboard" label="Dashboard" />
            <TabLink to="/review" label="Needs Review" />
            <TabLink to="/mail" label="Mail Stats" />
            <TabLink to="/mail-match" label="Mail Match" />
            <TabLink to="/ingest" label="Ingest" />
            <TabLink to="/staging" label="Staging" />
            <TabLink to="/statement" label="Statement" />
            <TabLink to="/refs" label="Refs" />
            <TabLink to="/jobs" label="Jobs" />
            <TabLink to="/settings" label="Settings" />
            </nav>
            <button
              className="hk-btn-ghost"
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
          <Route path="/mail-match" element={<MailMatchPage />} />
          <Route path="/ingest" element={<IngestPage />} />
          <Route path="/staging" element={<StagingPage />} />
          <Route path="/statement" element={<StatementMatchPage />} />
          <Route path="/refs" element={<RefsPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
