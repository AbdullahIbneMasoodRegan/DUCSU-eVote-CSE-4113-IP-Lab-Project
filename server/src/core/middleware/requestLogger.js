// M1 — access log. Logs method, path, status and duration only.
// Secrecy rule 4: request bodies are never logged, and for /api/vote and
// /api/receipts only the route prefix is logged (a receipt code in the URL
// must never reach the logs). Query strings are always dropped.
import logger from '../logger.js';

const SENSITIVE_PREFIXES = ['/api/vote', '/api/receipts'];

const sensitivePrefix = (path) =>
  SENSITIVE_PREFIXES.find((p) => path === p || path.startsWith(p + '/'));

export const isSensitivePath = (originalUrl) => Boolean(sensitivePrefix(originalUrl.split('?')[0]));

export function safePath(originalUrl) {
  const path = originalUrl.split('?')[0];
  return sensitivePrefix(path) ?? path;
}

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      method: req.method,
      path: safePath(req.originalUrl),
      status: res.statusCode,
      ms: Math.round(ms),
    });
  });
  next();
}

export default requestLogger;
