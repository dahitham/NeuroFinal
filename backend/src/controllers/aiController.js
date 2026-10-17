import { simplifyPrompt, summarizePrompt } from '../services/aiPrompts.js';
import { parseBullets } from '../utils/parse.js';
import { TtlCache } from '../utils/cache.js';
import { AppError, AI_UNAVAILABLE_MESSAGE } from '../utils/AppError.js';

export function createAiController({ ai, words }) {
  const cache = new TtlCache();
  const cached = async (key, produce) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const v = await produce();
    cache.set(key, v);
    return v;
  };
  return {
    async simplify(req, res) {
      const { text } = req.valid;
      res.json(await cached(`s:${text}`, async () => ({ simplified: await ai.chat(simplifyPrompt(text), { maxTokens: 900 }) })));
    },
    async summarize(req, res) {
      const { text } = req.valid;
      res.json(
        await cached(`m:${text}`, async () => {
          const bullets = parseBullets(await ai.chat(summarizePrompt(text), { maxTokens: 500 }));
          if (!bullets.length) throw new AppError(502, AI_UNAVAILABLE_MESSAGE, 'AI_EMPTY_RESPONSE');
          return { summary: bullets.join(' '), bullets };
        })
      );
    },
    async wordAssistance(req, res) {
      res.json(await words.assist(req.valid.word, req.valid.context || ''));
    },
  };
}
