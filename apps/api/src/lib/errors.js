/**
 * One error class for everything the API deliberately rejects.
 * Anything that is NOT an AppError is treated as a bug and never leaks its
 * message to the client.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code machine-readable code, e.g. INVALID_CREDENTIALS
   * @param {string} message human-readable, safe to show a user
   * @param {object} [details] optional structured detail (field errors etc.)
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg = 'Bad request', details) =>
  new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'You need to sign in to do that.') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to do that.', details) =>
  new AppError(403, 'FORBIDDEN', msg, details);
export const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg = 'That conflicts with something that already exists.', details) =>
  new AppError(409, 'CONFLICT', msg, details);
export const tooManyRequests = (msg = 'Too many requests. Slow down a moment.', details) =>
  new AppError(429, 'RATE_LIMITED', msg, details);
export const unavailable = (msg = 'That service is not available right now.') =>
  new AppError(503, 'UNAVAILABLE', msg);
