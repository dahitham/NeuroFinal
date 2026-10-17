/** Extracts the first JSON object from a model reply (handles ```json fences and chatter). */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Turns "- bullet" style model output into a clean array of bullets. */
export function parseBullets(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 6);
}

export const clampString = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
