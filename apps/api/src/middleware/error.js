import { AppError } from '../lib/errors.js';
import logger from '../lib/logger.js';
import config from '../config/index.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}


export function errorHandler(err, req, res, _next) {
  // Deliberate rejections: safe to show the user verbatim.
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, reqId: req.id }, err.message);
    else logger.debug({ code: err.code, path: req.originalUrl }, err.message);

    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  // Prisma errors we can map to something meaningful.
  if (err?.code === 'P2002') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'That already exists.',
        details: { fields: err.meta?.target ?? [] },
      },
    });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }

  // Body parser rejections.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'That payload is too large.' } });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'That request body is not valid JSON.' } });
  }

  // Anything else is a bug. Log it fully, tell the client nothing.
  logger.error({ err, reqId: req.id, path: req.originalUrl }, 'unhandled error');
  return res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong on our side. It has been logged.',
      ...(config.isProd ? {} : { debug: err?.message, stack: err?.stack?.split('\n').slice(0, 5) }),
    },
  });
}

/** Wrap an async handler so a rejected promise reaches the error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
