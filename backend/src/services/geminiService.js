import { AppError } from '../utils/AppError.js';

function upstreamFailure(status) {
  if (status === 401) {
    return new AppError(503, 'Gemini rejected the configured API key. Check GEMINI_API_KEY in backend/.env and restart the backend.', 'AI_AUTH');
  }
  if (status === 403) {
    return new AppError(503, 'Gemini denied access for this API key. Check that the key is valid and enabled for the Gemini API.', 'AI_PERMISSION');
  }
  if (status === 404) {
    return new AppError(503, 'The configured Gemini model or API endpoint was not found. Check GEMINI_MODEL and GEMINI_BASE_URL in backend/.env.', 'AI_MODEL_NOT_FOUND');
  }
  if (status === 429) {
    return new AppError(429, 'Gemini rate limit or quota reached. Please wait and try again, or check the quota for this API key.', 'AI_RATE_LIMIT');
  }
  if (status >= 500) {
    return new AppError(503, 'Google Gemini is temporarily unavailable. Please try again shortly.', 'AI_UPSTREAM_UNAVAILABLE');
  }
  return new AppError(502, 'Gemini rejected the request. Check the configured model and request format.', 'AI_REQUEST_REJECTED');
}

export function createGeminiService(cfg, fetchImpl = (...a) => globalThis.fetch(...a)) {
  return {
    isConfigured: () => Boolean(cfg.apiKey),
    model: cfg.model,
    async chat(prompt, { maxTokens = 600, temperature = 0.2 } = {}) {
      if (!cfg.apiKey) {
        console.warn('[gemini]', JSON.stringify({ stage: 'configuration_check', category: 'AI_NOT_CONFIGURED', configured: false }));
        throw new AppError(503, 'Gemini is not configured. Set GEMINI_API_KEY in backend/.env and restart the backend.', 'AI_NOT_CONFIGURED');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      const timeoutError = () => {
        console.warn('[gemini]', JSON.stringify({ stage: 'request_failed', category: 'AI_TIMEOUT', model: cfg.model }));
        return new AppError(504, 'The Gemini request timed out. Try again or use a shorter passage.', 'AI_TIMEOUT');
      };
      try {
        const model = encodeURIComponent(cfg.model);
        console.info('[gemini]', JSON.stringify({ stage: 'request_started', model: cfg.model }));
        let res;
        try {
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
          if (controller.signal.aborted || (e && e.name === 'AbortError')) throw timeoutError();
          console.error('[gemini]', JSON.stringify({ stage: 'request_failed', category: 'AI_NETWORK', errorName: e && e.name ? e.name : 'Error' }));
          throw new AppError(503, 'The backend could not connect to Google Gemini. Check the server network connection and try again.', 'AI_NETWORK');
        }
        if (!res.ok) {
          const error = upstreamFailure(res.status);
          console.warn('[gemini]', JSON.stringify({ stage: 'response_failed', category: error.code, httpStatus: res.status, model: cfg.model }));
          throw error;
        }
        let data;
        try {
          data = await res.json();
        } catch (e) {
          if (controller.signal.aborted || (e && e.name === 'AbortError')) throw timeoutError();
          console.warn('[gemini]', JSON.stringify({ stage: 'response_parse_failed', category: 'AI_BAD_RESPONSE', model: cfg.model }));
          throw new AppError(502, 'Gemini returned a response the backend could not read. Please retry.', 'AI_BAD_RESPONSE');
        }
        const parts = data?.candidates?.[0]?.content?.parts;
        const content = Array.isArray(parts) ? parts.map((part) => part.text || '').join('') : '';
        if (!content.trim()) {
          console.warn('[gemini]', JSON.stringify({ stage: 'response_empty', category: 'AI_EMPTY_RESPONSE', model: cfg.model }));
          throw new AppError(502, 'Gemini did not return generated text. Please retry with a different passage.', 'AI_EMPTY_RESPONSE');
        }
        console.info('[gemini]', JSON.stringify({ stage: 'response_received', model: cfg.model, responseCharacters: content.length }));
        return content.trim();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}