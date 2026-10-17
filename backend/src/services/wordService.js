import { extractJson, clampString } from '../utils/parse.js';
import { TtlCache } from '../utils/cache.js';
import { AppError, AI_UNAVAILABLE_MESSAGE } from '../utils/AppError.js';
import { wordPrompt } from './aiPrompts.js';

export const normalizeWord = (w) => String(w || '').trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').toLowerCase();

/**
 * Word assistance is LOCAL FIRST: the vocabulary built from datasets/Word_Difficulty_Test.json is searched
 * before any AI call. Only unknown words go to Gemini, and identical requests are cached.
 */
export function createWordService({ vocabulary, ai }) {
  const cache = new TtlCache();
  const lookupLocal = (word) => {
    const hit = vocabulary[word] || (word.endsWith('s') ? vocabulary[word.slice(0, -1)] : null);
    return hit ? { ...hit, source: 'local' } : null;
  };
  return {
    lookupLocal,
    async assist(rawWord, context = '') {
      const word = normalizeWord(rawWord);
      if (!word || word.length > 40 || !/^[\p{L}][\p{L}'’-]*$/u.test(word)) throw new AppError(400, 'Please enter a single word.', 'VALIDATION');
      const local = lookupLocal(word);
      if (local) return { word, ...local };
      const hit = cache.get(word);
      if (hit) return { word, ...hit };
      const parsed = extractJson(await ai.chat(wordPrompt(word, context), { maxTokens: 300 }));
      if (!parsed || !parsed.simpleMeaning) throw new AppError(502, AI_UNAVAILABLE_MESSAGE, 'AI_BAD_RESPONSE');
      const result = {
        simpleMeaning: clampString(parsed.simpleMeaning, 300),
        synonym: clampString(parsed.synonym, 60) || null,
        pronunciation: clampString(parsed.pronunciation, 60) || null,
        visualHint: clampString(parsed.visualHint, 300) || null,
        source: 'ai',
      };
      cache.set(word, result);
      return { word, ...result };
    },
  };
}
