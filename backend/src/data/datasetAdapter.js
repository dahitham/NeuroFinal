/**
 * Dataset adapter layer (server side).
 * The ORIGINAL JSON files in /datasets are never modified. This module only normalises
 * their different shapes into one internal format:
 *   { uid, id, module, difficulty, question, options, correctAnswer, ...extras }
 * Item uids are namespaced by module because two datasets reuse the id "SC-E-01"
 * (Sentence Completion and Speed & Comprehension).
 */

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const DIFFICULTY_LABEL = { easy: 'LOW', medium: 'MEDIUM', hard: 'HIGH' };

const FILE_KEYS = {
  speedandcomprehension: 'readingPassages',
  worddifficultytest: 'wordDifficulty',
  focustest: 'focus',
  readingpreferencefontpreference: 'preferences',
  memoryrecall: 'memoryRecall',
  patternrecognition: 'patternRecognition',
  sentencecompletion: 'sentenceCompletion',
  wordsequencing: 'wordSequencing',
};

export const normalizeFileName = (name) =>
  String(name).replace(/^.*[\\/]/, '').replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function normalizeDifficulty(d) {
  const v = String(d || '').toLowerCase();
  if (v === 'low' || v === 'easy') return 'easy';
  if (v === 'high' || v === 'hard') return 'hard';
  if (v === 'medium' || v === 'mid') return 'medium';
  return null;
}

const itemsOf = (raw) => (Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : []);

/** An item is usable only if it has a question, ≥2 string options and a correct answer that is one of them. */
function validMcq(raw) {
  return (
    raw &&
    typeof raw.id === 'string' &&
    (typeof raw.question === 'string' || typeof raw.target_word === 'string') &&
    Array.isArray(raw.options) &&
    raw.options.length >= 2 &&
    raw.options.every((o) => typeof o === 'string') &&
    raw.options.includes(raw.correct_answer) &&
    normalizeDifficulty(raw.difficulty)
  );
}

/**
 * Memory Recall questions embed the fact in the question ("Fact: … What is …?").
 * Split them so the UI can show the fact first, hide it, then ask the question.
 * Falls back to showing everything at once if the pattern is not recognised.
 */
export function splitMemoryItem(question) {
  const m = /^Fact:\s*([\s\S]*\.)\s+([^.]*\?)\s*$/.exec(question);
  return m ? { fact: m[1].trim(), prompt: m[2].trim() } : { fact: null, prompt: question };
}

function mcqModule(raw, moduleKey, extra = () => ({})) {
  const items = [];
  const skipped = [];
  itemsOf(raw).forEach((r) => {
    if (!validMcq(r)) return skipped.push(r && r.id ? r.id : '(unknown)');
    items.push({
      uid: `${moduleKey}:${r.id}`,
      id: r.id,
      module: moduleKey,
      difficulty: normalizeDifficulty(r.difficulty),
      // Word Difficulty items have no `question` field – derive the prompt from target_word
      question: typeof r.question === 'string' ? r.question : `What does “${r.target_word}” mean in this sentence?`,
      options: [...r.options],
      correctAnswer: r.correct_answer,
      ...extra(r),
    });
  });
  return { items, skipped };
}

export function buildVocabulary(wordItems) {
  const vocab = {};
  wordItems.forEach((w) => {
    const key = w.targetWord.toLowerCase();
    if (vocab[key]) return;
    vocab[key] = {
      simpleMeaning: `Means about the same as “${w.correctAnswer}”.`,
      synonym: w.correctAnswer,
      pronunciation: null,
      visualHint: w.contextSentence,
    };
  });
  return vocab;
}

/**
 * @param {Record<string, any>} rawByFile  parsed JSON keyed by file name (any of the original names)
 */
export function buildDatasets(rawByFile) {
  const byKey = {};
  Object.entries(rawByFile || {}).forEach(([file, raw]) => {
    const key = FILE_KEYS[normalizeFileName(file)];
    if (key) byKey[key] = raw;
  });

  const report = { loaded: {}, missing: [], skipped: {} };
  const out = {};

  const mark = (key, res) => {
    out[key] = res.items;
    report.loaded[key] = res.items.length;
    if (res.skipped.length) report.skipped[key] = res.skipped;
  };

  Object.values(FILE_KEYS).forEach((k) => {
    if (!byKey[k]) {
      report.missing.push(k);
      out[k] = k === 'focus' || k === 'preferences' ? { items: [] } : [];
    }
  });

  if (byKey.readingPassages) {
    mark(
      'readingPassages',
      mcqModule(byKey.readingPassages, 'speed_and_comprehension', (r) => ({
        passage: String(r.passage || ''),
        wordCount: Number(r.word_count) || String(r.passage || '').trim().split(/\s+/).length,
      }))
    );
    out.readingPassages = out.readingPassages.filter((p) => p.passage);
  }
  if (byKey.wordDifficulty)
    mark('wordDifficulty', mcqModule(byKey.wordDifficulty, 'word_difficulty', (r) => ({ targetWord: r.target_word, contextSentence: r.context_sentence })));
  if (byKey.memoryRecall) {
    mark('memoryRecall', mcqModule(byKey.memoryRecall, 'memory_recall', (r) => splitMemoryItem(r.question)));
  }
  if (byKey.patternRecognition) mark('patternRecognition', mcqModule(byKey.patternRecognition, 'pattern_recognition'));
  if (byKey.sentenceCompletion) mark('sentenceCompletion', mcqModule(byKey.sentenceCompletion, 'sentence_completion'));
  if (byKey.wordSequencing) mark('wordSequencing', mcqModule(byKey.wordSequencing, 'word_sequencing'));

  if (byKey.focus) {
    const items = itemsOf(byKey.focus)
      .filter((f) => f && f.id && f.question && Array.isArray(f.options) && f.options.length)
      .map((f) => ({
        uid: `focus:${f.id}`,
        id: f.id,
        trigger: f.trigger,
        question: f.question,
        options: f.options.map((o) => ({ text: o.text, scoreImpact: Number(o.score_impact) || 0 })),
        maxImpact: Math.max(...f.options.map((o) => Number(o.score_impact) || 0)),
      }));
    out.focus = { items };
    report.loaded.focus = items.length;
  }
  if (byKey.preferences) {
    const items = itemsOf(byKey.preferences).map((p) => ({
      uid: `pref:${p.id}`,
      id: p.id,
      category: p.test_category,
      options: p.ui_options || [],
      text: p.test_text || null,
      textOriginal: p.test_text_original || null,
      textSimplified: p.test_text_simplified || null,
    }));
    out.preferences = { items };
    report.loaded.preferences = items.length;
  }

  out.vocabulary = buildVocabulary(out.wordDifficulty || []);
  out.report = report;
  return out;
}
