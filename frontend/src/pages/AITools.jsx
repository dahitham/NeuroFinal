import { useRef, useState } from 'react';
import { s } from '../utils/css.js';
import { api } from '../services/api.js';

const dot = (c) => <span style={s(`display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--neurosync-${c});margin-right:10px`)} />;
const WORD_RE = /^[\p{L}][\p{L}'’-]*$/u;
const norm = (w) => w.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').toLowerCase();

/** One tool card: textarea → backend → result box. States: idle, loading, success, error. */
function Tool({ id, color, title, blurb, label, placeholder, button, idle, run, minHeight, render }) {
  const [text, setText] = useState('');
  const [state, setState] = useState({ kind: 'idle' }); // idle | loading | ok | err
  const go = async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ok', data: await run(text) });
    } catch (e) {
      setState({ kind: 'err', message: e.message || 'Something went wrong.' });
    }
  };
  return (
    <section className="k" aria-labelledby={`s${id}`}>
      <h2 id={`s${id}`}>{dot(color)}{title}</h2>
      <p>{blurb}</p>
      <label className="lb" htmlFor={`i${id}`}>{label}</label>
      <textarea id={`i${id}`} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} style={minHeight ? s(`min-height:${minHeight}px`) : undefined} />
      <button className="go" onClick={go} disabled={state.kind === 'loading'}>{state.kind === 'loading' ? 'Working…' : button}</button>
      <span className="lb">Result</span>
      <div className={`res ${state.kind === 'ok' ? 'has-result' : ''}`} aria-live="polite" aria-busy={state.kind === 'loading'}>
        {state.kind === 'idle' && idle}
        {state.kind === 'loading' && 'Working on it…'}
        {state.kind === 'err' && <span className="ns-error" role="alert">{state.message}</span>}
        {state.kind === 'ok' && render(state.data)}
      </div>
    </section>
  );
}

/** Reading Intelligence – layout and styles from AITools.dc.html. All AI calls go through the NeuroSync backend. */
export default function AITools() {
  const wordCache = useRef(new Map()); // word → result
  const inflight = useRef(new Map()); // word → promise (prevents duplicate requests)

  const simplify = async (text) => {
    if (text.trim().length < 2) throw new Error('Please paste or type some text first.');
    if (text.length > 4000) throw new Error('That is a lot of text. Please use up to 4,000 characters at a time.');
    return api.ai.simplify(text.trim());
  };
  const summarize = async (text) => {
    if (text.trim().length < 20) throw new Error('Please paste a few sentences to summarize.');
    if (text.length > 8000) throw new Error('That is a lot of text. Please use up to 8,000 characters at a time.');
    return api.ai.summarize(text.trim());
  };
  const word = async (text) => {
    const w = norm(text);
    if (!w) throw new Error('Please type a word.');
    if (!WORD_RE.test(w)) throw new Error('Word help works with one word at a time. Please type a single word.');
    if (wordCache.current.has(w)) return wordCache.current.get(w);
    if (!inflight.current.has(w)) {
      inflight.current.set(w, api.ai.word(w).then((r) => (wordCache.current.set(w, r), r)).finally(() => inflight.current.delete(w)));
    }
    return inflight.current.get(w);
  };

  return (
    <div className="pg-aitools t">
      <h1 style={s('margin:0 0 4px;font-size:30px')}>Reading Intelligence</h1>
      <p style={s('margin:0 0 24px;color:var(--ns-muted)')}>Make text easier to read. Your text is only used for the request you make.</p>
      <div className="gg" style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:20px;max-width:1160px;align-items:start')}>
        <Tool id={1} color="teal" title="Simplify Text" blurb="Rewrite in plainer words and shorter sentences." label="Your text" placeholder="Paste or type text..." button="Simplify" idle="Your simplified text will appear here." run={simplify}
          render={(d) => <p style={s('margin:0')}>{d.simplified}</p>} />
        <Tool id={2} color="yellow" title="Summarize Text" blurb="Get the key points of a long passage." label="Your text" placeholder="Paste or type text..." button="Summarize" idle="Your summary will appear here." run={summarize}
          render={(d) => <ul>{(d.bullets && d.bullets.length ? d.bullets : [d.summary]).map((b, i) => <li key={i}>{b}</li>)}</ul>} />
        <Tool id={3} color="orange" title="Word Assistance" blurb="Look up a word: meaning, simple example, syllables." label="Word or phrase" placeholder="Type a word..." button="Explain word" idle="The explanation will appear here." run={word} minHeight={130}
          render={(d) => (
            <>
              <dl>
                <dt>Meaning</dt><dd>{d.simpleMeaning}</dd>
                {d.synonym && <><dt>Similar word</dt><dd>{d.synonym}</dd></>}
                {d.visualHint && <><dt>Example</dt><dd>{d.visualHint}</dd></>}
                {d.pronunciation && <><dt>Syllables</dt><dd>{d.pronunciation}</dd></>}
              </dl>
              <p style={s('margin:10px 0 0;font-size:13px;color:var(--ns-muted)')}>{d.source === 'local' ? 'From the NeuroSync vocabulary.' : 'Generated by AI – please double-check important details.'}</p>
            </>
          )} />
      </div>
    </div>
  );
}
