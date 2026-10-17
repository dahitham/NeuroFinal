import { classifyAssistance } from './personalizationService.js';

/**
 * Recommended Assistance Level scoring (0–14).
 * A project heuristic for choosing comfortable reading settings – NOT a clinically validated test
 * and NOT a diagnosis of dyslexia or any other condition.
 *
 *   Reading speed   0–3  (average words per minute over valid passages)
 *   Comprehension   0–3  (accuracy on questions about those passages)
 *   Word difficulty 0–3  (vocabulary-in-context accuracy)
 *   Focus / comfort 0–5  (self-report, normalised from each answer's score_impact)
 */
export const MAX_SCORE = 14;
export const WPM_VALID_MAX = 600; // faster than this means the passage was skipped, not read

export const readingSpeedPoints = (wpm) => (wpm >= 200 ? 0 : wpm >= 150 ? 1 : wpm >= 100 ? 2 : 3);
export const accuracyPoints = (percent) => (percent >= 80 ? 0 : percent >= 60 ? 1 : percent >= 40 ? 2 : 3);

export function averageValidWpm(rounds = []) {
  const valid = rounds.filter((r) => r.seconds >= 1 && r.wpm > 0 && r.wpm <= WPM_VALID_MAX);
  return valid.length ? Math.round(valid.reduce((s, r) => s + r.wpm, 0) / valid.length) : null;
}

export function focusPoints(answers = []) {
  const max = answers.reduce((s, a) => s + a.maxImpact, 0);
  if (!max) return 0;
  return Math.min(5, Math.round((answers.reduce((s, a) => s + a.scoreImpact, 0) / max) * 5));
}

export const wordsPerMinute = (wordCount, seconds) => (seconds > 0 ? Math.round((wordCount / seconds) * 60) : 0);

export function summarizeResults(results) {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  return { total, correct, percent: total ? Math.round((correct / total) * 100) : 0 };
}

export function calculateAssessmentScore({ reading, comprehension, wordDifficulty, focus } = {}) {
  const missing = [];
  const avgWpm = reading ? averageValidWpm(reading.rounds) : null;
  if (avgWpm == null) missing.push('reading');
  if (!comprehension || !comprehension.total) missing.push('comprehension');
  if (!wordDifficulty || !wordDifficulty.total) missing.push('wordDifficulty');
  if (!focus || !focus.answers || !focus.answers.length) missing.push('focus');

  const components = {
    readingSpeed: { points: avgWpm == null ? 0 : readingSpeedPoints(avgWpm), max: 3, detail: avgWpm == null ? null : `${avgWpm} words per minute` },
    comprehension: { points: comprehension && comprehension.total ? accuracyPoints(comprehension.percent) : 0, max: 3, detail: comprehension && comprehension.total ? `${comprehension.correct} of ${comprehension.total} correct` : null },
    wordDifficulty: { points: wordDifficulty && wordDifficulty.total ? accuracyPoints(wordDifficulty.percent) : 0, max: 3, detail: wordDifficulty && wordDifficulty.total ? `${wordDifficulty.correct} of ${wordDifficulty.total} correct` : null },
    focus: { points: focus && focus.answers ? focusPoints(focus.answers) : 0, max: 5, detail: focus && focus.answers && focus.answers.length ? `${focus.answers.reduce((s, a) => s + a.scoreImpact, 0)} self-report points` : null },
  };
  const total = Math.min(MAX_SCORE, Object.values(components).reduce((s, c) => s + c.points, 0));
  const { level, label, classification } = classifyAssistance(total);
  return { total, max: MAX_SCORE, level, label, classification, components, complete: missing.length === 0, missing };
}
