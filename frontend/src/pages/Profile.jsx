import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { s } from '../utils/css.js';
import { api } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const LEVELS = { 1: 'Mild Assistance', 2: 'Moderate Assistance', 3: 'Maximum Assistance' };

/**
 * Profile. Not part of the supplied design set (the sidebar links to it), so it is composed only from the
 * design's own card (.c / .em / .lk) and form tokens (.ns-field, .ns-btn).
 */
export default function Profile() {
  const { logout, setUserName } = useAuth();
  const nav = useNavigate();
  const [p, setP] = useState(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    api.profile.get().then((r) => { setP(r); setName(r.user.name); }).catch((e) => setError(e.message));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setMsg({ kind: '', text: '' });
    try {
      const r = await api.profile.update({ name });
      setP(r); setUserName(r.user.name);
      setMsg({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    }
  };

  if (error) return <div className="pg-dashboard" role="alert"><h1 style={s('margin:0 0 4px;font-size:30px')}>Profile</h1><p className="ns-error">{error}</p></div>;
  if (!p) return <div className="pg-dashboard" role="status" style={s('color:var(--ns-muted)')}>Loading your profile…</div>;

  return (
    <div className="pg-dashboard">
      <h1 style={s('margin:0 0 4px;font-size:30px')}>Profile</h1>
      <p style={s('margin:0 0 24px;color:var(--ns-muted)')}>The only personal details NeuroSync keeps are your name and email.</p>
      <div className="g" style={s('display:grid;grid-template-columns:repeat(2,1fr);gap:20px;max-width:860px')}>
        <section className="c" aria-labelledby="pa">
          <h2 id="pa">Account</h2>
          <form onSubmit={save} style={s('margin-top:12px')}>
            <div className="ns-field"><label htmlFor="pn">Name</label><input id="pn" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
            <div className="ns-field"><label htmlFor="pe">Email</label><input id="pe" value={p.user.email} readOnly aria-readonly="true" /></div>
            <button className="ns-btn ns-btn-p" disabled={!name.trim() || name.trim() === p.user.name}>Save name</button>
            <p className={`ns-status ${msg.kind === 'err' ? 'ns-error' : ''}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>
          </form>
        </section>
        <div>
          <section className="c" aria-labelledby="pl" style={s('margin-bottom:20px')}>
            <h2 id="pl">Assistance level</h2>
            {p.assistanceLevel ? <p className="em">Level {p.assistanceLevel} · {LEVELS[p.assistanceLevel]}</p> : <p className="em">Not assessed yet.</p>}
            <Link className="lk" to={p.assistanceLevel ? '/results' : '/assessment'}>{p.assistanceLevel ? 'View results' : 'Start assessment'}</Link>
          </section>
          <section className="c" aria-labelledby="px" style={s('margin-bottom:20px')}>
            <h2 id="px">Browser extension</h2>
            <p className="em">{p.extension.connected ? 'Connected.' : 'Not connected.'}</p>
            <Link className="lk" to="/dashboard">Manage on the dashboard</Link>
          </section>
          <section className="c" aria-labelledby="ps">
            <h2 id="ps">Session</h2>
            <button className="ns-btn ns-btn-s" onClick={async () => { await logout(); nav('/'); }}>Log out</button>
          </section>
        </div>
      </div>
    </div>
  );
}
