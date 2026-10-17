import fs from 'node:fs';
import path from 'node:path';
import { buildDatasets } from './datasetAdapter.js';

let cache = null;

/**
 * Reads the ORIGINAL dataset files from the datasets directory (never modifies them)
 * and normalises them through the adapter. Missing / malformed items are reported, not hidden.
 */
export function loadDatasets(dir) {
  const raw = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch {
    console.error(`[datasets] directory not found: ${dir}`);
  }
  for (const f of files) {
    try {
      raw[f] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      console.error(`[datasets] could not parse ${f}: ${e.message}`);
    }
  }
  return buildDatasets(raw);
}

export function getDatasets(dir) {
  if (!cache || cache.dir !== dir) cache = { dir, data: loadDatasets(dir) };
  return cache.data;
}

export const resetDatasetCache = () => {
  cache = null;
};
