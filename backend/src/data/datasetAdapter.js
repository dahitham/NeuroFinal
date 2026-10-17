const NEW_DATASET_FILE = /^neurosync_[a-z0-9_]+\.json$/i;
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const REQUIRED_FIELDS = ['id', 'category', 'difficulty', 'skill', 'questionType', 'question', 'options', 'correctAnswer', 'explanation'];

export const isNeuroSyncDatasetFile = (name) => NEW_DATASET_FILE.test(name);

const categoryFromFile = (name) =>
  name.replace(/^neurosync_/i, '').replace(/\.json$/i, '').toLowerCase();

function validationError(file, record, message) {
  return `${file} › ${record}: ${message}`;
}

function validateQuestion(question, file, row, expectedCategory) {
  const issues = [];
  const record = question && typeof question.id === 'string' && question.id ? question.id : `row ${row}`;
  if (!question || typeof question !== 'object' || Array.isArray(question)) {
    return [validationError(file, record, 'record must be an object')];
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in question)) issues.push(validationError(file, record, `missing required field "${field}"`));
  }
  if (typeof question.id !== 'string' || !question.id.trim()) issues.push(validationError(file, record, '"id" must be a non-empty string'));
  if (typeof question.category !== 'string' || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(question.category)) {
    issues.push(validationError(file, record, '"category" must be a lowercase underscore-separated string'));
  } else if (question.category !== expectedCategory) {
    issues.push(validationError(file, record, `"category" must match filename category "${expectedCategory}"`));
  }
  if (!DIFFICULTIES.has(question.difficulty)) issues.push(validationError(file, record, '"difficulty" must be easy, medium, or hard'));
  if (typeof question.skill !== 'string' || !question.skill.trim()) issues.push(validationError(file, record, '"skill" must be a non-empty string'));
  if (question.questionType !== 'multiple_choice') issues.push(validationError(file, record, '"questionType" must be "multiple_choice"'));
  if (typeof question.question !== 'string' || !question.question.trim()) issues.push(validationError(file, record, '"question" must be a non-empty string'));
  if (typeof question.explanation !== 'string' || !question.explanation.trim()) issues.push(validationError(file, record, '"explanation" must be a non-empty string'));

  if (!Array.isArray(question.options) || question.options.length < 2) {
    issues.push(validationError(file, record, '"options" must contain at least two options'));
  } else {
    const optionIds = new Set();
    question.options.forEach((option, index) => {
      if (!option || typeof option !== 'object' || Array.isArray(option)) {
        issues.push(validationError(file, record, `option ${index + 1} must be an object with "id" and "text"`));
        return;
      }
      if (typeof option.id !== 'string' || !option.id.trim()) {
        issues.push(validationError(file, record, `option ${index + 1} "id" must be a non-empty string`));
      } else if (optionIds.has(option.id)) {
        issues.push(validationError(file, record, `option ID "${option.id}" is duplicated`));
      } else {
        optionIds.add(option.id);
      }
      if (typeof option.text !== 'string' || !option.text.trim()) {
        issues.push(validationError(file, record, `option ${index + 1} "text" must be a non-empty string`));
      }
    });
    if (typeof question.correctAnswer !== 'string' || !optionIds.has(question.correctAnswer)) {
      issues.push(validationError(file, record, '"correctAnswer" must reference an option ID'));
    }
  }

  return issues;
}

/**
 * Convert the supplied per-category question files into an internal category map.
 * Original records are not mutated, and all validation failures are reported together.
 */
