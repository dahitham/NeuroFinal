import { AppError } from '../utils/AppError.js';

/** Fixed-window in-memory rate limiter keyed by IP (good enough for a single-node prototype). */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const entry = hits.get(key);
    if (!entry || entry.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
    else if (++entry.count > max) return next(new AppError(429, message || 'Too many requests. Please slow down.', 'RATE_LIMITED'));
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
