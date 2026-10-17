/** Assessment configuration (sizes, labels, thresholds). Questions themselves always come from /datasets. */
export const CORE = {
  readingPassages: 3, // each passage = one "read" step + one comprehension question
  wordDifficultyCount: 6,
  secondsPerStep: 25, // used only for the "about N minutes left" estimate
  fastWpm: 150, // reference only; level changes are driven by comprehension correctness
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const MODES = ['adaptive', 'low', 'medium', 'high'];
export const MODE_TO_DIFFICULTY = { low: 'easy', medium: 'medium', high: 'hard' };

/** Colour dot names map to the design palette on the frontend. */
export const SECTION_META = {
  reading: { category: 'Reading flow', dot: 'yellow' },
  comprehension: { category: 'Comprehension', dot: 'yellow' },
  wordDifficulty: { category: 'Word difficulty', dot: 'teal' },
  focus: { category: 'Focus and comfort', dot: 'orange' },
  preferences: { category: 'Reading preferences', dot: 'dark' },
};

export const COGNITIVE = {
  perSection: 4,
  timeLimits: { easy: 20, medium: 25, hard: 30 },
  memorizeSeconds: { easy: 5, medium: 6, hard: 8 },
  sections: [
    { key: 'memoryRecall', title: 'Memory & Working Memory', categories: ['Memory', 'Working Memory'], dot: 'teal' },
    { key: 'patternRecognition', title: 'Pattern Recognition & Logical Reasoning', categories: ['Pattern Recognition', 'Logical Reasoning'], dot: 'yellow' },
    { key: 'sentenceCompletion', title: 'Language / Comprehension', categories: ['Language / Comprehension'], dot: 'orange' },
    { key: 'wordSequencing', title: 'Problem Solving (Word Order)', categories: ['Problem Solving', 'Attention'], dot: 'dark' },
  ],
};
