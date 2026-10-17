import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const vocabularyFile = path.join(projectRoot, 'extension', 'data', 'vocabulary.json');

/** Loads the independent extension word-help resource; it is not an assessment dataset. */
export function loadLocalVocabulary() {
  let vocabulary;
  try {
    vocabulary = JSON.parse(fs.readFileSync(vocabularyFile, 'utf8'));
  } catch (error) {
    throw new Error(`[vocabulary] Cannot parse "${vocabularyFile}": ${error.message}`, { cause: error });
  }
  if (!vocabulary || typeof vocabulary !== 'object' || Array.isArray(vocabulary)) {
    throw new Error(`[vocabulary] Expected an object in "${vocabularyFile}".`);
  }
  for (const [word, entry] of Object.entries(vocabulary)) {
    if (!word || !entry || typeof entry !== 'object' || typeof entry.simpleMeaning !== 'string') {
      throw new Error(`[vocabulary] Invalid entry for "${word || '(empty key)'}" in "${vocabularyFile}".`);
    }
  }
  return vocabulary;
}
