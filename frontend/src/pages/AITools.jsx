import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { s } from '../utils/css.js';
import { api } from '../services/api.js';

const dot = (c) => <span style={s(`display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--neurosync-${c});margin-right:10px`)} />;
const WORD_RE = /^[\p{L}][\p{L}'’-]*$/u;
const norm = (w) => w.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').toLowerCase();
const formatDuration = (seconds = 0) => {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
};

export function compareReadAloudLocal(passage, transcript) {
  const source = String(passage || '').replace(/\s+/g, ' ').trim();
  const spoken = String(transcript || '').replace(/\s+/g, ' ').trim();
  if (!source || !spoken) return { accuracy: 0, matchedWords: 0, totalWords: 0, transcript: spoken, differences: [], note: 'Add both a passage and a spoken attempt. Speech recognition can make errors because of accents, noise, or technical limits.' };
  const sourceWords = source.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const transcriptWords = spoken.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const differences = [];
  let sourceIndex = 0;
  let transcriptIndex = 0;
  let matchedWords = 0;
  while (sourceIndex < sourceWords.length && transcriptIndex < transcriptWords.length) {
    if (sourceWords[sourceIndex] === transcriptWords[transcriptIndex]) {
      matchedWords += 1;
      sourceIndex += 1;
      transcriptIndex += 1;
      continue;
    }
    const heardAhead = sourceWords[sourceIndex] === transcriptWords[transcriptIndex + 1]
      || sourceWords[sourceIndex] === transcriptWords[transcriptIndex + 2];
    const expectedAhead = transcriptWords[transcriptIndex] === sourceWords[sourceIndex + 1]
      || transcriptWords[transcriptIndex] === sourceWords[sourceIndex + 2];
    if (heardAhead && !expectedAhead) {
      differences.push({ type: 'extra', heard: transcriptWords[transcriptIndex] });
      transcriptIndex += 1;
    } else if (expectedAhead) {
      differences.push({ type: 'missing', expected: sourceWords[sourceIndex] });
      sourceIndex += 1;
    } else {
      differences.push({ type: 'different', expected: sourceWords[sourceIndex], heard: transcriptWords[transcriptIndex] });
      sourceIndex += 1;
      transcriptIndex += 1;
    }
  }
  while (sourceIndex < sourceWords.length) differences.push({ type: 'missing', expected: sourceWords[sourceIndex++] });
  while (transcriptIndex < transcriptWords.length) differences.push({ type: 'extra', heard: transcriptWords[transcriptIndex++] });
  const total = Math.max(sourceWords.length, transcriptWords.length, 1);
  const accuracy = Math.min(100, Math.round((matchedWords / total) * 100));
  return {
    accuracy,
    matchedWords,
    totalWords: sourceWords.length,
    transcript: spoken,
    differences,
    note: `${accuracy >= 80 ? 'Your recognized words closely match this passage.' : accuracy >= 60 ? 'Some recognized words differ from this passage.' : 'Many recognized words differ from this passage.'} These are potential reading differences, not definite mistakes. Speech recognition can be affected by accents, pronunciation, background noise, or technical limits.`,
  };
}

function Tool({ id, color, title, blurb, label, placeholder, button, idle, run, minHeight, render }) {
  const [text, setText] = useState('');
  const [state, setState] = useState({ kind: 'idle' });
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

export default function AITools() {
  const navigate = useNavigate();
  const wordCache = useRef(new Map());
  const inflight = useRef(new Map());
  const [passage, setPassage] = useState('');
  const [lastSimplified, setLastSimplified] = useState('');
  const [passageSource, setPassageSource] = useState('original');
  const [originalPassage, setOriginalPassage] = useState('');
  const [quiz, setQuiz] = useState(null);
  const [quizState, setQuizState] = useState({ kind: 'idle' });
  const [answers, setAnswers] = useState({});
  const [progress, setProgress] = useState({ minutes: 0, totalSeconds: 0, sessions: 0, words: 0, quizzes: 0, averageComprehension: null, recentResults: [], recentSessions: [], activeSession: null });
  const [progressError, setProgressError] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const [trackingStartedAt, setTrackingStartedAt] = useState(null);
  const [trackingSessionId, setTrackingSessionId] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [supportNeed, setSupportNeed] = useState('');
  const [recommendations, setRecommendations] = useState({ recommendations: [], applied: [] });
  const [recommendationError, setRecommendationError] = useState('');
  const [recommendationBusy, setRecommendationBusy] = useState('');
  const [readAloud, setReadAloud] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const simplify = async (text) => {
    if (text.trim().length < 2) throw new Error('Please paste or type some text first.');
    if (text.length > 4000) throw new Error('That is a lot of text. Please use up to 4,000 characters at a time.');
    const result = await api.ai.simplify(text.trim());
    setLastSimplified(result.simplified);
    return result;
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

  const loadProgress = async () => {
    try {
      const response = await api.ai.progress();
      setProgress(response.progress);
      if (response.progress.activeSession) {
        setTrackingSessionId(response.progress.activeSession.id);
        setTrackingStartedAt(Date.parse(response.progress.activeSession.startedAt));
      } else {
        setTrackingSessionId(null);
        setTrackingStartedAt(null);
      }
      setProgressError('');
    } catch (error) {
      setProgressError(error.message || 'Reading progress could not be loaded.');
    }
  };
  const loadRecommendations = async () => {
    try {
      setRecommendations(await api.ai.recommendations());
      setRecommendationError('');
    } catch (error) {
      setRecommendationError(error.message || 'Recommendations could not be loaded.');
    }
  };
  useEffect(() => {
    loadProgress();
    loadRecommendations();
  }, []);
  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) recognition.stop();
  }, []);
  useEffect(() => {
    if (trackingStartedAt === null) return undefined;
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - trackingStartedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [trackingStartedAt]);

  const generateQuiz = async () => {
    setQuizState({ kind: 'loading' });
    setQuiz(null);
    try {
      if (!passage.trim()) throw new Error('Paste a passage before generating a quiz.');
      const result = await api.ai.comprehension(passage.trim(), passageSource);
      setQuiz(result);
      setAnswers({});
      setQuizState({ kind: 'ok', data: result });
    } catch (e) {
      setQuizState({ kind: 'err', message: e.message || 'The reading quiz is unavailable right now.' });
    }
  };

  const submitQuiz = async () => {
    if (!quiz || !quiz.quizId) return;
    setQuizState({ kind: 'loading' });
    try {
      const result = await api.ai.submitQuiz(quiz.quizId, answers);
      setProgress(result.progress);
      setQuizState({ kind: 'ok', data: result, score: result });
    } catch (e) {
      setQuizState({ kind: 'err', message: e.message || 'The quiz submission failed.' });
    }
  };

  const startTracking = async () => {
    setProgressMessage('');
    setProgressError('');
    setTrackingBusy(true);
    try {
      const response = await api.ai.startReadingSession(passageSource);
      setProgress(response.progress);
      setTrackingSessionId(response.session.id);
      setTrackingStartedAt(Date.parse(response.session.startedAt));
      setElapsedSeconds(0);
    } catch (error) {
      setProgressError(error.message || 'The reading timer could not be started.');
    } finally {
      setTrackingBusy(false);
    }
  };
  const finishTracking = async () => {
    if (trackingStartedAt === null || !trackingSessionId) return;
    setTrackingBusy(true);
    setProgressError('');
    try {
      const response = await api.ai.saveReadingSession({
        sessionId: trackingSessionId,
        ...(supportNeed ? { supportNeed } : {}),
      });
      setProgress(response.progress);
      setProgressMessage('Your tracked reading session was saved.');
      setTrackingSessionId(null);
      setTrackingStartedAt(null);
      setElapsedSeconds(0);
      setSupportNeed('');
    } catch (error) {
      setProgressError(error.message || 'The reading session could not be saved. You can try again.');
    } finally {
      setTrackingBusy(false);
    }
  };

  const recommendationAction = async (id, action) => {
    setRecommendationBusy(id);
    setRecommendationError('');
    try {
      const response = await api.ai.recommendationAction(id, action);
      setRecommendations(response);
      if (response.navigateTo) navigate(response.navigateTo);
    } catch (error) {
      setRecommendationError(error.message || 'That recommendation could not be updated.');
    } finally {
      setRecommendationBusy('');
    }
  };

  const useSimplifiedPassage = () => {
    setOriginalPassage(passage);
    setPassage(lastSimplified);
    setPassageSource('simplified');
  };

  const startReadAloudCheck = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    if (!passage.trim()) {
      setReadAloud({ accuracy: 0, matchedWords: 0, totalWords: 0, differences: [], note: 'Enter the passage before starting the microphone check.' });
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setReadAloud({ accuracy: 0, matchedWords: 0, totalWords: 0, differences: [], note: 'Speech recognition is not available in this browser. Please try a browser with microphone support.' });
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(' ');
      setReadAloud(compareReadAloudLocal(passage, transcript));
    };
    recognition.onerror = (event) => {
      const note = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access was denied. Allow microphone access in your browser settings, then try again.'
        : 'The microphone did not capture a clear read-aloud attempt. Please try again.';
      setReadAloud({ accuracy: 0, matchedWords: 0, totalWords: 0, differences: [], note });
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    try {
      recognition.start();
      setIsListening(true);
      setReadAloud(null);
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
      setReadAloud({ accuracy: 0, matchedWords: 0, totalWords: 0, differences: [], note: 'The microphone could not be started. Check browser permissions and try again.' });
    }
  };

  const onChoice = (index, value) => setAnswers((cur) => ({ ...cur, [index]: value }));

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

      <div className="gg" style={s('display:grid;grid-template-columns:repeat(2,1fr);gap:20px;max-width:1160px;margin-top:24px;align-items:start')}>
        <section className="k" aria-labelledby="reading-quiz">
          <h2 id="reading-quiz">{dot('teal')}Check My Understanding</h2>
          <p>Paste a passage you have read, or select text on a supported page and paste it here. Gemini creates optional questions from that exact text. AI-generated answers may be imperfect.</p>
          <label className="lb" htmlFor="reading-passage">Passage</label>
          <textarea id="reading-passage" value={passage} onChange={(e) => { setPassage(e.target.value); setPassageSource('original'); }} placeholder="Paste the text you want to understand..." style={s('min-height:175px')} />
          {lastSimplified && (
            <div style={s('display:flex;gap:8px;flex-wrap:wrap;margin-top:8px')}>
              <button type="button" className="go" onClick={useSimplifiedPassage}>Use last simplified version</button>
              {passageSource === 'simplified' && <button type="button" className="go" onClick={() => { setPassage(originalPassage); setPassageSource('original'); }}>Use original passage</button>}
              <span className="lb" role="status">{passageSource === 'simplified' ? 'Quiz will use the simplified text.' : 'Quiz will use the original text.'}</span>
            </div>
          )}
          <button className="go" onClick={generateQuiz} disabled={quizState.kind === 'loading'}>{quizState.kind === 'loading' ? 'Checking…' : 'Check My Understanding'}</button>
          {quiz && (
            <div style={s('margin-top:16px')}>
              <p style={s('margin:0 0 12px;font-weight:700')}>Questions</p>
              {quiz.questions.map((q, index) => (
                <div key={`${q.question}-${index}`} style={s('margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid #E5E7EB')}>
                  <p style={s('margin:0 0 8px;font-weight:600')}>{index + 1}. {q.question}</p>
                  {q.options.map((option) => (
                    <label key={`${index}-${option}`} style={s('display:flex;align-items:center;gap:8px;margin:6px 0')}>
                      <input type="radio" name={`q-${index}`} value={option} checked={answers[index] === option} onChange={() => onChoice(index, option)} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ))}
              <button className="go" onClick={submitQuiz} disabled={quizState.kind === 'loading' || !!quizState.score}>Submit answers</button>
            </div>
          )}
          {quizState.kind === 'err' && <p className="ns-error" role="alert" style={s('margin-top:12px')}>{quizState.message}</p>}
          {quizState.kind === 'ok' && quizState.score && (
            <div style={s('margin-top:16px;padding:12px;border-radius:12px;background:var(--ns-teal-tint)')}>
              <strong>{quizState.score.message}</strong>
              <p style={s('margin:8px 0 0')}>{quizState.score.summary}</p>
              <p style={s('margin:8px 0 0;font-size:13px')}>Scores describe this passage and are not a measure of overall reading ability.</p>
              <ol style={s('margin:10px 0 0;padding-left:20px')}>
                {quizState.score.details.map((detail) => (
                  <li key={detail.index} style={s('margin:8px 0')}>
                    <strong>{detail.isCorrect ? 'Correct' : 'Review'}:</strong> {detail.explanation}
                    {detail.evidence && <span> Evidence: “{detail.evidence}”</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section className="k" aria-labelledby="read-aloud-checker">
          <h2 id="read-aloud-checker">{dot('orange')}Read-Aloud Accuracy Checker</h2>
          <p>Read the passage aloud to compare recognized words. The browser will ask for microphone permission when you choose Start; recording never begins automatically. Speech recognition may send audio to the browser’s speech provider; behavior varies by browser. NeuroSync does not save raw audio.</p>
          <textarea value={passage} onChange={(e) => { setPassage(e.target.value); setPassageSource('original'); }} placeholder="Paste the passage you want to read aloud..." style={s('min-height:150px')} />
          <button className="go" onClick={startReadAloudCheck}>{isListening ? 'Stop microphone check' : 'Start microphone check'}</button>
          {readAloud && (
            <div style={s('margin-top:16px;padding:12px;border-radius:12px;background:var(--ns-orange-tint)')}>
              <strong>Potential Reading Differences</strong>
              {readAloud.totalWords > 0 && <p style={s('margin:8px 0 0')}>Word-match estimate: {readAloud.accuracy}%</p>}
              <p style={s('margin:8px 0 0')}>{readAloud.note}</p>
              {readAloud.totalWords > 0 && <p style={s('margin:6px 0 0;color:var(--ns-muted);font-size:13px')}>Matched {readAloud.matchedWords} of {readAloud.totalWords} passage words.</p>}
              {readAloud.transcript && <p style={s('margin:6px 0 0')}>Heard: {readAloud.transcript}</p>}
              {readAloud.differences && readAloud.differences.length > 0 && (
                <div style={s('margin-top:8px')}>
                  <strong>Potential word differences</strong>
                  <ul style={s('margin:4px 0 0;padding-left:18px')}>
                    {readAloud.differences.slice(0, 8).map((difference, index) => (
                      <li key={`${difference.type}-${index}`}>
                        {difference.type === 'missing' ? `Expected “${difference.expected}”`
                          : difference.type === 'extra' ? `Heard extra word “${difference.heard}”`
                            : `Expected “${difference.expected}”, heard “${difference.heard}”`}
                      </li>
                    ))}
                    {readAloud.differences.length > 8 && <li>And {readAloud.differences.length - 8} more.</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="gg" style={s('display:grid;grid-template-columns:repeat(2,1fr);gap:20px;max-width:1160px;margin-top:24px;align-items:start')}>
        <section className="k" aria-labelledby="reading-progress">
          <h2 id="reading-progress">{dot('yellow')}Reading Progress Tracker</h2>
          <div style={s('display:grid;grid-template-columns:repeat(2,1fr);gap:12px')}>
            <div style={s('padding:12px;border-radius:12px;background:#F8FAFC')}><strong>{formatDuration(progress.totalSeconds)}</strong><div style={s('color:var(--ns-muted);font-size:13px')}>Total reading time</div></div>
            <div style={s('padding:12px;border-radius:12px;background:#F8FAFC')}><strong>{progress.sessions}</strong><div style={s('color:var(--ns-muted);font-size:13px')}>Tracked sessions</div></div>
            <div style={s('padding:12px;border-radius:12px;background:#F8FAFC')}><strong>{progress.quizzes}</strong><div style={s('color:var(--ns-muted);font-size:13px')}>Completed tests</div></div>
            <div style={s('padding:12px;border-radius:12px;background:#F8FAFC')}><strong>{progress.averageComprehension === null ? '—' : `${progress.averageComprehension}%`}</strong><div style={s('color:var(--ns-muted);font-size:13px')}>Average on tested passages</div></div>
          </div>
          <p style={s('margin:12px 0 0')}>Start the timer when you begin reading. A session is saved only when you finish it.</p>
          <label className="lb" htmlFor="support-need">Optional: what might help next time?</label>
          <select id="support-need" value={supportNeed} onChange={(event) => setSupportNeed(event.target.value)} disabled={trackingStartedAt !== null}>
            <option value="">No feedback</option>
            <option value="line-tracking">Keeping my place on a line</option>
            <option value="crowded-text">Text feels crowded</option>
            <option value="complex-text">Understanding complex text</option>
            <option value="prefer-listening">I may prefer listening</option>
          </select>
          <div style={s('display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center')}>
            {trackingStartedAt === null
              ? <button className="go" onClick={startTracking} disabled={trackingBusy}>{trackingBusy ? 'Starting…' : 'Start reading timer'}</button>
              : <button className="go" onClick={finishTracking} disabled={trackingBusy}>{trackingBusy ? 'Saving…' : 'Finish and save session'}</button>}
            {trackingStartedAt !== null && <span role="status">Elapsed: {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}</span>}
          </div>
          {progressError && <p className="ns-error" role="alert" style={s('margin:10px 0 0')}>{progressError} <button type="button" className="lk" onClick={loadProgress}>Retry</button></p>}
          {progressMessage && <p role="status" style={s('margin:10px 0 0')}>{progressMessage}</p>}
          {progress.sessions === 0 && progress.quizzes === 0 ? (
            <p style={s('margin:12px 0 0;color:var(--ns-muted)')}>No tracked reading sessions or completed comprehension tests yet.</p>
          ) : (
            <div style={s('margin-top:14px')}>
              <strong>Recent reading sessions</strong>
              {progress.recentSessions.length ? (
                <ul style={s('margin:6px 0 0;padding-left:18px')}>
                  {progress.recentSessions.slice(0, 5).map((session) => (
                    <li key={session.id}>{new Date(session.completedAt).toLocaleString()} · {formatDuration(session.durationSeconds)} · {session.simplified ? 'simplified passage' : 'original passage'} · {session.settingsUsed.font} font</li>
                  ))}
                </ul>
              ) : <p style={s('margin:6px 0 0;color:var(--ns-muted)')}>No timed sessions yet.</p>}
              {progress.recentResults.length > 0 && (
                <>
                  <strong style={s('display:block;margin-top:12px')}>Recent comprehension results</strong>
                  <ul style={s('margin:6px 0 0;padding-left:18px')}>
                    {progress.recentResults.slice(0, 5).map((result) => <li key={result.id}>{result.percentage}% · {result.correct} of {result.total} correct · {new Date(result.completedAt).toLocaleString()}{result.simplified ? ' · simplified passage' : ''}</li>)}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>

        <section className="k" aria-labelledby="recommendations">
          <h2 id="recommendations">{dot('dark')}Personalized Accessibility Recommendations</h2>
          {recommendationError && <p className="ns-error" role="alert">{recommendationError}<button type="button" className="lk" onClick={loadRecommendations}>Retry</button></p>}
          {recommendations.recommendations.length ? recommendations.recommendations.map((item) => (
            <article key={item.id} style={s('padding:10px 0;border-bottom:1px solid #E5E7EB')}>
              <strong>{item.title}</strong>
              <p style={s('margin:4px 0')}>{item.explanation}</p>
              <p style={s('margin:4px 0;color:var(--ns-muted);font-size:13px')}>Reason: {item.reason}</p>
              <div style={s('display:flex;gap:8px;flex-wrap:wrap;margin-top:8px')}>
                <button className="go" onClick={() => recommendationAction(item.id, 'apply')} disabled={recommendationBusy === item.id}>{item.destination ? 'Open tool' : 'Apply'}</button>
                <button className="go" onClick={() => recommendationAction(item.id, 'dismiss')} disabled={recommendationBusy === item.id}>Dismiss</button>
              </div>
            </article>
          )) : <p style={s('color:var(--ns-muted)')}>No new recommendations based on your current settings and feedback.</p>}
          {recommendations.applied.length > 0 && (
            <div style={s('margin-top:12px')}>
              <strong>Recently applied</strong>
              {recommendations.applied.map((item) => (
                <p key={item.id} style={s('margin:6px 0')}>
                  {item.id.replaceAll('-', ' ')} <button type="button" className="lk" onClick={() => recommendationAction(item.id, 'undo')} disabled={recommendationBusy === item.id}>Undo</button>
                </p>
              ))}
            </div>
          )}
          <p style={s('margin-top:12px;color:var(--ns-muted);font-size:13px')}>Suggestions are optional, based on your current settings and the feedback you chose to share. Passage scores do not diagnose a reading disability.</p>
        </section>
      </div>
    </div>
  );
}
