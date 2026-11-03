import { createHash, randomUUID } from 'node:crypto';
import { simplifyPrompt, summarizePrompt } from '../services/aiPrompts.js';
import { parseBullets } from '../utils/parse.js';
import { TtlCache } from '../utils/cache.js';
import { AppError, AI_UNAVAILABLE_MESSAGE } from '../utils/AppError.js';
import { effectiveSettings } from '../services/accessibilityService.js';
import { compareReadAloudAccuracy, generateReadingQuestions, readingProgressView, scoreReadingQuiz } from '../services/readingService.js';

const QUIZ_TTL_MS = 60 * 60 * 1000;
const MAX_ACTIVE_QUIZZES = 5;
const MAX_SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY = 20;

function ensureReadingData(user) {
  user.readingProgress ||= {};
  const progress = user.readingProgress;
  progress.minutes = Number(progress.minutes) || 0;
  progress.totalSeconds = Number(progress.totalSeconds) || progress.minutes * 60;
  progress.sessions = Number(progress.sessions) || 0;
  progress.words = Number(progress.words) || 0;
  progress.quizzes = Number(progress.quizzes) || 0;
  progress.correctAnswers = Number(progress.correctAnswers) || 0;
  progress.totalQuestions = Number(progress.totalQuestions) || 0;
  progress.recentResults = Array.isArray(progress.recentResults) ? progress.recentResults : [];
  progress.recentSessions = Array.isArray(progress.recentSessions) ? progress.recentSessions : [];
  user.readingQuizzes = Array.isArray(user.readingQuizzes) ? user.readingQuizzes : [];
  user.readingRecommendationState ||= { dismissed: [], applied: [] };
  user.readingRecommendationState.dismissed = Array.isArray(user.readingRecommendationState.dismissed) ? user.readingRecommendationState.dismissed : [];
  user.readingRecommendationState.applied = Array.isArray(user.readingRecommendationState.applied) ? user.readingRecommendationState.applied : [];
  return progress;
}

function recommendationCandidates(user) {
  const settings = effectiveSettings(user);
  const progress = user.readingProgress || {};
  const lastSession = Array.isArray(progress.recentSessions) ? progress.recentSessions.at(-1) : null;
  const recs = [];

  if (!['lexend', 'atkinson', 'opendyslexic'].includes(settings.font)) {
    recs.push({
      id: 'font-lexend',
      title: 'Try Lexend',
      explanation: 'Compare Lexend with your current font and keep whichever feels easier to read.',
      reason: 'Your profile currently uses the system font.',
      settings: { font: 'lexend' },
    });
  }
  if (lastSession?.supportNeed === 'line-tracking' && !settings.readingRuler) {
    recs.push({
      id: 'reading-ruler',
      title: 'Try the reading ruler',
      explanation: 'A horizontal guide can help keep your place as you move through a passage.',
      reason: 'You marked line tracking as something that could help.',
      settings: { readingRuler: true },
    });
  }
  if (lastSession?.supportNeed === 'crowded-text' && settings.lineSpacing < 1.8) {
    recs.push({
      id: 'text-spacing',
      title: 'Increase text spacing',
      explanation: 'Try a little more line, letter, and word spacing, then adjust it to your comfort.',
      reason: 'You marked crowded text as something that could be easier.',
      settings: { lineSpacing: 1.9, letterSpacing: Math.max(4, settings.letterSpacing), wordSpacing: Math.max(3, settings.wordSpacing) },
    });
  }
  if (lastSession?.supportNeed === 'prefer-listening' && !settings.textToSpeech) {
    recs.push({
      id: 'text-to-speech',
      title: 'Try Text-to-Speech',
      explanation: 'Listen to the selected passage using your browser’s speech tools.',
      reason: 'You said listening may help during reading.',
      settings: { textToSpeech: true },
    });
  }
  if (lastSession?.supportNeed === 'complex-text') {
    recs.push({
      id: 'simplify-text',
      title: 'Try AI text simplification',
      explanation: 'Open Reading Intelligence to simplify a passage you choose.',
      reason: 'You marked complex text as something you would like help with.',
      destination: '/ai-tools',
    });
  }
  if (!settings.focusMode && !recs.some((rec) => rec.id === 'reading-ruler')) {
    recs.push({
      id: 'focus-mode',
      title: 'Try Focus Mode',
      explanation: 'Reduce surrounding distractions while you read.',
      reason: 'Focus Mode is currently off in your profile.',
      settings: { focusMode: true },
    });
  }
  return recs;
}

