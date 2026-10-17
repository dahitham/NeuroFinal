import { AppError, AI_UNAVAILABLE_MESSAGE } from '../utils/AppError.js';

export function createGeminiService(cfg, fetchImpl = (...a) => globalThis.fetch(...a)) {
  return {
    isConfigured: () => Boolean(cfg.apiKey),
    model: cfg.model,
    async chat(prompt, { maxTokens = 600, temperature = 0.2 } = {}) {
      if (!cfg.apiKey) throw new AppError(503, AI_UNAVAILABLE_MESSAGE, 'AI_NOT_CONFIGURED');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      let res;
      try {
        const model = encodeURIComponent(cfg.model);
        res = await fetchImpl(`${cfg.baseUrl}/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'x-goog-api-key': cfg.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens: maxTokens },
          }),
          signal: controller.signal,
        });
      } catch (e) {
        console.error('[gemini] network error:', e.name);
        throw new AppError(503, AI_UNAVAILABLE_MESSAGE, 'AI_NETWORK');
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        console.error('[gemini] HTTP', res.status);
        throw new AppError(res.status === 429 ? 429 : 503, AI_UNAVAILABLE_MESSAGE, 'AI_UPSTREAM_ERROR');
      }
      let data;
      try {
        data = await res.json();
      } catch {
        throw new AppError(502, AI_UNAVAILABLE_MESSAGE, 'AI_BAD_RESPONSE');
      }
      const parts = data?.candidates?.[0]?.content?.parts;
      const content = Array.isArray(parts) ? parts.map((part) => part.text || '').join('') : '';
      if (!content.trim()) throw new AppError(502, AI_UNAVAILABLE_MESSAGE, 'AI_EMPTY_RESPONSE');
      return content.trim();
    },
  };
}