import { AppError } from '../utils/AppError.js';

export function notFound(_req, _res, next) {
  next(new AppError(404, 'This endpoint does not exist.', 'NOT_FOUND'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err && err.type === 'entity.parse.failed') err = new AppError(400, 'The request body is not valid JSON.', 'BAD_JSON');
  if (err && err.type === 'entity.too.large') err = new AppError(413, 'The request is too large.', 'TOO_LARGE');
  const known = err instanceof AppError;
  if (!known) console.error('[unhandled]', err && err.message); // message only – never the stack or request bodies
  res.status(known ? err.status : 500).json({
    error: {
      code: known ? err.code : 'INTERNAL_ERROR',
      message: known ? err.message : 'Something went wrong on our side. Please try again.',
      ...(known && err.details ? { details: err.details } : {}),
    },
  });
}
