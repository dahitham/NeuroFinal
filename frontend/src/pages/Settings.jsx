import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { s } from '../utils/css.js';
import { api } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const MODES = [['adaptive', 'Adaptive (recommended)'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const RATINGS = [['easeOfReading', 'Ease of reading'], ['navigationEase', 'Navigation ease'], ['usefulness', 'Usefulness'], ['satisfaction', 'Satisfaction']];
const CONSENT_TEXT = 'Your evaluation data will be collected anonymously for research and usability analysis.';

/**
 * Settings. Not part of the supplied design set (the sidebar links to it); composed from the design's tokens only.
 * Holds assessment difficulty, the research-consent choice (landing page promise: "you choose what is stored"),
 * optional anonymous feedback, backend/AI status and account deletion.
 */
export default function Settings() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState({ kind: '', text: '' });
  const [health, setHealth] = useState(null);
  const [ratings, setRatings] = useState({ easeOfReading: 0, navigationEase: 0, usefulness: 0, satisfaction: 0 });
  const [task, setTask] = useState(true);
  const [pw, setPw] = useState('');
  const [hasResult, setHasResult] = useState(false);

  useEffect(() => {
    api.profile.get().then(setP).catch((e) => setError(e.message));
    api.assessment.results('core').then(() => setHasResult(true)).catch(() => {});
  }, []);
  const say = (kind, text) => setNote({ kind, text });
  const guard = async (fn) => { try { await fn(); } catch (e) { say('err', e.message); } };

  if (error) return <div className="pg-dashboard" role="alert"><h1 style={s('margin:0 0 4px;font-size:30px')}>Settings</h1><p className="ns-error">{error}</p></div>;
  if (!p) return <div className="pg-dashboard" role="status" style={s('color:var(--ns-muted)')}>Loading settings…</div>;

  const consent = p.research.consent === true;
  const ratingsOk = Object.values(ratings).every((v) => v >= 1);

  return (
    <div className="pg-dashboard">
      <h1 style={s('margin:0 0 4px;font-size:30px')}>Settings</h1>
      <p style={s('margin:0 0 20px;color:var(--ns-muted)')}>Reading settings live in <Link className="lk" style={{ minHeight: 0 }} to="/accessibility">Reading Studio</Link>.</p>
      <p className={`ns-status ${note.kind === 'err' ? 'ns-error' : ''}`} role={note.kind === 'err' ? 'alert' : 'status'}>{note.text}</p>
      <div className="g" style={s('display:grid;grid-template-columns:repeat(2,1fr);gap:20px;max-width:960px;align-items:start')}>
        <section className="c" aria-labelledby="se1">
          <h2 id="se1">Assessment</h2>
          <div className="ns-field" style={s('margin-top:12px')}>
            <label htmlFor="mode">Question difficulty</label>
            <select id="mode" value={p.preferences.assessmentMode} onChange={(e) => guard(async () => { setP(await api.profile.update({ assessmentMode: e.target.value })); say('ok', 'Saved. This applies the next time you take the assessment.'); })}>
              {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="ns-hint">Adaptive starts in the middle and gets harder or easier as you go.</span>
          </div>
          <Link className="lk" to="/assessment?restart=1">Retake the assessment</Link>
        </section>

        <section className="c" aria-labelledby="se2">
          <h2 id="se2">Research &amp; privacy</h2>
          <p className="em">{CONSENT_TEXT} Nothing that identifies you is included, and the reading tools work the same either way.</p>
          <div className="sw"><span id="rc">Share anonymous evaluation data</span>
            <button role="switch" aria-checked={consent} aria-labelledby="rc" onClick={() => guard(async () => { const r = await api.evaluation.consent(!consent); setP((x) => ({ ...x, research: { consent: r.consent, consentAt: r.consentAt } })); say('ok', r.consent ? 'Thank you. You can switch this off at any time.' : 'Research collection is off. Anonymous responses already shared cannot be linked back to you.'); })} />
          </div>
          {p.isResearchAdmin && (
            <button className="ns-btn ns-btn-s" style={s('margin-top:12px')} onClick={() => guard(async () => {
              const csv = await api.evaluation.exportCsv();
              const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
              const a = document.createElement('a'); a.href = url; a.download = 'neurosync_evaluation.csv'; a.click(); URL.revokeObjectURL(url);
            })}>Download research CSV</button>
          )}
        </section>

        {consent && (
          <section className="c" aria-labelledby="se3" style={{ gridColumn: '1 / -1' }}>
            <h2 id="se3">Share feedback (optional, anonymous)</h2>
            {!hasResult ? <p className="em">Finish the assessment first, then you can rate your experience.</p> : (
              <form onSubmit={(e) => { e.preventDefault(); guard(async () => { const r = await api.evaluation.submit({ ratings, taskCompleted: task }); say('ok', `Thank you – your anonymous response was recorded as ${r.participantId}.`); setRatings({ easeOfReading: 0, navigationEase: 0, usefulness: 0, satisfaction: 0 }); }); }}>
                <div style={s('display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 20px;margin-top:12px')}>
                  {RATINGS.map(([k, label]) => (
                    <div className="ns-field" key={k}>
                      <label htmlFor={k}>{label} (1–5)</label>
                      <select id={k} value={ratings[k]} onChange={(e) => setRatings({ ...ratings, [k]: Number(e.target.value) })}>
                        <option value={0}>Choose…</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="sw"><span id="tc">I was able to complete my reading task</span><button type="button" role="switch" aria-checked={task} aria-labelledby="tc" onClick={() => setTask(!task)} /></div>
                <button className="ns-btn ns-btn-p" disabled={!ratingsOk}>Submit anonymously</button>
              </form>
            )}
          </section>
        )}

        <section className="c" aria-labelledby="se4">
          <h2 id="se4">AI assistance</h2>
          <p className="em">AI runs on the NeuroSync server. Local reading tools always work without it.</p>
          <button className="ns-btn ns-btn-s" onClick={async () => { setHealth({ checking: true }); try { setHealth(await api.health()); } catch (e) { setHealth({ error: e.message }); } }}>Check status</button>
          <p className="em" role="status" style={s('margin-top:10px')}>
            {health && health.checking && 'Checking…'}
            {health && health.error && <span className="ns-error">{health.error}</span>}
            {health && health.ai && (health.ai.configured ? 'Server reachable. AI assistance is available.' : 'Server reachable, but AI is not configured (the server needs a Gemini API key). Local tools still work.')}
          </p>
        </section>

        <section className="c" aria-labelledby="se5">
          <h2 id="se5">Account</h2>
          <button className="ns-btn ns-btn-s" onClick={async () => { await logout(); nav('/'); }}>Log out</button>
          <form style={s('margin-top:20px')} onSubmit={(e) => { e.preventDefault(); if (!window.confirm('Delete your account and all saved data? This cannot be undone.')) return; guard(async () => { await api.profile.remove(pw); await logout(); nav('/'); }); }}>
            <div className="ns-field"><label htmlFor="dpw">Delete account – confirm your password</label><input id="dpw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></div>
            <button className="ns-btn ns-btn-s" disabled={!pw} style={s('border-color:var(--ns-coral-text);color:var(--ns-coral-text)')}>Delete my account</button>
          </form>
        </section>
      </div>
    </div>
  );
}
