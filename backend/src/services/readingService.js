import { AppError } from '../utils/AppError.js';
import { comprehensionPrompt } from './aiPrompts.js';
import { extractJson } from '../utils/parse.js';

const QUIZ_MIN_PASSAGE_LENGTH = 80;
const QUIZ_MAX_QUESTIONS = 5;
const QUIZ_MIN_QUESTIONS = 3;
const EVIDENCE_STOP_WORDS = new Set(['about', 'after', 'also', 'are', 'because', 'been', 'being', 'between', 'from', 'have', 'into', 'more', 'over', 'that', 'their', 'there', 'these', 'they', 'this', 'through', 'under', 'which', 'with', 'were', 'what', 'when', 'where', 'while', 'will', 'would']);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTextForMatch(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function relevantToPassage(question, passage) {
  const evidence = normalizeTextForMatch(question.evidence || '');
  const passageText = normalizeTextForMatch(passage);
  if (!evidence) return false;
  if (passageText.includes(evidence)) return true;
  const evidenceWords = [...new Set(evidence.split(/\s+/).filter((word) => word.length > 2 && !EVIDENCE_STOP_WORDS.has(word)))];
  if (evidenceWords.length < 3) return false;
  const passageWords = new Set(passageText.split(/\s+/));
  const overlap = evidenceWords.filter((word) => passageWords.has(word)).length;
  return overlap / evidenceWords.length >= 0.6;
}

export function validateGeneratedQuestions(questions, passage) {
  const cleanPassage = cleanText(passage);
  if (cleanPassage.length < QUIZ_MIN_PASSAGE_LENGTH) {
    throw new AppError(400, `Please provide at least ${QUIZ_MIN_PASSAGE_LENGTH} characters of passage text for a reading comprehension quiz.`, 'SHORT_PASSAGE');
  }
  const seen = new Set();
  const valid = [];
  const items = Array.isArray(questions) ? questions : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const question = String(item.question || '').trim();
    const explanation = String(item.explanation || '').trim();
    const evidence = String(item.evidence || '').trim();
    const options = Array.isArray(item.options) ? item.options.map((option) => String(option || '').trim()) : [];
    const correctAnswer = String(item.correctAnswer || '').trim();
    if (!question || !explanation || !evidence || options.length !== 4 || options.some((option) => !option) || new Set(options.map(normalizeTextForMatch)).size !== 4 || !options.includes(correctAnswer)) continue;
    const normalizedQuestion = normalizeTextForMatch(question);
    if (seen.has(normalizedQuestion)) continue;
    seen.add(normalizedQuestion);
    if (!relevantToPassage({ evidence }, cleanPassage)) continue;
    valid.push({
      question,
      options,
      correctAnswer,
      explanation,
      evidence,
    });
  }
  if (valid.length < QUIZ_MIN_QUESTIONS || valid.length > QUIZ_MAX_QUESTIONS) {
    return [];
  }
  return valid.slice(0, QUIZ_MAX_QUESTIONS);
}

export function scoreReadingQuiz(questions, answers = {}) {
  const total = Array.isArray(questions) ? questions.length : 0;
  let correct = 0;
  const details = (Array.isArray(questions) ? questions : []).map((question, index) => {
    const selected = answers && (answers[index] ?? answers[String(index)] ?? null);
    const isCorrect = selected === question.correctAnswer;
    if (isCorrect) correct += 1;
    return {
      index,
      question: question.question,
      selected,
      correctAnswer: question.correctAnswer,
      isCorrect,
      explanation: question.explanation,
      evidence: question.evidence,
    };
  });
  const percentage = total ? Math.round((correct / total) * 100) : 0;
  const summary =
    correct === total
      ? 'Excellent work. You understood the passage very well.'
      : percentage >= 60
        ? 'Strong understanding. A few details still need a second read.'
        : 'This result measures understanding of this specific passage. Try reading the key sentences again and review the explanations.';
  return {
    total,
    correct,
    incorrect: total - correct,
    percentage,
    summary,
    details,
  };
}