export function buildDatasets(rawByFile) {
  const categories = {};
  const report = { loaded: {}, missing: [], skipped: {} };
  const ids = new Map();
  const recordSignatures = new Map();
  const errors = [];
  let filesSeen = 0;

  for (const [file, raw] of Object.entries(rawByFile || {})) {
    if (!isNeuroSyncDatasetFile(file)) continue;
    filesSeen += 1;
    const expectedCategory = categoryFromFile(file);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(validationError(file, 'root', 'expected a JSON object with a "questions" array'));
      continue;
    }
    if (typeof raw.project !== 'string' || !raw.project.trim()) errors.push(validationError(file, 'root', '"project" must be a non-empty string'));
    if (typeof raw.datasetVersion !== 'string' || !raw.datasetVersion.trim()) errors.push(validationError(file, 'root', '"datasetVersion" must be a non-empty string'));
    if (typeof raw.purpose !== 'string' || !raw.purpose.trim()) errors.push(validationError(file, 'root', '"purpose" must be a non-empty string'));
    if (!Number.isInteger(raw.totalQuestions) || raw.totalQuestions < 1) errors.push(validationError(file, 'root', '"totalQuestions" must be a positive integer'));
    if (!raw.categoryCounts || typeof raw.categoryCounts !== 'object' || Array.isArray(raw.categoryCounts)) {
      errors.push(validationError(file, 'root', '"categoryCounts" must be an object of category-to-count values'));
    } else {
      for (const [name, count] of Object.entries(raw.categoryCounts)) {
        if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name) || !Number.isInteger(count) || count < 1) {
          errors.push(validationError(file, 'root', `"categoryCounts" has an invalid entry for "${name}"`));
        }
      }
    }
    if (!Array.isArray(raw.questions)) {
      errors.push(validationError(file, 'root', '"questions" must be an array'));
      continue;
    }
    if (raw.questions.length === 0) {
      errors.push(validationError(file, 'root', '"questions" must not be empty'));
      continue;
    }
    if (Object.hasOwn(categories, expectedCategory)) {
      errors.push(validationError(file, 'root', `duplicate category "${expectedCategory}" is already provided by another file`));
      continue;
    }

    const items = [];
    raw.questions.forEach((question, index) => {
      const row = index + 1;
      const questionIssues = validateQuestion(question, file, row, expectedCategory);
      if (question && typeof question.id === 'string' && question.id) {
        if (ids.has(question.id)) questionIssues.push(validationError(file, question.id, `ID is duplicated; first seen at ${ids.get(question.id)}`));
        else ids.set(question.id, `${file} row ${row}`);
      }
      if (question && typeof question === 'object' && !Array.isArray(question)) {
        const signature = JSON.stringify({
          category: question.category,
          difficulty: question.difficulty,
          skill: question.skill,
          questionType: question.questionType,
          question: question.question,
          options: question.options,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
        });
        if (recordSignatures.has(signature)) {
          const recordId = question.id || `row ${row}`;
          questionIssues.push(validationError(file, recordId, `duplicate question content; first seen at ${recordSignatures.get(signature)}`));
        } else {
          recordSignatures.set(signature, `${file} row ${row}`);
        }
      }
      errors.push(...questionIssues);
      if (questionIssues.length) return;
      items.push({
        ...question,
        uid: `${expectedCategory}:${question.id}`,
        id: question.id,
        category: question.category,
        difficulty: question.difficulty,
        skill: question.skill,
        questionType: question.questionType,
        question: question.question,
        options: question.options.map(({ id, text }) => ({ id, text })),
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
      });
    });
    categories[expectedCategory] = items;
    report.loaded[expectedCategory] = items.length;
  }

  if (!filesSeen) errors.push('No neurosync_*.json dataset files were found; refusing to load legacy assessment datasets.');
  const actualCounts = Object.fromEntries(Object.entries(categories).map(([category, items]) => [category, items.length]));
  const actualTotal = Object.values(actualCounts).reduce((total, count) => total + count, 0);
  for (const [file, raw] of Object.entries(rawByFile || {})) {
    if (!isNeuroSyncDatasetFile(file) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    if (Number.isInteger(raw.totalQuestions) && raw.totalQuestions !== actualTotal) {
      errors.push(validationError(file, 'root', `"totalQuestions" declares ${raw.totalQuestions}, but ${actualTotal} records were loaded from the supplied banks`));
    }
    if (raw.categoryCounts && typeof raw.categoryCounts === 'object' && !Array.isArray(raw.categoryCounts)) {
      for (const [category, count] of Object.entries({ ...actualCounts, ...raw.categoryCounts })) {
        if (actualCounts[category] !== count) {
          errors.push(validationError(file, 'root', `"categoryCounts.${category}" declares ${count}, but ${actualCounts[category] || 0} records were loaded`));
        }
      }
    }
  }
  if (errors.length) throw new Error(`[datasets] Validation failed:\n- ${errors.join('\n- ')}`);

  return {
    categories,
    vocabulary: {},
    report,
  };
}
