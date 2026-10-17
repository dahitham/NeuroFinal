import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDatasets } from '../src/data/datasetAdapter.js';
import { loadDatasets, REQUIRED_DATASET_FILES } from '../src/data/datasets.js';

const datasetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../datasets');
const sourceFiles = REQUIRED_DATASET_FILES;

function readSources() {
  return Object.fromEntries(sourceFiles.map((file) => [file, JSON.parse(fs.readFileSync(path.join(datasetsDir, file), 'utf8'))]));
}

test('all actual question records load once with their source categories and schemas', () => {
  const sources = readSources();
  const loaded = loadDatasets(datasetsDir);
  const expectedCounts = {};
  for (const raw of Object.values(sources)) {
    for (const question of raw.questions) expectedCounts[question.category] = (expectedCounts[question.category] || 0) + 1;
  }
  assert.deepEqual(loaded.report.loaded, expectedCounts);
  assert.deepEqual(loaded.report.missing, []);
  assert.deepEqual(loaded.report.skipped, {});
  assert.equal(Object.values(loaded.categories).flat().length, Object.values(sources).reduce((total, raw) => total + raw.questions.length, 0));
  assert.equal(new Set(Object.values(loaded.categories).flat().map((question) => question.uid)).size, Object.values(loaded.categories).flat().length);
  for (const [category, questions] of Object.entries(loaded.categories)) {
    for (const question of questions) {
      assert.equal(question.category, category);
      assert.ok(question.options.some((option) => option.id === question.correctAnswer));
      assert.ok(question.options.every((option) => typeof option.id === 'string' && typeof option.text === 'string'));
    }
  }
});

test('invalid answer references identify the exact source file and record ID', () => {
  const sources = readSources();
  sources['neurosync_attention_to_detail.json'].questions[0].correctAnswer = 'missing-option';
  assert.throws(
    () => buildDatasets(sources),
    /\[datasets\] Validation failed:[\s\S]*neurosync_attention_to_detail\.json › AD001: "correctAnswer" must reference an option ID/
  );
});

test('duplicate record IDs across category files are rejected', () => {
  const sources = readSources();
  sources['neurosync_comprehension.json'].questions[0].id = sources['neurosync_attention_to_detail.json'].questions[0].id;
  assert.throws(() => buildDatasets(sources), /neurosync_comprehension\.json › AD001: ID is duplicated; first seen at neurosync_attention_to_detail\.json row 1/);
});

test('duplicate question content is rejected even when record IDs differ', () => {
  const sources = readSources();
  const first = sources['neurosync_attention_to_detail.json'].questions[0];
  sources['neurosync_attention_to_detail.json'].questions[1] = { ...first, id: 'AD-DUPLICATE' };
  assert.throws(() => buildDatasets(sources), /neurosync_attention_to_detail\.json › AD-DUPLICATE: duplicate question content; first seen at neurosync_attention_to_detail\.json row 1/);
});

test('missing and malformed datasets fail clearly instead of falling back to legacy JSON', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosync-datasets-'));
  try {
    assert.throws(() => loadDatasets(emptyDir), /Missing required assessment dataset file/);
    for (const file of sourceFiles) fs.copyFileSync(path.join(datasetsDir, file), path.join(emptyDir, file));
    fs.writeFileSync(path.join(emptyDir, sourceFiles[0]), '{ invalid JSON');
    assert.throws(() => loadDatasets(emptyDir), /Cannot parse .*neurosync_attention_to_detail\.json/);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('empty question banks are rejected explicitly', () => {
  const sources = readSources();
  sources['neurosync_attention_to_detail.json'].questions = [];
  assert.throws(() => buildDatasets(sources), /neurosync_attention_to_detail\.json › root: "questions" must not be empty/);
});
