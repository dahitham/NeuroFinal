import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import { shuffle } from '../utils/rng.js';
import { median, round } from '../utils/stats.js';
import { CORE, COGNITIVE, DIFFICULTIES, MODE_TO_DIFFICULTY, MODES, SECTION_META } from '../data/assessmentConfig.js';
import { calculateAssessmentScore, summarizeResults, wordsPerMinute } from './scoringService.js';
import { generateAccessibilityProfile, describeSettings, levelInfo } from './personalizationService.js';
import { answersToFeatures, calculatePreferenceCongruence, previewStyles } from './preferenceService.js';

/**
 * Assessment engine. Sessions are stored per user, so "Save & exit" resumes exactly where you left.
 * All questions come from the existing datasets (via the adapter). The answer key lives in the
 * stored session only and is NEVER included in anything sent to the browser.
 *
 * Adaptive rule (mode "adaptive"): start at MEDIUM; two correct answers in a row → harder;
 * a wrong answer → easier. Modes low / medium / high pin the difficulty.
 */
export function createAssessmentService({ datasets, rng = Math.random, now = () => Date.now() }) {
  const byUid = new Map();
  for (const key of ['readingPassages', 'wordDifficulty', 'memoryRecall', 'patternRecognition', 'sentenceCompletion', 'wordSequencing'])
    for (const it of datasets[key] || []) byUid.set(it.uid, it);
  for (const it of datasets.focus.items) byUid.set(it.uid, it);
  for (const it of datasets.preferences.items) byUid.set(it.uid, it);

  const sid = (session) => `s${session.steps.length + 1}`;

  /* --------------------------------------------------------- adaptive picking */
  function pickItem(items, used, level, mode) {
    const fixed = MODE_TO_DIFFICULTY[mode];
    const lv = fixed ? DIFFICULTIES.indexOf(fixed) : level;
    const pools = DIFFICULTIES.map((d) => items.filter((i) => i.difficulty === d && !used.includes(i.uid)));
    for (const delta of [0, 1, -1, 2, -2]) {
      const idx = lv + delta;
      if (idx >= 0 && idx <= 2 && pools[idx].length) return shuffle(pools[idx], rng)[0];
    }
    return null;
  }

  function applyOutcome(session, section, correct) {
    if (MODE_TO_DIFFICULTY[session.mode]) return;
    const st = session.state;
    if (correct) {
      if (++st.streaks[section] >= 2) {
        st.levels[section] = Math.min(2, st.levels[section] + 1);
        st.streaks[section] = 0;
      }
    } else {
      st.levels[section] = Math.max(0, st.levels[section] - 1);
      st.streaks[section] = 0;
    }
  }

  /* ---------------------------------------------------------------- sessions */
  function newSession({ part = 'core', mode = 'adaptive' } = {}) {
    if (!['core', 'cognitive'].includes(part)) throw new AppError(400, 'Unknown assessment part.', 'VALIDATION');
    if (!MODES.includes(mode)) throw new AppError(400, `mode must be one of: ${MODES.join(', ')}.`, 'VALIDATION');
    const sections = part === 'core' ? ['reading', 'wordDifficulty'] : COGNITIVE.sections.map((s) => s.key);
    const session = {
      id: crypto.randomUUID(),
      part,
      mode,
      status: 'in_progress',
      startedAt: new Date(now()).toISOString(),
      steps: [],
      answers: {},
      state: {
        used: [],
        hardSeen: false,
        generated: { reading: 0, wordDifficulty: 0, focus: false, preferences: false, cognitive: {} },
        levels: Object.fromEntries(sections.map((s) => [s, 1])),
        streaks: Object.fromEntries(sections.map((s) => [s, 0])),
      },
    };
    if (MODE_TO_DIFFICULTY[mode]) for (const s of sections) session.state.levels[s] = DIFFICULTIES.indexOf(MODE_TO_DIFFICULTY[mode]);
    generateIfNeeded(session);
    return session;
  }

  const allAnswered = (session) => session.steps.every((s) => session.answers[s.id]);

  /** Appends the next step(s) once every existing step has an answer. */
  function generateIfNeeded(session) {
    if (!allAnswered(session)) return;
    const g = session.state.generated;
    const st = session.state;
    if (session.part === 'core') {
      if (g.reading < CORE.readingPassages) {
        const item = pickItem(datasets.readingPassages, st.used, st.levels.reading, session.mode);
        if (item) {
          st.used.push(item.uid);
          g.reading += 1;
          if (item.difficulty === 'hard') st.hardSeen = true;
          session.steps.push({ id: sid(session), kind: 'passage', section: 'reading', itemUid: item.uid, difficulty: item.difficulty, wordCount: item.wordCount });
          session.steps.push({ id: sid(session), kind: 'mcq', section: 'comprehension', itemUid: item.uid, difficulty: item.difficulty, options: shuffle(item.options, rng), correct: item.correctAnswer, outcomeSection: 'reading' });
          return;
        }
        g.reading = CORE.readingPassages; // dataset exhausted – continue with what we have
      }
      if (g.wordDifficulty < CORE.wordDifficultyCount) {
        const item = pickItem(datasets.wordDifficulty, st.used, st.levels.wordDifficulty, session.mode);
        if (item) {
          st.used.push(item.uid);
          g.wordDifficulty += 1;
          session.steps.push({ id: sid(session), kind: 'mcq', section: 'wordDifficulty', itemUid: item.uid, difficulty: item.difficulty, options: shuffle(item.options, rng), correct: item.correctAnswer, outcomeSection: 'wordDifficulty' });
          return;
        }
        g.wordDifficulty = CORE.wordDifficultyCount;
      }
      if (!g.focus) {
        g.focus = true;
        for (const f of focusItems(session)) session.steps.push({ id: sid(session), kind: 'self_report', section: 'focus', itemUid: f.uid, options: f.options.map((o) => o.text) });
        return;
      }
      if (!g.preferences) {
        g.preferences = true;
        for (const p of datasets.preferences.items) session.steps.push({ id: sid(session), kind: 'preference', section: 'preferences', itemUid: p.uid, options: [...p.options] });
      }
      return;
    }
    // cognitive part: one adaptive question at a time, section by section
    for (const sec of COGNITIVE.sections) {
      const n = g.cognitive[sec.key] || 0;
      if (n >= COGNITIVE.perSection || !(datasets[sec.key] || []).length) continue;
      const item = pickItem(datasets[sec.key], st.used, st.levels[sec.key], session.mode);
      if (!item) {
        g.cognitive[sec.key] = COGNITIVE.perSection;
        continue;
      }
      st.used.push(item.uid);
      g.cognitive[sec.key] = n + 1;
      session.steps.push({ id: sid(session), kind: 'mcq', section: sec.key, itemUid: item.uid, difficulty: item.difficulty, options: shuffle(item.options, rng), correct: item.correctAnswer, outcomeSection: sec.key });
      return;
    }
  }

  /** FOCUS items that apply to this session (FOCUS-03 only follows a Hard passage). */
  const focusItems = (session) => datasets.focus.items.filter((f) => !/hard difficulty/i.test(f.trigger || '') || session.state.hardSeen);

  function remainingPlanned(session) {
    const g = session.state.generated;
    if (session.part === 'core') {
      let n = (CORE.readingPassages - g.reading) * 2;
      n += CORE.wordDifficultyCount - g.wordDifficulty;
      if (!g.focus) n += focusItems(session).length;
      if (!g.preferences) n += datasets.preferences.items.length;
      return Math.max(0, n);
    }
    return COGNITIVE.sections.reduce((n, s) => n + Math.max(0, Math.min(COGNITIVE.perSection, (datasets[s.key] || []).length) - (g.cognitive[s.key] || 0)), 0);
  }

  const isComplete = (session) => allAnswered(session) && remainingPlanned(session) === 0;

  function progress(session) {
    const answered = session.steps.filter((s) => session.answers[s.id]).length;
    const total = session.steps.length + remainingPlanned(session);
    const left = total - answered;
    return { answered, total, minutesLeft: Math.max(1, Math.ceil((left * CORE.secondsPerStep) / 60)), complete: isComplete(session) };
  }

  /* ------------------------------------------------------------ public views */
  function publicStep(session, index) {
    const step = session.steps[index];
    if (!step) return null;
    const item = byUid.get(step.itemUid);
    const prog = progress(session);
    const view = {
      id: step.id,
      index,
      number: index + 1,
      total: prog.total,
      kind: step.kind,
      options: step.options || [],
      answer: session.answers[step.id] ? session.answers[step.id].value : null,
    };
    if (step.kind === 'passage') {
      Object.assign(view, { ...SECTION_META.reading, prompt: 'Read the passage below at your own pace.', helper: 'Press Next when you have finished reading. There is no time limit.', passage: item.passage });
    } else if (step.section === 'comprehension') {
      Object.assign(view, { ...SECTION_META.comprehension, prompt: item.question, helper: 'Choose the best answer. The passage stays visible.', passage: item.passage });
    } else if (step.section === 'wordDifficulty') {
      Object.assign(view, { ...SECTION_META.wordDifficulty, prompt: item.question, helper: 'Pick the option closest in meaning to the highlighted word.', sentence: item.contextSentence, highlight: item.targetWord });
    } else if (step.section === 'focus') {
      Object.assign(view, { ...SECTION_META.focus, prompt: item.question, helper: 'There are no right or wrong answers. Choose what feels closest.' });
    } else if (step.section === 'preferences') {
      Object.assign(view, { ...SECTION_META.preferences, category: item.category, prompt: 'Which option feels most comfortable for you?', helper: 'Try each option – the sample text changes. There are no right or wrong answers.', preview: { text: item.text || item.textOriginal, byOption: previewStyles(item) } });
    } else {
      const sec = COGNITIVE.sections.find((s) => s.key === step.section);
      Object.assign(view, { category: sec.title, dot: sec.dot, prompt: item.prompt || item.question, helper: 'Choose the best answer. Each question has a time limit.', timeLimitSeconds: COGNITIVE.timeLimits[step.difficulty] });
      if (item.fact) Object.assign(view, { fact: item.fact, memorizeSeconds: COGNITIVE.memorizeSeconds[step.difficulty] });
    }
    return view;
  }

  /** First unanswered step, or the last one if everything is answered. */
  const currentIndex = (session) => {
    const i = session.steps.findIndex((s) => !session.answers[s.id]);
    return i === -1 ? Math.max(0, session.steps.length - 1) : i;
  };

  /* ---------------------------------------------------------------- answering */
  function answer(session, { stepId, value, timeMs, timedOut }) {
    const idx = session.steps.findIndex((s) => s.id === stepId);
    if (idx === -1) throw new AppError(404, 'That question is not part of this assessment.', 'NOT_FOUND');
    const step = session.steps[idx];
    const first = !session.answers[stepId];
    if (first && idx !== currentIndex(session)) throw new AppError(409, 'Please answer the questions in order.', 'OUT_OF_ORDER');
    const ms = Number.isFinite(timeMs) ? Math.min(Math.max(0, Math.round(timeMs)), 3_600_000) : 0;
    const rec = { timeMs: ms, answeredAt: new Date(now()).toISOString() };

    if (step.kind === 'passage') {
      const seconds = ms / 1000;
      Object.assign(rec, { value: 'read', seconds: round(seconds, 1), wpm: wordsPerMinute(step.wordCount, seconds) });
    } else if (timedOut === true && session.part === 'cognitive') {
      Object.assign(rec, { value: '(no answer – time ran out)', timedOut: true, correct: false });
    } else {
      if (typeof value !== 'string' || !step.options.includes(value)) throw new AppError(400, 'Please choose one of the listed answers.', 'VALIDATION');
      rec.value = value;
      if (step.kind === 'mcq') rec.correct = value === step.correct;
    }
    session.answers[stepId] = rec;
    if (first && step.kind === 'mcq') applyOutcome(session, step.outcomeSection, rec.correct);
    session.updatedAt = new Date(now()).toISOString();
    generateIfNeeded(session);
    return session;
  }

  /* ------------------------------------------------------------------ results */
  function collectCore(session) {
    const rounds = [];
    const comp = [];
    const wd = [];
    const focusAnswers = [];
    const prefAnswers = {};
    for (const step of session.steps) {
      const a = session.answers[step.id];
      if (!a) continue;
      const item = byUid.get(step.itemUid);
      if (step.kind === 'passage') rounds.push({ uid: step.itemUid, id: item.id, difficulty: step.difficulty, wordCount: step.wordCount, seconds: a.seconds, wpm: a.wpm });
      else if (step.section === 'comprehension') comp.push({ correct: a.correct, difficulty: step.difficulty });
      else if (step.section === 'wordDifficulty') wd.push({ correct: a.correct, difficulty: step.difficulty });
      else if (step.section === 'focus') {
        const opt = item.options.find((o) => o.text === a.value);
        focusAnswers.push({ id: item.id, text: a.value, scoreImpact: opt ? opt.scoreImpact : 0, maxImpact: item.maxImpact });
      } else if (step.section === 'preferences') prefAnswers[item.id] = a.value;
    }
    return { rounds, comp, wd, focusAnswers, prefAnswers };
  }

  /** Builds the stored result of a finished core assessment (score, level, profile, breakdown). */
  function buildCoreResult(session) {
    if (!isComplete(session)) throw new AppError(409, 'The assessment is not finished yet.', 'INCOMPLETE');
    const { rounds, comp, wd, focusAnswers, prefAnswers } = collectCore(session);
    const comprehension = summarizeResults(comp);
    const wordDifficulty = summarizeResults(wd);
    const score = calculateAssessmentScore({ reading: { rounds }, comprehension, wordDifficulty, focus: { answers: focusAnswers } });
    const profile = generateAccessibilityProfile(score);
    const features = answersToFeatures(prefAnswers);
    const congruence = calculatePreferenceCongruence(profile.settings, features);
    const firstAt = session.steps.length ? session.answers[session.steps[0].id].answeredAt : session.startedAt;
    return {
      sessionId: session.id,
      mode: session.mode,
      startedAt: session.startedAt,
      submittedAt: new Date(now()).toISOString(),
      durationSeconds: Math.max(0, Math.round((new Date(now()) - new Date(firstAt)) / 1000)),
      score,
      breakdown: {
        reading: { rounds, averageWpm: score.components.readingSpeed.detail },
        comprehension,
        wordDifficulty,
        focus: { answers: focusAnswers },
      },
      preferences: { answers: prefAnswers, features, congruence },
      recommended: { assistanceLevel: profile.assistanceLevel, assistanceLabel: profile.assistanceLabel, settings: profile.settings },
    };
  }

  function buildCognitiveResult(session) {
    if (!isComplete(session)) throw new AppError(409, 'The cognitive check is not finished yet.', 'INCOMPLETE');
    const sections = [];
    const all = [];
    for (const sec of COGNITIVE.sections) {
      const rows = session.steps
        .filter((s) => s.section === sec.key)
        .map((s) => ({ ...session.answers[s.id], difficulty: s.difficulty }));
      if (!rows.length) continue;
      const correct = rows.filter((r) => r.correct).length;
      const percent = Math.round((correct / rows.length) * 100);
      sections.push({ key: sec.key, title: sec.title, categories: sec.categories, total: rows.length, correct, percent, band: percent >= 80 ? 'Strong on this task' : percent >= 50 ? 'Developing on this task' : 'More practice may help' });
      all.push(...rows);
    }
    const times = all.filter((r) => r.correct && !r.timedOut && r.timeMs > 0).map((r) => r.timeMs);
    const med = median(times);
    return {
      sessionId: session.id,
      submittedAt: new Date(now()).toISOString(),
      sections,
      overallPercent: all.length ? Math.round((all.filter((r) => r.correct).length / all.length) * 100) : null,
      processingSpeed: { medianSeconds: med == null ? null : round(med / 1000, 1), basis: 'median time of correct answers' },
      attention: { timedOut: all.filter((r) => r.timedOut).length, total: all.length },
      note: 'Descriptive only. This is kept separate from your Recommended Assistance Level and is not a medical or diagnostic measure.',
    };
  }

  /** Shape sent to the Results page. */
  function presentCoreResult(result) {
    const info = levelInfo(result.score.level);
    return {
      score: { total: result.score.total, max: result.score.max, components: result.score.components, complete: result.score.complete, missing: result.score.missing },
      level: info,
      recommendedSettings: describeSettings(result.recommended.settings),
      recommended: result.recommended,
      breakdown: result.breakdown,
      preferences: { answers: result.preferences.answers, congruence: result.preferences.congruence },
      submittedAt: result.submittedAt,
      durationSeconds: result.durationSeconds,
      mode: result.mode,
    };
  }

  return { newSession, generateIfNeeded, publicStep, currentIndex, progress, answer, isComplete, buildCoreResult, buildCognitiveResult, presentCoreResult };
}
