import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { s } from '../utils/css.js';
import { useAuth } from '../context/AuthContext.jsx';

const LINKS = [
  ['/dashboard', 'Overview'],
  ['/assessment', 'Assessment'],
  ['/accessibility', 'Reading Studio'],
  ['/ai-tools', 'Reading Intelligence'],
  ['/profile', 'Profile'],
  ['/settings', 'Settings'],
];

/** Redirects to /login when signed out; shows a calm message while the session is being checked. */
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <div className="ns-center-screen" role="status">Loading…</div>;
  if (status === 'offline')
    return (
      <div className="ns-center-screen" role="alert" style={{ flexDirection: 'column', gap: 12, textAlign: 'center', padding: 24 }}>
        <strong style={{ color: 'var(--neurosync-dark)' }}>We couldn’t reach the NeuroSync server.</strong>
        <span>Please check that the backend is running, then reload this page.</span>
      </div>
    );
  if (status !== 'authed') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}

/** The sidebar layout from the Dashboard design, shared by every in-app page. */
export default function AppShell() {
  return (
    <RequireAuth>
      <div className="d shell">
        <nav className="sb" aria-label="Main" style={s('width:240px;flex:none;background:var(--neurosync-dark);padding:24px 16px;display:flex;flex-direction:column;gap:4px')}>
          <span style={s('display:flex;align-items:center;gap:8px;font-weight:700;font-size:18px;color:#fff;padding:0 14px 20px')}>
            <span style={s('width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--ns-teal-tint) 50%,var(--neurosync-teal) 50%);display:inline-block')} />
            NeuroSync
          </span>
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'cur' : '')}>{label}</NavLink>
          ))}
        </nav>
        <main style={s('flex:1;padding:32px 40px;max-width:1040px')}>
          <Outlet />
        </main>
      </div>
    </RequireAuth>
  );
}
