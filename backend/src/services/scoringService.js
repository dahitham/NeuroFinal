import { classifyAssistance } from './personalizationService.js';

/**
 * A deterministic personalization heuristic based on the supplied question banks.
 * The score is not clinically validated and does not diagnose dyslexia.
 */
export const MAX_SCORE = 14;

export function summarizeResults(results = []) {
  const total = results.length;
  const correct = results.filter((result) => result.correct).length;
  return { total, correct, percent: total ? Math.round((correct / total) * 100) : 0 };
}

export function calculateAssessmentScore(categories = []) {
  const rows = Array.isArray(categories) ? categories : [];
  const valid = rows.filter((category) => category && Number.isInteger(category.total) && category.total > 0 && Number.isInteger(category.correct) && category.correct >= 0 && category.correct <= category.total);
  const totalQuestions = valid.reduce((sum, category) => sum + category.total, 0);
  const correctAnswers = valid.reduce((sum, category) => sum + category.correct, 0);
  const total = totalQuestions ? Math.round(((totalQuestions - correctAnswers) / totalQuestions) * MAX_SCORE) : 0;
  const missing = rows
    .filter((category) => !category || !Number.isInteger(category.total) || category.total <= 0)
    .map((category) => category && category.key)
    .filter(Boolean);
  const { level, label, classification } = classifyAssistance(total);
  return {
    total,
    max: MAX_SCORE,
    level,
    label,
    classification,
    components: {
      questionAccuracy: {
        points: total,
        max: MAX_SCORE,
        detail: totalQuestions ? `${correctAnswers} of ${totalQuestions} correct` : null,
      },
    },
    complete: Array.isArray(categories) && valid.length > 0 && missing.length === 0 && valid.length === rows.length,
    missing,
  };
}
