#!/usr/bin/env node
/**
 * Verifies the independent extension word-help resource.
 * The new word-recognition assessment bank does not contain word definitions, so it is not
 * used to regenerate this file.
 */
import { loadLocalVocabulary } from '../backend/src/data/localVocabulary.js';

const vocabulary = loadLocalVocabulary();
console.log(`Verified ${Object.keys(vocabulary).length} local word-help entries; no files were rewritten.`);
