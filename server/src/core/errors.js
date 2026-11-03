// M1 — one error type for the whole API.
// Response shape: { "error": { "code": "ALREADY_VOTED", "message": "..." } }
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Please log in.') =>
  new AppError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this.') =>
  new AppError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'Not found.') =>
  new AppError(404, code, message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const tooMany = (code, message, details) => new AppError(429, code, message, details);
