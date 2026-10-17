import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { s } from '../utils/css.js';
import { api } from '../services/api.js';

const DOT = { yellow: 'var(--neurosync-yellow)', teal: 'var(--neurosync-teal)', orange: 'var(--neurosync-orange)', dark: 'var(--neurosync-dark)', coral: 'var(--neurosync-coral)' };
const FONT = { lexend: "'NS Lexend',sans-serif", opendyslexic: "'NS OpenDyslexic',sans-serif", atkinson: "'NS Atkinson',sans-serif", system: 'system-ui,sans-serif' };

function Bionic({ text }) {
  return text.split(/(\s+)/).map((t, i) => {
    if (!/\p{L}/u.test(t)) return t;
    const cut = Math.max(1, Math.ceil(t.length * 0.5));
    return <span key={i}><b>{t.slice(0, cut)}</b>{t.slice(cut)}</span>;
  });
}

function Sentence({ sentence, word }) {
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'i');
  return <p className="passage-box" style={{ fontSize: 20 }}>{sentence.split(re).map((p, i) => (i % 2 ? <span className="bigword" key={i}>{p}</span> : p))}</p>;
}

function Shell({ children }) {
  return (
    <div className="ns pg-assessment" style={s('min-height:820px;display:flex;flex-direction:column')}>
      <header style={s('display:flex;justify-content:space-between;align-items:center;padding:20px 40px')}>
        <Link className="ns-logo" to="/dashboard"><i />NeuroSync</Link>
        <Link className="ns-link" to="/dashboard">Save &amp; exit</Link>
      </header>
      <main style={s('flex:1;width:100%;max-width:760px;margin:0 auto;padding:16px 24px 48px;box-sizing:border-box')}>{children}</main>
    </div>
  );
}

/**
 * Assessment – layout and styles from Assessment.dc.html. Questions, progress, time estimate, resume and scoring
 * all come from the backend (/api/assessment/*). The answer key never reaches the browser.
 */
