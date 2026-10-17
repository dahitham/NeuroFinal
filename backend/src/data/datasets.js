import fs from 'node:fs';
import path from 'node:path';
import { buildDatasets, isNeuroSyncDatasetFile } from './datasetAdapter.js';
import { loadLocalVocabulary } from './localVocabulary.js';

export const REQUIRED_DATASET_FILES = [
  'neurosync_attention_to_detail.json',
  'neurosync_comprehension.json',
  'neurosync_sentence_understanding.json',
  'neurosync_sequencing.json',
  'neurosync_word_recognition.json',
];

let cache = null;

/** Loads only the supplied neurosync_*.json assessment banks; legacy JSON files are never a fallback. */
export function loadDatasets(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter(isNeuroSyncDatasetFile);
  } catch (error) {
    throw new Error(`[datasets] Cannot read dataset directory "${dir}": ${error.message}`, { cause: error });
  }

  const missing = REQUIRED_DATASET_FILES.filter((file) => !files.includes(file));
  if (missing.length) {
    throw new Error(`[datasets] Missing required assessment dataset file(s) in "${dir}": ${missing.join(', ')}`);
  }

  const raw = {};
  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      raw[file] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (error) {
      throw new Error(`[datasets] Cannot parse "${fullPath}": ${error.message}`, { cause: error });
    }
  }

  const datasets = buildDatasets(raw);
  return { ...datasets, vocabulary: loadLocalVocabulary() };
}

export function getDatasets(dir) {
  if (!cache || cache.dir !== dir) cache = { dir, data: loadDatasets(dir) };
  return cache.data;
}

export const resetDatasetCache = () => {
  cache = null;
};
