import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import { shuffle } from '../utils/rng.js';
import { median, round } from '../utils/stats.js';
import { CORE, COGNITIVE, DIFFICULTIES, MODE_TO_DIFFICULTY, MODES } from '../data/assessmentConfig.js';
import { calculateAssessmentScore } from './scoringService.js';
import { generateAccessibilityProfile, describeSettings, levelInfo } from './personalizationService.js';

/**
 * Assessment sessions use the supplied category question banks only. The correct option and
 * explanation stay server-side until submission.
 */
export function createAssessmentService({ datasets, rng = Math.random, now = () => Date.now() }) {
  const categories = Object.entries(datasets.categories || {}).filter(([, items]) => Array.isArray(items) && items.length);
  const byUid = new Map(categories.flatMap(([, items]) => items.map((item) => [item.uid, item])));
  const categoryTitle = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  const targetFor = (part, items) => Math.min(part === 'core' ? CORE.questionsPerCategory : COGNITIVE.perSection, items.length);
  const sid = (session) => `s${session.steps.length + 1}`;

  function pickItem(items, used, level, mode) {
    const fixed = MODE_TO_DIFFICULTY[mode];
    if (fixed) {
      const pool = items.filter((item) => item.difficulty === fixed && !used.includes(item.uid));
      return pool.length ? shuffle(pool, rng)[0] : null;
    }
    const lv = level;
    const pools = DIFFICULTIES.map((difficulty) => items.filter((item) => item.difficulty === difficulty && !used.includes(item.uid)));
    for (const delta of [0, 1, -1, 2, -2]) {
      const index = lv + delta;
      if (index >= 0 && index <= 2 && pools[index].length) return shuffle(pools[index], rng)[0];
    }
    return null;
  }

  function applyOutcome(session, category, correct) {
    if (MODE_TO_DIFFICULTY[session.mode]) return;
    const state = session.state;
    if (correct) {
      if (++state.streaks[category] >= 2) {
        state.levels[category] = Math.min(2, state.levels[category] + 1);
        state.streaks[category] = 0;
      }
    } else {
      state.levels[category] = Math.max(0, state.levels[category] - 1);
      state.streaks[category] = 0;
    }
  }

  function newSession({ part = 'core', mode = 'adaptive' } = {}) {
    if (!['core', 'cognitive'].includes(part)) throw new AppError(400, 'Unknown assessment part.', 'VALIDATION');
    if (!MODES.includes(mode)) throw new AppError(400, `mode must be one of: ${MODES.join(', ')}.`, 'VALIDATION');
    const keys = categories.map(([key]) => key);
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
        generated: Object.fromEntries(keys.map((key) => [key, 0])),
        levels: Object.fromEntries(keys.map((key) => [key, MODE_TO_DIFFICULTY[mode] ? DIFFICULTIES.indexOf(MODE_TO_DIFFICULTY[mode]) : 1])),
        streaks: Object.fromEntries(keys.map((key) => [key, 0])),
      },
    };
    generateIfNeeded(session);
    return session;
  }

  const allAnswered = (session) => session.steps.every((step) => session.answers[step.id]);

  /** Appends one randomized/adaptive question once every existing step has an answer. */
  function generateIfNeeded(session) {
    if (!allAnswered(session)) return;
    for (const [category, items] of categories) {
      const generated = session.state.generated[category] || 0;
      const target = targetFor(session.part, items);
      if (generated >= target) continue;
      const item = pickItem(items, session.state.used, session.state.levels[category], session.mode);
      if (!item) {
        session.state.generated[category] = target;
        continue;
      }
      session.state.used.push(item.uid);
      session.state.generated[category] = generated + 1;
      session.steps.push({
        id: sid(session),
        kind: 'mcq',
        section: category,
        itemUid: item.uid,
        difficulty: item.difficulty,
        options: shuffle(item.options, rng),
        correct: item.correctAnswer,
        outcomeSection: category,
      });
      return;
    }
  }

  function remainingPlanned(session) {
    return categories.reduce((remaining, [category, items]) => {
      const target = targetFor(session.part, items);
      return remaining + Math.max(0, target - (session.state.generated[category] || 0));
    }, 0);
  }

  const isComplete = (session) => allAnswered(session) && remainingPlanned(session) === 0;

  function progress(session) {
    const answered = session.steps.filter((step) => session.answers[step.id]).length;
    const total = session.steps.length + remainingPlanned(session);
    const left = total - answered;
    return { answered, total, minutesLeft: Math.max(1, Math.ceil((left * CORE.secondsPerStep) / 60)), complete: isComplete(session) };
  }

  function publicStep(session, index) {
    const step = session.steps[index];
    if (!step) return null;
    const item = byUid.get(step.itemUid);
    if (!item) throw new AppError(409, 'This saved assessment uses retired dataset records. Please start a new assessment.', 'STALE_SESSION');
    const prog = progress(session);
    return {
      id: step.id,
      index,
      number: index + 1,
      total: prog.total,
      kind: step.kind,
      categoryId: item.category,
      category: categoryTitle(item.category),
      skill: item.skill,
      questionId: item.id,
      questionType: item.questionType,
      prompt: item.question,
      helper: session.part === 'cognitive' ? 'Choose the best answer. Each question has a time limit.' : 'Choose the best answer. Your answers help personalize your reading settings.',
      options: step.options.map(({ id, text }) => ({ id, text })),
      answer: session.answers[step.id] ? session.answers[step.id].value : null,
      ...(session.part === 'cognitive' ? { timeLimitSeconds: COGNITIVE.timeLimits[step.difficulty] } : {}),
    };
  }

  const currentIndex = (session) => {
    const index = session.steps.findIndex((step) => !session.answers[step.id]);
    return index === -1 ? Math.max(0, session.steps.length - 1) : index;
  };

  function answer(session, { stepId, value, timeMs, timedOut }) {
    const index = session.steps.findIndex((step) => step.id === stepId);
    if (index === -1) throw new AppError(404, 'That question is not part of this assessment.', 'NOT_FOUND');
    const step = session.steps[index];
    const first = !session.answers[stepId];
    if (first && index !== currentIndex(session)) throw new AppError(409, 'Please answer the questions in order.', 'OUT_OF_ORDER');
    const ms = Number.isFinite(timeMs) ? Math.min(Math.max(0, Math.round(timeMs)), 3_600_000) : 0;
    const record = { timeMs: ms, answeredAt: new Date(now()).toISOString() };

    if (timedOut === true && session.part === 'cognitive') {
      Object.assign(record, { value: '(no answer – time ran out)', timedOut: true, correct: false });
    } else {
      if (typeof value !== 'string' || !step.options.some((option) => option.id === value)) {
        throw new AppError(400, 'Please choose one of the listed answers.', 'VALIDATION');
      }
      record.value = value;
      record.correct = value === step.correct;
    }
    session.answers[stepId] = record;
    if (first) applyOutcome(session, step.outcomeSection, record.correct);
    session.updatedAt = new Date(now()).toISOString();
    generateIfNeeded(session);
    return session;
  }

  function collectAnswers(session) {
    return session.steps.map((step) => {
      const answerRecord = session.answers[step.id];
      const item = byUid.get(step.itemUid);
      const selected = item.options.find((option) => option.id === answerRecord.value);
      const correct = item.options.find((option) => option.id === item.correctAnswer);
      return {
        id: item.id,
        category: item.category,
        skill: item.skill,
        difficulty: item.difficulty,
        question: item.question,
        selectedAnswer: selected ? selected.text : null,
        correctAnswer: correct.text,
        correct: answerRecord.correct === true,
        explanation: item.explanation,
        timeMs: answerRecord.timeMs,
        ...(answerRecord.timedOut ? { timedOut: true } : {}),
      };
    });
  }

  function summarizeCategories(answers) {
    return categories.map(([key]) => {
      const rows = answers.filter((answerRecord) => answerRecord.category === key);
      const correct = rows.filter((answerRecord) => answerRecord.correct).length;
      const percent = rows.length ? Math.round((correct / rows.length) * 100) : 0;
      return {
        key,
        title: categoryTitle(key),
        total: rows.length,
        correct,
        percent,
        band: percent >= 80 ? 'Strong on this task' : percent >= 50 ? 'Developing on this task' : 'More practice may help',
      };
    }).filter((category) => category.total);
  }

  function buildCoreResult(session) {
    if (!isComplete(session)) throw new AppError(409, 'The assessment is not finished yet.', 'INCOMPLETE');
    const answers = collectAnswers(session);
    const categoryResults = summarizeCategories(answers);
    const score = calculateAssessmentScore(categoryResults);
    const profile = generateAccessibilityProfile(score);
    const firstAt = session.steps.length ? session.answers[session.steps[0].id].answeredAt : session.startedAt;
    return {
      sessionId: session.id,
      mode: session.mode,
      startedAt: session.startedAt,
      submittedAt: new Date(now()).toISOString(),
      durationSeconds: Math.max(0, Math.round((new Date(now()) - new Date(firstAt)) / 1000)),
      score,
      breakdown: { categories: categoryResults, answers },
      recommended: { assistanceLevel: profile.assistanceLevel, assistanceLabel: profile.assistanceLabel, settings: profile.settings },
    };
  }

  function buildCognitiveResult(session) {
    if (!isComplete(session)) throw new AppError(409, 'The cognitive check is not finished yet.', 'INCOMPLETE');
    const answers = collectAnswers(session);
    const sections = summarizeCategories(answers);
    const times = answers.filter((answerRecord) => answerRecord.correct && !answerRecord.timedOut && answerRecord.timeMs > 0).map((answerRecord) => answerRecord.timeMs);
    const med = median(times);
    return {
      sessionId: session.id,
      submittedAt: new Date(now()).toISOString(),
      sections,
      answers,
      overallPercent: answers.length ? Math.round((answers.filter((answerRecord) => answerRecord.correct).length / answers.length) * 100) : null,
      processingSpeed: { medianSeconds: med == null ? null : round(med / 1000, 1), basis: 'median time of correct answers' },
      attention: { timedOut: answers.filter((answerRecord) => answerRecord.timedOut).length, total: answers.length },
      note: 'Descriptive only. This is kept separate from your Recommended Assistance Level and is not a medical or diagnostic measure.',
    };
  }

  function presentCoreResult(result) {
    return {
      score: { total: result.score.total, max: result.score.max, components: result.score.components, complete: result.score.complete, missing: result.score.missing },
      level: levelInfo(result.score.level),
      recommendedSettings: describeSettings(result.recommended.settings),
      recommended: result.recommended,
      breakdown: result.breakdown,
      submittedAt: result.submittedAt,
      durationSeconds: result.durationSeconds,
      mode: result.mode,
    };
  }

  const isSessionCompatible = (session) =>
    !!session && Array.isArray(session.steps) && session.steps.length > 0 && session.steps.every((step) => byUid.has(step.itemUid));

  return {
    newSession,
    generateIfNeeded,
    publicStep,
    currentIndex,
    progress,
    answer,
    isComplete,
    isSessionCompatible,
    buildCoreResult,
    buildCognitiveResult,
    presentCoreResult,
  };
}