function recommendationView(user) {
  const state = user.readingRecommendationState || { dismissed: [], applied: [] };
  const applied = Array.isArray(state.applied) ? state.applied : [];
  const dismissed = new Set(Array.isArray(state.dismissed) ? state.dismissed : []);
  const candidates = recommendationCandidates(user);
  return {
    recommendations: candidates.filter((rec) => !dismissed.has(rec.id)),
    applied: applied.map(({ id, appliedAt }) => ({ id, appliedAt })),
  };
}

export function createAiController({ ai, words, storage }) {
  const cache = new TtlCache();
  const cached = async (key, produce) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const value = await produce();
    cache.set(key, value);
    return value;
  };

  return {
    async simplify(req, res) {
      const { text } = req.valid;
      res.json(await cached(`s:${text}`, async () => ({ simplified: await ai.chat(simplifyPrompt(text), { maxTokens: 900 }) })));
    },
    async summarize(req, res) {
      const { text } = req.valid;
      res.json(
        await cached(`m:${text}`, async () => {
          const bullets = parseBullets(await ai.chat(summarizePrompt(text), { maxTokens: 500 }));
          if (!bullets.length) throw new AppError(502, AI_UNAVAILABLE_MESSAGE, 'AI_EMPTY_RESPONSE');
          return { summary: bullets.join(' '), bullets };
        })
      );
    },
    async wordAssistance(req, res) {
      res.json(await words.assist(req.valid.word, req.valid.context || ''));
    },
    async readingComprehension(req, res) {
      const { text, source = 'original' } = req.valid;
      const requestId = randomUUID();
      console.info('[reading-quiz]', JSON.stringify({ requestId, stage: 'request_received', passageCharacters: text.length, source, authenticatedType: req.authType || 'user' }));
      const questions = await generateReadingQuestions({ passage: text, ai, diagnosticId: requestId });
      const quiz = {
        id: randomUUID(),
        passageLength: text.trim().length,
        passageDigest: createHash('sha256').update(text.trim()).digest('hex'),
        source,
        settingsUsed: effectiveSettings(req.user),
        questions,
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + QUIZ_TTL_MS,
      };
      storage.users.update(req.user.id, (draft) => {
        ensureReadingData(draft);
        draft.readingQuizzes = draft.readingQuizzes.filter((active) => active.expiresAt > Date.now());
        if (draft.readingQuizzes.length >= MAX_ACTIVE_QUIZZES) draft.readingQuizzes.shift();
        draft.readingQuizzes.push(quiz);
      });
      console.info('[reading-quiz]', JSON.stringify({ requestId, stage: 'questions_returned', questionCount: questions.length }));
      res.json({
        quizId: quiz.id,
        source,
        totalQuestions: questions.length,
        questions: questions.map(({ question, options }) => ({ question, options })),
      });
    },
    async submitReadingComprehension(req, res) {
      const { quizId, answers } = req.valid;
      const user = storage.users.findById(req.user.id);
      const activeQuizzes = Array.isArray(user?.readingQuizzes) ? user.readingQuizzes : [];
      const quiz = activeQuizzes.find((entry) => entry.id === quizId);
      if (!quiz || quiz.expiresAt <= Date.now()) {
        if (quiz) storage.users.update(req.user.id, (draft) => { draft.readingQuizzes = (draft.readingQuizzes || []).filter((entry) => entry.id !== quizId); });
        throw new AppError(404, 'No active quiz was found for this account. Generate a new quiz and try again.', 'QUIZ_NOT_FOUND');
      }
      for (const [index, answer] of Object.entries(answers)) {
        const question = quiz.questions[Number(index)];
        if (!/^(0|[1-9]\d*)$/.test(index) || !question || typeof answer !== 'string' || !question.options.includes(answer)) {
          throw new AppError(400, 'One or more submitted answers are invalid.', 'VALIDATION');
        }
      }
      const result = scoreReadingQuiz(quiz.questions, answers);
      const completedAt = new Date().toISOString();
      const summary = {
        id: quiz.id,
        completedAt,
        total: result.total,
        correct: result.correct,
        percentage: result.percentage,
        passageLength: quiz.passageLength,
        simplified: quiz.source === 'simplified',
        settingsUsed: quiz.settingsUsed,
      };
      storage.users.update(req.user.id, (draft) => {
        const progress = ensureReadingData(draft);
        draft.readingQuizzes = draft.readingQuizzes.filter((entry) => entry.id !== quizId);
        progress.quizzes += 1;
        progress.correctAnswers += result.correct;
        progress.totalQuestions += result.total;
        progress.recentResults.push(summary);
        progress.recentResults = progress.recentResults.slice(-MAX_HISTORY);
      });
      const updatedUser = storage.users.findById(req.user.id);
      res.json({
        ...result,
        passageLength: quiz.passageLength,
        simplified: quiz.source === 'simplified',
        feedback: result.summary,
        message: `You answered ${result.correct} out of ${result.total} questions correctly. Your comprehension score is ${result.percentage}%. This result is for this passage only.`,
        progress: readingProgressView(updatedUser),
      });
    },
    async readAloudAccuracy(req, res) {
      res.json(compareReadAloudAccuracy(req.valid.passage, req.valid.transcript));
    },
    async startReadingSession(req, res) {
      const now = Date.now();
      let reused = false;
      const user = storage.users.update(req.user.id, (draft) => {
        const progress = ensureReadingData(draft);
        const current = progress.activeSession;
        if (current && now - Date.parse(current.startedAt) < MAX_SESSION_DURATION_MS) {
          reused = true;
          return;
        }
        progress.activeSession = {
          id: randomUUID(),
          startedAt: new Date(now).toISOString(),
          source: req.valid.source || 'original',
          settingsUsed: effectiveSettings(draft),
        };
      });
      res.status(reused ? 200 : 201).json({
        session: { id: user.readingProgress.activeSession.id, startedAt: user.readingProgress.activeSession.startedAt },
        progress: readingProgressView(user),
      });
    },
    async readingProgress(req, res) {
      if (req.method === 'GET') {
        const progress = readingProgressView(req.user);
        return res.json({ progress, summary: `${progress.minutes} minutes read across ${progress.sessions} tracked sessions.` });
      }
      const input = req.valid;
      let duplicate = false;
      let notFound = false;
      let expired = false;
      let tooShort = false;
      let invalidTimer = false;
      const user = storage.users.update(req.user.id, (draft) => {
        const progress = ensureReadingData(draft);
        if (progress.recentSessions.some((session) => session.id === input.sessionId)) {
          duplicate = true;
          return;
        }
        const active = progress.activeSession;
        if (!active || active.id !== input.sessionId) {
          notFound = true;
          return;
        }
        const elapsedMs = Date.now() - Date.parse(active.startedAt);
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
          progress.activeSession = null;
          invalidTimer = true;
          return;
        }
        const durationSeconds = Math.floor(elapsedMs / 1000);
        if (durationSeconds > MAX_SESSION_DURATION_MS / 1000) {
          progress.activeSession = null;
          expired = true;
          return;
        }
        if (durationSeconds < 1) {
          tooShort = true;
          return;
        }
        const session = {
          id: input.sessionId,
          completedAt: new Date().toISOString(),
          durationSeconds,
          simplified: active.source === 'simplified',
          supportNeed: input.supportNeed || null,
          settingsUsed: active.settingsUsed,
        };
        progress.activeSession = null;
        progress.sessions += 1;
        progress.totalSeconds += durationSeconds;
        progress.minutes = Math.floor(progress.totalSeconds / 60);
        progress.recentSessions.push(session);
        progress.recentSessions = progress.recentSessions.slice(-MAX_HISTORY);
      });
      if (invalidTimer) throw new AppError(409, 'This reading timer is invalid. Start a new session to continue tracking.', 'READING_SESSION_INVALID');
      if (expired) throw new AppError(409, 'This reading timer expired. Start a new session to continue tracking.', 'READING_SESSION_EXPIRED');
      if (tooShort) throw new AppError(409, 'Read for at least one second before saving this session.', 'READING_SESSION_TOO_SHORT');
      if (notFound) throw new AppError(404, 'No active reading timer was found for this account.', 'READING_SESSION_NOT_FOUND');
      const progress = readingProgressView(user);
      return res.status(duplicate ? 200 : 201).json({
        progress,
        duplicate,
        summary: `${progress.minutes} minutes read across ${progress.sessions} tracked sessions.`,
      });
    },
    async readingRecommendations(req, res) {
      res.json(recommendationView(req.user));
    },
    async updateReadingRecommendation(req, res) {
      const { id, action } = req.valid;
      let appliedNavigation = null;
      storage.users.update(req.user.id, (draft) => {
        ensureReadingData(draft);
        const recommendationState = draft.readingRecommendationState;
        const candidates = recommendationCandidates(draft);
        if (action === 'dismiss') {
          if (!candidates.some((rec) => rec.id === id)) throw new AppError(404, 'That recommendation is no longer available.', 'RECOMMENDATION_NOT_FOUND');
          if (!recommendationState.dismissed.includes(id)) recommendationState.dismissed.push(id);
          return;
        }
        if (action === 'undo') {
          const appliedIndex = recommendationState.applied.findIndex((entry) => entry.id === id);
          if (appliedIndex === -1) throw new AppError(404, 'There is no applied recommendation to undo.', 'RECOMMENDATION_NOT_FOUND');
          const [applied] = recommendationState.applied.splice(appliedIndex, 1);
          const current = effectiveSettings(draft);
          const restored = {};
          for (const [key, value] of Object.entries(applied.settings)) {
            if (current[key] === value) restored[key] = applied.previous[key];
          }
          draft.accessibility.settings = { ...current, ...restored };
          draft.accessibility.updatedAt = new Date().toISOString();
          return;
        }
        const recommendation = candidates.find((rec) => rec.id === id);
        if (!recommendation) throw new AppError(404, 'That recommendation is no longer available.', 'RECOMMENDATION_NOT_FOUND');
        if (recommendation.destination) {
          appliedNavigation = recommendation.destination;
          return;
        }
        const current = effectiveSettings(draft);
        const previous = Object.fromEntries(Object.keys(recommendation.settings).map((key) => [key, current[key]]));
        draft.accessibility.settings = { ...current, ...recommendation.settings };
        draft.accessibility.updatedAt = new Date().toISOString();
        recommendationState.dismissed = recommendationState.dismissed.filter((dismissedId) => dismissedId !== id);
        recommendationState.applied = recommendationState.applied.filter((entry) => entry.id !== id);
        recommendationState.applied.push({ id, settings: recommendation.settings, previous, appliedAt: new Date().toISOString() });
      });
      const user = storage.users.findById(req.user.id);
      res.json({
        ...recommendationView(user),
        ...(appliedNavigation ? { navigateTo: appliedNavigation } : {}),
        settings: effectiveSettings(user),
      });
    },
  };
}
