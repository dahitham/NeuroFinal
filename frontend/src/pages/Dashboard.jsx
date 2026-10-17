import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { s } from '../utils/css.js';
import { api } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const LEVELS = [
  [1, 'Level 1', 'Mild Assistance'],
  [2, 'Level 2', 'Moderate Assistance'],
  [3, 'Level 3', 'Maximum Assistance'],
];
const BTN = 'display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 24px;margin-top:18px;border-radius:12px;background:var(--ns-teal-strong);color:#fff;font-weight:700;font-size:19px;text-decoration:none';
const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Dashboard – layout and styles from Dashboard.dc.html; every value comes from GET /api/dashboard. */
export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [switchError, setSwitchError] = useState('');
  const [pairing, setPairing] = useState(null);
  const [pairBusy, setPairBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await api.dashboard());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (key) => {
    const prev = d.quickControls[key];
    setSwitchError('');
    setD((x) => ({ ...x, quickControls: { ...x.quickControls, [key]: !prev } })); // optimistic
    try {
      await api.accessibility.update({ [key]: !prev });
      load();
    } catch (e) {
      setD((x) => ({ ...x, quickControls: { ...x.quickControls, [key]: prev } }));
      setSwitchError(e.message);
    }
  };

  const getCode = async () => {
    setPairBusy(true);
    try { setPairing(await api.extension.pairingCode()); } catch (e) { setSwitchError(e.message); } finally { setPairBusy(false); }
  };
  const disconnect = async () => {
    try { await api.extension.disconnect(); setPairing(null); load(); } catch (e) { setSwitchError(e.message); }
  };

  if (error) return <div className="pg-dashboard" role="alert"><h1 style={s('margin:0 0 4px;font-size:30px')}>Welcome back</h1><p className="ns-error">{error}</p><button className="ns-btn ns-btn-s" onClick={load}>Try again</button></div>;
  if (!d) return <div className="pg-dashboard" role="status" style={s('color:var(--ns-muted)')}>Loading your dashboard…</div>;

  const sum = d.assessment.summary;
  const status = d.assessment.status;
  const level = d.recommendedLevel;
  const prog = d.assessment.progress;

  return (
    <div className="pg-dashboard">
      <h1 style={s('margin:0 0 4px;font-size:30px')}>Welcome back{user ? `, ${user.name}` : ''}</h1>
      <p style={s('margin:0 0 24px;color:var(--ns-muted)')}>Here is where your reading setup stands.</p>

      <section className="c" aria-labelledby="rl" style={s('margin-bottom:20px')}>
        <h2 id="rl">Your Recommended Assistance Level</h2>
        <p className="em" style={s('margin-bottom:16px')}>
          {sum ? `${sum.score} out of ${sum.max} · ${sum.classification}. ${sum.description}` : 'Take the assessment to see your score and a short explanation here.'}
        </p>
        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:12px')} className="g">
          {LEVELS.map(([n, title, label]) => (
            <div key={n} aria-current={level === n ? 'true' : undefined} style={s(level === n ? 'border:2px solid var(--neurosync-teal);background:var(--ns-teal-tint);border-radius:14px;padding:14px' : 'border:2px dashed #D1D5DB;border-radius:14px;padding:14px')}>
              <strong style={s('font-size:15px')}>{title}</strong>
              <div style={s('color:var(--ns-muted);font-size:14px')}>{label}</div>
            </div>
          ))}
        </div>
        {status === 'none' && <Link className="btn" to="/assessment" style={s(BTN)}>Start assessment</Link>}
        {(status === 'in_progress' || status === 'retaking') && <Link className="btn" to="/assessment" style={s(BTN)}>Continue assessment{prog ? ` (${prog.answered} of ${prog.total})` : ''}</Link>}
        {status === 'complete' && <Link className="btn" to="/results" style={s(BTN)}>View full results</Link>}
      </section>

      <div className="g" style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:20px')}>
        <section className="c" aria-labelledby="as">
          <h2 id="as">Assessment Summary</h2>
          {sum ? (
            <>
              <p className="em"><strong style={s('color:var(--neurosync-dark);font-size:20px')}>{sum.score}</strong> out of {sum.max}</p>
              <p className="em">{sum.label}</p>
              <p className="em" style={s('font-size:13px;margin-top:6px')}>Completed {fmt(sum.submittedAt)}</p>
              <Link className="lk" to="/results">See breakdown</Link>
            </>
          ) : status === 'in_progress' && prog ? (
            <p className="em">In progress: {prog.answered} of {prog.total} answered.</p>
          ) : (
            <p className="em">No assessment yet.</p>
          )}
        </section>

        <section className="c" aria-labelledby="ap">
          <h2 id="ap">Accessibility Profile</h2>
          {d.accessibility.saved ? (
            <ul className="em" style={s('padding-left:18px;margin:4px 0 0')}>{d.accessibility.summary.map((x) => <li key={x}>{x}</li>)}</ul>
          ) : (
            <p className="em">No settings saved yet.</p>
          )}
          <Link className="lk" to="/accessibility">Open accessibility</Link>
        </section>

        <section className="c" aria-labelledby="qc">
          <h2 id="qc">Quick Controls</h2>
          <div className="sw"><span id="q1">Focus Mode</span><button role="switch" aria-checked={d.quickControls.focusMode} aria-labelledby="q1" onClick={() => toggle('focusMode')} /></div>
          <div className="sw"><span id="q2">Reading Ruler</span><button role="switch" aria-checked={d.quickControls.readingRuler} aria-labelledby="q2" onClick={() => toggle('readingRuler')} /></div>
          {switchError && <p role="alert" className="em ns-error" style={s('font-size:13px')}>{switchError}</p>}
        </section>

        <section className="c" aria-labelledby="at">
          <h2 id="at">AI Tools</h2>
          <p className="em">Simplify, summarize or get word help.</p>
          <Link className="lk" to="/ai-tools">Open AI Tools</Link>
        </section>

        <section className="c" aria-labelledby="be">
          <h2 id="be">Browser Extension</h2>
          <span style={s(d.extension.connected ? 'display:inline-block;background:var(--ns-teal-tint);color:var(--ns-teal-text);font-size:13px;font-weight:600;padding:4px 12px;border-radius:999px;margin-bottom:8px' : 'display:inline-block;background:var(--ns-orange-tint);color:#7C3F0F;font-size:13px;font-weight:600;padding:4px 12px;border-radius:999px;margin-bottom:8px')}>
            {d.extension.connected ? 'Connected' : 'Not connected'}
          </span>
          {d.extension.connected ? (
            <>
              <p className="em">Your settings are used on any page.{d.extension.lastSeenAt ? ` Last synced ${fmt(d.extension.lastSeenAt)}.` : ''}</p>
              <button className="lk" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <>
              <p className="em">Connect it to use your settings on any page.</p>
              {pairing ? (
                <p className="em" role="status" style={s('margin-top:8px')}>
                  Enter this code in the extension:<br />
                  <strong style={s('font-size:22px;letter-spacing:.12em;color:var(--neurosync-dark)')}>{pairing.code}</strong><br />
                  <span style={s('font-size:13px')}>Valid for {Math.round(pairing.expiresInSeconds / 60)} minutes.</span>
                </p>
              ) : (
                <button className="lk" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={getCode} disabled={pairBusy}>{pairBusy ? 'Creating code…' : 'Get pairing code'}</button>
              )}
            </>
          )}
        </section>

        <section className="c" aria-labelledby="rp">
          <h2 id="rp">Reading Preferences</h2>
          {d.preferences ? (
            <>
              <ul className="em" style={s('padding-left:18px;margin:4px 0 0')}>{d.preferences.items.map((p) => <li key={p.category}><span style={s('font-size:13px')}>{p.category}:</span> {p.choice}</li>)}</ul>
              {d.preferences.congruence != null && <p className="em" style={s('font-size:13px;margin-top:8px')}>Matches {d.preferences.congruence}% of your recommended features.</p>}
            </>
          ) : (
            <p className="em">Nothing set yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
