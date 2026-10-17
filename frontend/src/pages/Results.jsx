import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { s } from '../utils/css.js';
import { api } from '../services/api.js';

const LEVEL_COLOR = { 1: 'var(--neurosync-yellow)', 2: 'var(--neurosync-orange)', 3: 'var(--neurosync-coral)' };
const NAMES = { questionAccuracy: 'Question accuracy' };

/** Assessment Results – layout and styles from Results.dc.html; everything shown is the user's real, stored result. */
export default function Results() {
  const [params] = useSearchParams();
  if (params.get('part') === 'cognitive') return <CognitiveResults />;
  return <CoreResults />;
}

function CoreResults() {
  const nav = useNavigate();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(false);
  const [cog, setCog] = useState(null);

  useEffect(() => {
    api.assessment.results('core').then((r) => {
      setR(r);
      if (r.cognitiveCompleted) api.assessment.results('cognitive').then(setCog).catch(() => {});
    }).catch((e) => setError(e));
  }, []);

  const apply = async () => {
    setApplying(true);
    try {
      await api.accessibility.reset('recommended');
      nav('/dashboard');
    } catch (e) {
      setError(e);
      setApplying(false);
    }
  };

  if (error && !r)
    return (
      <div className="r pg-results" style={s('min-height:760px;padding:48px 24px;box-sizing:border-box')}>
        <main style={s('max-width:760px;margin:0 auto;text-align:center')} role={error.status === 404 ? 'status' : 'alert'}>
          <h1 style={s('margin:0 0 8px;font-size:34px')}>{error.status === 404 ? 'No results yet' : 'We couldn’t load your results'}</h1>
          <p style={s('margin:0 0 24px;color:var(--ns-muted)')}>{error.message}</p>
          <Link className="b" to={error.status === 404 ? '/assessment' : '/dashboard'} style={s('background:var(--ns-teal-strong);color:#fff;text-decoration:none;display:inline-flex;align-items:center;justify-content:center')}>{error.status === 404 ? 'Start the assessment' : 'Back to dashboard'}</Link>
        </main>
      </div>
    );
  if (!r) return <div className="ns-center-screen" role="status">Loading your results…</div>;

  const L = r.level.level;
  const items = r.recommendedSettings;
  const c = r.score.components;
  const categoryResults = r.breakdown.categories || [];
  const answers = r.breakdown.answers || [];
  return (
    <div className="r pg-results" style={s('min-height:760px;padding:48px 24px;box-sizing:border-box')}>
      <main style={s('max-width:760px;margin:0 auto')}>
        <div style={s('text-align:center;margin-bottom:28px')}>
          <span style={s('display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:18px;color:var(--neurosync-dark);margin-bottom:20px')}><span style={s('width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--neurosync-dark) 50%,var(--neurosync-teal) 50%);display:inline-block')} />NeuroSync</span>
          <h1 style={s('margin:0 0 8px;font-size:34px')}>Your assessment is complete</h1>
          <p style={s('margin:0;color:var(--ns-muted)')}>Thank you. Here is a starting point for personalizing your reading.</p>
        </div>

        <section aria-labelledby="lv" style={s('background:#fff;border-radius:20px;padding:32px;box-shadow:0 1px 3px rgba(17,24,39,.08),0 8px 24px rgba(17,24,39,.04);display:flex;gap:28px;align-items:center;flex-wrap:wrap')}>
          <div style={s('width:120px;height:120px;border-radius:50%;background:var(--ns-teal-tint);display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none')}>
            <span style={s('font-size:36px;font-weight:700;color:var(--neurosync-dark);line-height:1')}>{r.score.total}</span>
            <span style={s('font-size:14px;color:var(--ns-muted)')}>out of {r.score.max}</span>
          </div>
          <div style={s('flex:1;min-width:240px')}>
            <span style={{ ...s('display:inline-block;color:var(--neurosync-dark);font-size:13px;font-weight:700;padding:4px 12px;border-radius:999px;letter-spacing:.04em'), background: LEVEL_COLOR[L] }}>LEVEL {L} · PERSONALIZATION PROFILE</span>
            <h2 id="lv" style={s('margin:10px 0 6px;font-size:26px;color:var(--neurosync-teal)')}>{r.level.label}</h2>
            <p style={s('margin:0;color:var(--ns-muted)')}>{r.level.description}</p>
            <div style={s('margin-top:18px')}>
              <div role="img" aria-label={`Assistance spectrum: Level ${L} of 3 recommended`} style={s('display:flex;gap:6px')}>
                {[1, 2, 3].map((n) => (
                  <div key={n} style={{ ...s(n === L ? 'flex:1;height:14px;margin-top:-2px;border-radius:7px;box-shadow:0 0 0 3px var(--neurosync-dark)' : 'flex:1;height:10px;border-radius:6px;opacity:.45'), background: LEVEL_COLOR[n] }} />
                ))}
              </div>
              <div style={s('display:flex;justify-content:space-between;font-size:13px;color:var(--ns-muted);margin-top:8px')}>
                <span style={n(L === 1)}>Level 1 · Mild</span><span style={n(L === 2)}>Level 2 · Moderate</span><span style={n(L === 3)}>Level 3 · Maximum</span>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="rs" style={s('background:#fff;border-radius:20px;padding:28px 32px;margin-top:20px;box-shadow:0 1px 3px rgba(17,24,39,.08)')}>
          <h2 id="rs" style={s('margin:0 0 8px;font-size:20px')}>Recommended accessibility settings</h2>
          {items.map((it, i) => (
            <div className="row" key={it} style={i === items.length - 1 ? s('border-bottom:0') : undefined}><span aria-hidden="true" style={s('color:#166534;font-weight:700')}>✓</span>{it}</div>
          ))}
        </section>

        <section aria-labelledby="bd" style={s('background:#fff;border-radius:20px;padding:28px 32px;margin-top:20px;box-shadow:0 1px 3px rgba(17,24,39,.08)')}>
          <h2 id="bd" style={s('margin:0 0 8px;font-size:20px')}>How your score was made</h2>
          {Object.entries(c).map(([k, v], i, arr) => (
            <div className="row" key={k} style={{ ...(i === arr.length - 1 && !categoryResults.length ? s('border-bottom:0') : {}), justifyContent: 'space-between' }}>
              <span>{NAMES[k] || k}{v.detail ? <span style={s('color:var(--ns-muted);font-size:14px')}> · {v.detail}</span> : null}</span>
              <strong>{v.points} of {v.max}</strong>
            </div>
          ))}
          {categoryResults.map((category) => (
            <div className="row" key={category.key} style={{ justifyContent: 'space-between' }}>
              <span>{category.title}<span style={s('color:var(--ns-muted);font-size:14px')}> · {category.correct} of {category.total} correct</span></span>
              <strong>{category.percent}%</strong>
            </div>
          ))}
          <p style={s('margin:12px 0 0;color:var(--ns-muted);font-size:14px')}>The 0–14 heuristic scales the share of incorrect answers to 14 points; the existing Level 1–3 thresholds are unchanged. Higher points mean more support may help. This is a personalization guide, not a diagnosis.</p>
          {answers.length > 0 && (
            <details style={s('margin-top:16px')}>
              <summary style={s('cursor:pointer;font-weight:600')}>Review answer explanations</summary>
              <div style={s('margin-top:10px')}>
                {answers.map((answer) => (
                  <div key={answer.id} style={s('padding:12px 0;border-bottom:1px solid var(--ns-border)')}>
                    <strong>{answer.question}</strong>
                    <p style={s('margin:6px 0;color:var(--ns-muted);font-size:14px')}>Your answer: {answer.selectedAnswer || 'No answer'} · Correct answer: {answer.correctAnswer}</p>
                    <p style={s('margin:0;font-size:14px')}>{answer.explanation}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        {cog && (
          <section aria-labelledby="cg" style={s('background:#fff;border-radius:20px;padding:28px 32px;margin-top:20px;box-shadow:0 1px 3px rgba(17,24,39,.08)')}>
            <h2 id="cg" style={s('margin:0 0 4px;font-size:20px')}>Cognitive check (separate from your level)</h2>
            <p style={s('margin:0 0 8px;color:var(--ns-muted);font-size:14px')}>{cog.note}</p>
            {cog.sections.map((x) => <div className="row" key={x.key} style={{ justifyContent: 'space-between' }}><span>{x.title}<span style={s('color:var(--ns-muted);font-size:14px')}> · {x.band}</span></span><strong>{x.percent}%</strong></div>)}
          </section>
        )}

        {error && <p role="alert" className="ns-error" style={s('text-align:center;margin-top:20px')}>{error.message}</p>}
        <div style={s('display:flex;gap:14px;justify-content:center;margin-top:28px;flex-wrap:wrap')}>
          <button className="b" onClick={apply} disabled={applying} style={s('background:var(--ns-teal-strong);color:#fff')}>{applying ? 'Applying…' : 'Apply Recommended Settings'}</button>
          <Link className="b" to="/accessibility" style={s('background:#fff;color:var(--neurosync-dark);border-color:var(--neurosync-dark);text-decoration:none;display:inline-flex;align-items:center;justify-content:center')}>Customize Settings</Link>
        </div>
        <p style={s('text-align:center;margin-top:20px;font-size:14px')}>
          <Link className="ns-link" to="/assessment?restart=1">Retake the assessment</Link>
          {!cog && <> · <Link className="ns-link" to="/assessment?part=cognitive&restart=1">Optional: cognitive check</Link></>}
        </p>
      </main>
    </div>
  );
}
const n = (on) => (on ? s('font-weight:600;color:var(--neurosync-dark)') : undefined);

function CognitiveResults() {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.assessment.results('cognitive').then(setR).catch((e) => setError(e.message)); }, []);
  return (
    <div className="r pg-results" style={s('min-height:760px;padding:48px 24px;box-sizing:border-box')}>
      <main style={s('max-width:760px;margin:0 auto')}>
        <div style={s('text-align:center;margin-bottom:28px')}>
          <h1 style={s('margin:0 0 8px;font-size:34px')}>Cognitive check complete</h1>
          <p style={s('margin:0;color:var(--ns-muted)')}>This is kept separate from your Recommended Assistance Level.</p>
        </div>
        {error && <p role="alert" className="ns-error" style={s('text-align:center')}>{error}</p>}
        {!r && !error && <p role="status" style={s('text-align:center')}>Loading…</p>}
        {r && (
          <section style={s('background:#fff;border-radius:20px;padding:28px 32px;box-shadow:0 1px 3px rgba(17,24,39,.08)')}>
            {r.sections.map((x) => <div className="row" key={x.key} style={{ justifyContent: 'space-between' }}><span>{x.title}<span style={s('color:var(--ns-muted);font-size:14px')}> · {x.band}</span></span><strong>{x.percent}%</strong></div>)}
            <div className="row" style={{ ...s('border-bottom:0'), justifyContent: 'space-between' }}><span>Response speed<span style={s('color:var(--ns-muted);font-size:14px')}> · {r.processingSpeed.basis}</span></span><strong>{r.processingSpeed.medianSeconds != null ? `${r.processingSpeed.medianSeconds}s` : '—'}</strong></div>
            <p style={s('margin:12px 0 0;color:var(--ns-muted);font-size:14px')}>{r.note}</p>
          </section>
        )}
        <div style={s('display:flex;gap:14px;justify-content:center;margin-top:28px')}>
          <Link className="b" to="/results" style={s('background:var(--ns-teal-strong);color:#fff;text-decoration:none;display:inline-flex;align-items:center;justify-content:center')}>Back to my results</Link>
          <Link className="b" to="/dashboard" style={s('background:#fff;color:var(--neurosync-dark);border-color:var(--neurosync-dark);text-decoration:none;display:inline-flex;align-items:center;justify-content:center')}>Dashboard</Link>
        </div>
      </main>
    </div>
  );
}