export default function Assessment() {
  const [params] = useSearchParams();
  const part = params.get('part') === 'cognitive' ? 'cognitive' : 'core';
  const nav = useNavigate();
  const [data, setData] = useState(null); // { step, progress, canGoBack }
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const [phase, setPhase] = useState('ask'); // memory items: 'memorize' then 'ask'
  const [left, setLeft] = useState(null);
  const submitting = useRef(false);

  const show = useCallback((payload) => {
    setData(payload);
    const st = payload.step;
    setSelected(st.answer ?? null);
    shownAt.current = Date.now();
    setPhase(st.fact && st.answer == null ? 'memorize' : 'ask');
    setLeft(st.fact && st.answer == null ? st.memorizeSeconds : st.timeLimitSeconds && st.answer == null ? st.timeLimitSeconds : null);
  }, []);

  const finish = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await api.assessment.submit(part);
      nav(part === 'cognitive' ? '/results?part=cognitive' : '/results', { replace: true });
    } catch (e) {
      submitting.current = false;
      setError(e.message);
    }
  }, [part, nav]);

  const load = useCallback(async () => {
    setError('');
    try {
      const restart = params.get('restart') === '1';
      const r = restart ? await api.assessment.start(part, params.get('mode') || undefined) : await api.assessment.questions(part);
      if (restart) nav(`/assessment${part === 'cognitive' ? '?part=cognitive' : ''}`, { replace: true });
      if (r.status === 'submitted') return nav(part === 'cognitive' ? '/results?part=cognitive' : '/results', { replace: true });
      show(r);
    } catch (e) {
      setError(e.message);
    }
  }, [part, params, nav, show]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* countdown for memorise phase + per-question time limit (cognitive check) */
  const step = data && data.step;
  const stepKey = step ? step.id + phase : '';
  useEffect(() => {
    if (!step || left == null) return undefined;
    const t = setInterval(() => {
      setLeft((v) => {
        if (v == null) return v;
        return Math.max(0, v - 1);
      });
    }, 1000);
    return () => clearInterval(t);
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!step || left !== 0) return;
    if (phase === 'memorize') {
      setPhase('ask');
      shownAt.current = Date.now();
      setLeft(step.timeLimitSeconds || null);
    } else if (step.timeLimitSeconds && step.answer == null && selected == null) {
      next(true); // time ran out
    }
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const goto = async (cursor) => {
    const r = await api.assessment.questions(part, cursor);
    show(r);
  };

  async function next(timedOut = false) {
    if (!step || busy) return;
    setBusy(true);
    setError('');
    try {
      if (phase === 'memorize') {
        setPhase('ask');
        shownAt.current = Date.now();
        setLeft(step.timeLimitSeconds || null);
        return;
      }
      const alreadyAnswered = step.answer != null;
      const unchanged = alreadyAnswered && (step.kind === 'passage' || selected === step.answer);
      if (!unchanged) {
        const payload = { stepId: step.id, timeMs: Date.now() - shownAt.current };
        if (step.kind !== 'passage') payload.value = selected;
        if (timedOut) payload.timedOut = true;
        const res = await api.assessment.answer(part, payload);
        if (res.step) show({ step: res.step, progress: res.progress, canGoBack: true });
        else if (res.complete) await finish();
        else await load();
        return;
      }
      // nothing changed on a question that was already answered: just move forward
      if (step.number >= data.progress.total) return finish();
      try {
        await goto(step.index + 1);
      } catch {
        await load();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const prev = async () => {
    if (!step || busy || step.index === 0) return;
    setBusy(true);
    try { await goto(step.index - 1); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  /* ------------------------------------------------------------------ states */
  if (!data)
    return (
      <Shell>
        {error ? (
          <div className="ns-card" role="alert" style={s('padding:40px')}>
            <h1 style={s('font-size:24px;margin-bottom:8px')}>We couldn’t load your questions</h1>
            <p className="ns-error">{error}</p>
            <button className="ns-btn ns-btn-p" onClick={load}>Try again</button>
          </div>
        ) : (
          <p className="ns-muted" role="status">Loading your questions…</p>
        )}
      </Shell>
    );

  const { progress } = data;
  const isLast = step.number >= progress.total;
  const pct = Math.min(100, (step.number / progress.total) * 100);
  const canNext = phase === 'memorize' || step.kind === 'passage' || selected != null;
  const preview = step.preview && selected ? step.preview.byOption[selected] : null;
  const previewStyle = preview
    ? { fontFamily: preview.font ? FONT[preview.font] : undefined, lineHeight: preview.lineHeight, letterSpacing: preview.letterSpacing, background: preview.background, color: preview.color }
    : {};
  const previewText = (preview && preview.text) || (step.preview && step.preview.text) || '';

  return (
    <Shell>
      <div style={s('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px')}>
        <p style={s('margin:0;font-weight:600')} className="ns-muted">Question {step.number} of {progress.total}</p>
        <p style={s('margin:0;font-size:14px')} className="ns-muted">
          {left != null && step.timeLimitSeconds ? <span role="timer" aria-live="off">{phase === 'memorize' ? 'Remember it: ' : 'Time left: '}{left}s</span> : `About ${progress.minutesLeft} minute${progress.minutesLeft === 1 ? '' : 's'} left`}
        </p>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={step.number} aria-label="Assessment progress" style={s('height:10px;background:var(--ns-border);border-radius:999px;overflow:hidden')}>
        <div style={{ ...s('height:100%;background:var(--ns-teal-strong);border-radius:999px'), width: `${pct}%` }} />
      </div>
      <form className="ns-card" style={s('margin-top:32px;padding:40px')} onSubmit={(e) => { e.preventDefault(); if (canNext) next(); }}>
        <fieldset style={s('border:0;padding:0;margin:0')}>
          <legend style={s('padding:0;width:100%')}>
            <span style={s('display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;margin-bottom:12px')} className="ns-muted">
              <span style={{ ...s('width:10px;height:10px;border-radius:50%'), background: DOT[step.dot] || DOT.teal }} />{step.category}
            </span>
            {phase === 'memorize' ? (
              <h1 style={s('font-size:28px;line-height:1.35;margin-bottom:8px')}>{step.fact}</h1>
            ) : (
              <h1 style={s('font-size:28px;line-height:1.35;margin-bottom:8px')}>{step.prompt}</h1>
            )}
            <span className="ns-muted" style={s('display:block;font-size:16px;margin-bottom:24px')}>{phase === 'memorize' ? 'Remember this – it will disappear. Press Next when you are ready.' : step.helper}</span>
          </legend>

          {phase === 'ask' && step.passage && <div className="passage-box" lang="en">{step.passage}</div>}
          {phase === 'ask' && step.sentence && <Sentence sentence={step.sentence} word={step.highlight} />}

          {phase === 'ask' && step.options.length > 0 && (
            <div role="radiogroup" style={s('display:flex;flex-direction:column;gap:12px')}>
              {step.options.map((o, i) => (
                <div key={step.id + o}>
                  <input className="op" type="radio" name="q" id={`o${i}`} checked={selected === o} onChange={() => setSelected(o)} />
                  <label className="ol" htmlFor={`o${i}`}>{o}</label>
                </div>
              ))}
            </div>
          )}

          {phase === 'ask' && step.preview && (
            <div className="prefsample" style={previewStyle} aria-live="polite">
              {preview && preview.bionic ? <Bionic text={previewText} /> : previewText}
            </div>
          )}
        </fieldset>
        {error && <p role="alert" className="ns-error" style={s('margin:20px 0 0')}>{error}</p>}
        <div style={s('display:flex;justify-content:space-between;gap:14px;margin-top:32px')}>
          <button type="button" className="ns-btn ns-btn-s" onClick={prev} disabled={busy || step.index === 0 || phase === 'memorize'}>Previous</button>
          <button type="submit" className="ns-btn ns-btn-p" style={s('min-width:140px')} disabled={busy || !canNext}>{isLast && phase === 'ask' ? 'Finish' : 'Next'}</button>
        </div>
      </form>
      <p className="ns-hint" style={s('text-align:center;margin-top:20px')}>Your answers help personalize your reading settings. This is not a diagnosis.</p>
    </Shell>
  );
}
