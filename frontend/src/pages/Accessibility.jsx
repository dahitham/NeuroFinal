import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { s } from '../utils/css.js';
import { api } from '../services/api.js';
import { Engine, DEFAULT_SETTINGS } from '../accessibilityEngine.js';

const SAMPLE = 'Good reading support should feel <span style="background:var(--neurosync-yellow)">quiet and steady</span>. The font, the space between lines and the color behind the words can all change how easily a page is followed.';
const dot = (c) => <span style={s(`display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--neurosync-${c});margin-right:10px`)} />;

/**
 * Reading Studio – layout and styles from Accessibility.dc.html.
 * Settings are loaded from / saved to the backend (/api/accessibility/*). The live preview is rendered by the same
 * engine the Chrome extension uses, scoped to the preview box.
 */
export default function Accessibility() {
  const [settings, setSettings] = useState(null);
  const [meta, setMeta] = useState({ saved: false, recommended: null });
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState(''); // '', 'Saving…', 'All changes saved', or an error
  const [statusKind, setStatusKind] = useState('');
  const pending = useRef({});
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.accessibility.get();
      setSettings(r.settings);
      setMeta({ saved: r.saved, recommended: r.recommended });
      setLoadError('');
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setStatus('Saving…'); setStatusKind('');
    try {
      const r = await api.accessibility.update(patch);
      setMeta({ saved: r.saved, recommended: r.recommended });
      setStatus('All changes saved'); setStatusKind('');
    } catch (e) {
      setStatus(e.message); setStatusKind('err');
    }
  }, []);

  /** Changes apply to the preview instantly and are saved to the backend shortly after. */
  const change = useCallback((patch) => {
    setSettings((cur) => ({ ...cur, ...patch }));
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [flush]);
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, [flush]);

  const reset = async (to) => {
    clearTimeout(timer.current);
    pending.current = {};
    setStatus('Resetting…'); setStatusKind('');
    try {
      const r = await api.accessibility.reset(to);
      setSettings(r.settings);
      setMeta({ saved: r.saved, recommended: r.recommended });
      setStatus(to === 'recommended' ? 'Reset to your recommended settings' : 'Reset to default settings');
    } catch (e) {
      setStatus(e.message); setStatusKind('err');
    }
  };

  /* ------------------------------------------------------------ live preview */
  const ctl = useRef(null);
  const box = useRef(null);
  const sample = useMemo(() => ({ __html: SAMPLE }), []);
  const changeRef = useRef(change);
  changeRef.current = change;
  useEffect(() => {
    if (!box.current || !settings || ctl.current) return undefined;
    ctl.current = Engine.create({ scope: box.current, fontBase: '/fonts/', onReaderExit: () => changeRef.current({ readerMode: false }), onNotice: (m) => { setStatus(m); setStatusKind(''); } });
    return () => { ctl.current && ctl.current.destroy(); ctl.current = null; };
  }, [!!settings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ctl.current && settings) ctl.current.apply({ ...DEFAULT_SETTINGS, ...settings, textToSpeech: false });
  }, [settings]);

  // Text-to-speech demo: turning it on reads the preview once; the speed slider changes the voice rate.
  const ttsOn = settings && settings.textToSpeech;
  const speed = settings && settings.speechSpeed;
  useEffect(() => {
    if (!ctl.current) return undefined;
    if (ttsOn) {
      const t = setTimeout(() => ctl.current && ctl.current.tts.play('Good reading support should feel quiet and steady. The font, the space between lines and the color behind the words can all change how easily a page is followed.', speed), 350);
      return () => { clearTimeout(t); ctl.current && ctl.current.tts.stop(); };
    }
    ctl.current.tts.stop();
    return undefined;
  }, [ttsOn, speed]);

  if (loadError)
    return (
      <div className="pg-accessibility x" role="alert">
        <h1 style={s('margin:0 0 4px;font-size:30px')}>Reading Studio</h1>
        <p className="ns-error">{loadError}</p>
        <button className="ns-btn ns-btn-s" onClick={load}>Try again</button>
      </div>
    );
  if (!settings) return <div className="pg-accessibility x" role="status" style={s('color:var(--ns-muted)')}>Loading your settings…</div>;

  const sw = ({ id, label, k }) => (
    <div className="f"><span id={id}>{label}</span><button className="sw" role="switch" aria-checked={!!settings[k]} aria-labelledby={id} onClick={() => change({ [k]: !settings[k] })} /></div>
  );
  const rng = ({ id, label, k, min, max, step = 1 }) => (
    <div className="f"><label htmlFor={id}>{label}</label><input id={id} type="range" min={min} max={max} step={step} value={settings[k]} onChange={(e) => change({ [k]: Number(e.target.value) })} aria-valuetext={String(settings[k])} /></div>
  );
  const sel = ({ id, label, k, options }) => (
    <div className="f"><label htmlFor={id}>{label}</label><select id={id} value={settings[k]} onChange={(e) => change({ [k]: e.target.value })}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
  );

  return (
    <div className="pg-accessibility x">
      <h1 style={s('margin:0 0 4px;font-size:30px')}>Reading Studio</h1>
      <p style={s('margin:0 0 24px;color:var(--ns-muted)')}>Adjust how text looks and behaves. The preview updates as you change settings.</p>
      <div className="w" style={s('display:grid;grid-template-columns:1.1fr 1fr;gap:24px;align-items:start;max-width:1160px')}>
        <div>
          <section className="c" aria-labelledby="ty"><h2 id="ty">{dot('teal')}Typography</h2>
            {sel({ id: "ft", label: "Font", k: "font", options: [['lexend', 'Lexend'], ['atkinson', 'Atkinson Hyperlegible'], ['system', 'System default'], ['opendyslexic', 'OpenDyslexic']] })}
            {rng({ id: "fs", label: "Font size", k: "fontSize", min: 14, max: 28 })}
            {rng({ id: "ls", label: "Line spacing", k: "lineSpacing", min: 1, max: 2.4, step: 0.1 })}
            {rng({ id: "lt", label: "Letter spacing", k: "letterSpacing", min: 0, max: 10 })}
            {rng({ id: "ws", label: "Word spacing", k: "wordSpacing", min: 0, max: 10 })}
          </section>
          <section className="c" aria-labelledby="rd"><h2 id="rd">{dot('yellow')}Reading</h2>
            {sw({ id: "r1", label: "Bionic Reading", k: "bionicReading" })}
            {sw({ id: "r2", label: "Reading Ruler", k: "readingRuler" })}
            {sw({ id: "r3", label: "Focus Mode", k: "focusMode" })}
            {sw({ id: "r4", label: "Reader Mode", k: "readerMode" })}
          </section>
          <section className="c" aria-labelledby="vs"><h2 id="vs">{dot('orange')}Visual</h2>
            {sel({ id: "bg", label: "Background", k: "background", options: [['cream', 'Warm cream'], ['white', 'White'], ['gray', 'Soft gray']] })}
            {sel({ id: "ct", label: "Color tint", k: "colorTint", options: [['yellow', 'Soft yellow'], ['none', 'None'], ['blue', 'Soft blue']] })}
            {sel({ id: "co", label: "Contrast", k: "contrast", options: [['standard', 'Standard'], ['high', 'High']] })}
          </section>
          <section className="c" aria-labelledby="au"><h2 id="au">{dot('dark')}Audio</h2>
            {sw({ id: "a1", label: "Text-to-Speech", k: "textToSpeech" })}
            {rng({ id: "sp", label: "Speech speed", k: "speechSpeed", min: 0.5, max: 2, step: 0.1 })}
          </section>
        </div>
        <aside aria-labelledby="pv" style={s('position:sticky;top:24px')}>
          <section className="c" style={s('padding:24px')}>
            <h2 id="pv" style={s('margin-bottom:14px')}>Reading Preview</h2>
            <div className="preview-box" ref={box}>
              <p style={s('margin:0;color:var(--ns-text)')} dangerouslySetInnerHTML={sample} />
            </div>
            <div style={s('display:flex;gap:12px;margin-top:18px;flex-wrap:wrap')}>
              <button className="rb" onClick={() => reset('recommended')} style={s('background:var(--ns-teal-strong);color:#fff;border:2px solid var(--ns-teal-strong)')}>Reset to Recommended</button>
              <button className="rb" onClick={() => reset('default')} style={s('background:#fff;color:var(--neurosync-dark);border:2px solid var(--neurosync-dark)')}>Reset to Default</button>
            </div>
            <p className={`ns-status ${statusKind === 'err' ? 'ns-error' : ''}`} role={statusKind === 'err' ? 'alert' : 'status'}>{status}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
