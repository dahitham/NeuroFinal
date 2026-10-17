import { AppError } from '../utils/AppError.js';

/** Validates req.body fields: { field: { type:'string', min, max, required, pattern } } */
export function validateBody(schema) {
  return (req, _res, next) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return next(new AppError(400, 'A JSON body is required.', 'BAD_REQUEST'));
    const clean = {};
    for (const [field, rule] of Object.entries(schema)) {
      let v = body[field];
      if (v === undefined || v === null || v === '') {
        if (rule.required) return next(new AppError(400, `"${field}" is required.`, 'VALIDATION'));
        continue;
      }
      if (typeof v !== 'string') return next(new AppError(400, `"${field}" must be text.`, 'VALIDATION'));
      v = v.trim();
      if (rule.min && v.length < rule.min) return next(new AppError(400, `"${field}" must be at least ${rule.min} characters.`, 'VALIDATION'));
      if (rule.max && v.length > rule.max) return next(new AppError(400, `"${field}" must be at most ${rule.max} characters.`, 'VALIDATION'));
      if (rule.pattern && !rule.pattern.test(v)) return next(new AppError(400, rule.patternMessage || `"${field}" is not valid.`, 'VALIDATION'));
      clean[field] = v;
    }
    req.valid = clean;
    next();
  };
}
