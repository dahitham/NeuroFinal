/** Assessment configuration (sizes, labels, thresholds). Questions themselves always come from /datasets. */
export const CORE = {
  questionsPerCategory: 4,
  secondsPerStep: 25, // used only for the "about N minutes left" estimate
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const MODES = ['adaptive', 'low', 'medium', 'high'];
export const MODE_TO_DIFFICULTY = { low: 'easy', medium: 'medium', high: 'hard' };

export const COGNITIVE = {
  perSection: 4,
  timeLimits: { easy: 20, medium: 25, hard: 30 },
};
