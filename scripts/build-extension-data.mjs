#!/usr/bin/env node
/**
 * Generates extension/data/vocabulary.json from datasets/Word_Difficulty_Test.json using the SAME
 * adapter the backend uses. The original dataset is only read, never modified.
 *   node scripts/build-extension-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatasets } from '../backend/src/data/datasets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { vocabulary } = loadDatasets(path.join(root, 'datasets'));
const out = path.join(root, 'extension', 'data', 'vocabulary.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(vocabulary, null, 1) + '\n');
console.log(`Wrote ${Object.keys(vocabulary).length} words to ${path.relative(root, out)}`);
