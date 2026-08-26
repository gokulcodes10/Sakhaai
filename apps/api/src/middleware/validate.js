import { ZodError } from 'zod';
import { badRequest } from '../lib/errors.js';

/** Turn a Zod error into { field: message } the frontend can drop onto inputs. */
function fieldErrors(err) {
  const out = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

/**
 * Validate and REPLACE the request part with the parsed result, so handlers
 * work with coerced, defaulted, trimmed data and never with raw input.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    try {
      req[source] = schema.parse(req[source]);
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(badRequest('Some of those details need another look.', { fields: fieldErrors(err) }));
      }
      return next(err);
    }
  };
}

export const validateQuery = (schema) => validate(schema, 'query');
export const validateParams = (schema) => validate(schema, 'params');
