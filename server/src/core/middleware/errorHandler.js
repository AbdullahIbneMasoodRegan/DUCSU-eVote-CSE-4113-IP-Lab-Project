// M1 — turns every thrown error into { error: { code, message } }.
import { AppError } from '../errors.js';
import logger from '../logger.js';
import { safePath, isSensitivePath } from './requestLogger.js';

export function apiNotFound(req, res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', 'No such API route.'));
}

// Express recognises an error handler by its four parameters, so keep `next`.
export function errorHandler(err, req, res, next) {
  // Malformed JSON / body too large from express.json()
  if (err?.type === 'entity.parse.failed') {
    err = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  } else if (err?.type === 'entity.too.large') {
    err = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  }

  if (err instanceof AppError) {
    const body = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }

  // Unexpected error: log it (never the request body) and hide details.
  // On secret-bearing routes, database error messages can echo values
  // (e.g. "Key (code)=(DU-...) already exists"), so log only the error code.
  logger.error('unhandled error', {
    method: req.method,
    path: safePath(req.originalUrl),
    ...(isSensitivePath(req.originalUrl)
      ? { code: err?.code ?? err?.name ?? 'UNKNOWN' }
      : { error: err?.message, stack: err?.stack }),
  });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  });
}