export async function generateReadingQuestions({ passage, ai, maxAttempts = 3, diagnosticId = null }) {
  const log = (stage, details = {}, level = 'info') => {
    const write = level === 'warn' ? console.warn : console.info;
    write('[reading-quiz]', JSON.stringify({ requestId: diagnosticId, stage, ...details }));
  };
  const cleanPassage = cleanText(passage);
  if (cleanPassage.length < QUIZ_MIN_PASSAGE_LENGTH) {
    log('passage_validation_failed', { category: 'SHORT_PASSAGE', passageCharacters: cleanPassage.length }, 'warn');
    throw new AppError(400, `Please provide at least ${QUIZ_MIN_PASSAGE_LENGTH} characters of passage text before generating a reading comprehension quiz.`, 'SHORT_PASSAGE');
  }
  log('passage_validation_completed', { passageCharacters: cleanPassage.length });

  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    log('gemini_request_started', { attempt: attempt + 1, maxAttempts });
    let raw;
    try {
      raw = await ai.chat(comprehensionPrompt(cleanPassage), { maxTokens: 1200, temperature: 0.35 });
    } catch (error) {
      log('gemini_request_failed', { attempt: attempt + 1, category: error instanceof AppError ? error.code : 'AI_REQUEST_FAILED' }, 'warn');
      throw error;
    }
    log('gemini_response_received', { attempt: attempt + 1, responseCharacters: String(raw || '').length });
    try {
      const parsed = extractJson(raw);
      if (!parsed) throw new Error('The model response did not contain valid JSON.');
      const questions = validateGeneratedQuestions(parsed && parsed.questions ? parsed.questions : parsed, cleanPassage);
      log('question_validation_completed', { attempt: attempt + 1, validQuestions: questions.length });
      if (questions.length >= QUIZ_MIN_QUESTIONS) return questions;
      lastError = new AppError(502, 'The AI could not create a valid passage-based quiz. Please try again or use a different passage.', 'AI_QUESTION_INVALID');
    } catch (error) {
      log('question_validation_failed', { attempt: attempt + 1, category: error instanceof AppError ? error.code : 'AI_INVALID_JSON' }, 'warn');
      lastError = error instanceof AppError
        ? error
        : new AppError(502, 'The AI response could not be validated as a passage-based quiz. Please try again.', 'AI_QUESTION_INVALID');
    }
  }
  throw lastError || new AppError(502, 'The reading quiz could not be generated at this time.', 'AI_QUESTION_FAILED');
}

export function compareReadAloudAccuracy(passage, transcript) {
  const source = cleanText(passage);
  const spoken = cleanText(transcript);
  if (!source || !spoken) {
    return { accuracy: 0, totalWords: 0, matchedWords: 0, differences: [], note: 'Add a passage and a spoken attempt to check accuracy. Speech recognition can make errors because of accents, noise, or technical limits.' };
  }
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
  const base = Math.max(sourceWords.length, transcriptWords.length, 1);
  const accuracy = Math.min(100, Math.round((matchedWords / base) * 100));
  const note = `${accuracy >= 80 ? 'Your recognized words closely match this passage.' : accuracy >= 60 ? 'Some recognized words differ from this passage.' : 'Many recognized words differ from this passage.'} These are potential reading differences, not definite mistakes. Speech recognition can be affected by accents, pronunciation, background noise, or technical limits.`;
  return {
    accuracy,
    totalWords: sourceWords.length,
    matchedWords,
    note,
    differences,
  };
}

export function readingProgressView(user) {
  const stored = user?.readingProgress || {};
  const recentResults = Array.isArray(stored.recentResults) ? stored.recentResults : [];
  const recentSessions = Array.isArray(stored.recentSessions) ? stored.recentSessions : [];
  const totalSeconds = Number(stored.totalSeconds) || (Number(stored.minutes) || 0) * 60;
  const totalQuestions = Number(stored.totalQuestions) || 0;
  const correctAnswers = Number(stored.correctAnswers) || 0;
  return {
    minutes: Math.floor(totalSeconds / 60),
    totalSeconds,
    sessions: Number(stored.sessions) || 0,
    words: Number(stored.words) || 0,
    quizzes: Number(stored.quizzes) || 0,
    correctAnswers,
    totalQuestions,
    averageComprehension: totalQuestions ? Math.round((correctAnswers / totalQuestions) * 100) : null,
    recentResults: recentResults.slice(-10).reverse(),
    recentSessions: recentSessions.slice(-10).reverse(),
    activeSession: stored.activeSession
      ? { id: stored.activeSession.id, startedAt: stored.activeSession.startedAt, source: stored.activeSession.source }
      : null,
  };
}
