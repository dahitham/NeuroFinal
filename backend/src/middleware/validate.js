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
      const type = rule.type || 'string';
      if (type === 'string') {
        if (typeof v !== 'string') return next(new AppError(400, `"${field}" must be text.`, 'VALIDATION'));
        v = v.trim();
        if (rule.min !== undefined && v.length < rule.min) return next(new AppError(400, `"${field}" must be at least ${rule.min} characters.`, 'VALIDATION'));
        if (rule.max !== undefined && v.length > rule.max) return next(new AppError(400, `"${field}" must be at most ${rule.max} characters.`, 'VALIDATION'));
        if (rule.pattern && !rule.pattern.test(v)) return next(new AppError(400, rule.patternMessage || `"${field}" is not valid.`, 'VALIDATION'));
      } else if (type === 'number') {
        if (typeof v !== 'number' || !Number.isFinite(v)) return next(new AppError(400, `"${field}" must be a number.`, 'VALIDATION'));
        if (rule.integer && !Number.isInteger(v)) return next(new AppError(400, `"${field}" must be a whole number.`, 'VALIDATION'));
        if (rule.min !== undefined && v < rule.min) return next(new AppError(400, `"${field}" must be at least ${rule.min}.`, 'VALIDATION'));
        if (rule.max !== undefined && v > rule.max) return next(new AppError(400, `"${field}" must be at most ${rule.max}.`, 'VALIDATION'));
      } else if (type === 'boolean') {
        if (typeof v !== 'boolean') return next(new AppError(400, `"${field}" must be true or false.`, 'VALIDATION'));
      } else if (type === 'object') {
        if (typeof v !== 'object' || Array.isArray(v)) return next(new AppError(400, `"${field}" must be an object.`, 'VALIDATION'));
      } else {
        return next(new AppError(500, `Validation schema for "${field}" is invalid.`, 'VALIDATION_SCHEMA'));
      }
      clean[field] = v;
    }
    req.valid = clean;
    next();
  };
}
