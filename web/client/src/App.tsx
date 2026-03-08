import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import ReviewPage from './pages/ReviewPage';
import MailPage from './pages/MailPage';
import IngestPage from './pages/IngestPage';
import StagingPage from './pages/StagingPage';
import RefsPage from './pages/RefsPage';

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

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="font-semibold">Hisab Kitab</div>
          <nav className="flex gap-2">
            <TabLink to="/dashboard" label="Dashboard" />
            <TabLink to="/review" label="Needs Review" />
            <TabLink to="/mail" label="Mail Stats" />
            <TabLink to="/ingest" label="Ingest" />
            <TabLink to="/staging" label="Staging" />
            <TabLink to="/refs" label="Refs" />
          </nav>
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
        </Routes>
      </main>
    </div>
  );
}
