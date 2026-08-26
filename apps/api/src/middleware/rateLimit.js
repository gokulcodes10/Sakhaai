/**
 * Redis-backed sliding-window rate limiting.
 *
 * The interesting decision is what to do when Redis is unavailable.
 * We fail OPEN for read traffic (a cache outage should not take the marketing
 * site down) and CLOSED for anything that costs money or grants access —
 * auth and the Sakha LLM endpoint. An unmetered login endpoint is a credential
 * stuffing invitation; an unmetered LLM endpoint is somebody else's bill.
 */

import { rateLimitCheck } from '../lib/redis.js';
import { tooManyRequests } from '../lib/errors.js';
import config from '../config/index.js';
import logger from '../lib/logger.js';

/** Identify the caller: a signed-in user by id, everyone else by IP. */
function defaultKey(req) {
  return req.auth?.userId ? `u:${req.auth.userId}` : `ip:${req.ip}`;
}

export function rateLimit({
  bucket,
  max,
  window,
  key = defaultKey,
  failClosed = false,
  message,
  skip,
}) {
  return async (req, res, next) => {
    if (typeof skip === 'function' && skip(req)) return next();

    const identifier = key(req);
    const limits = typeof max === 'function' ? max(req) : { max, window };
    const resolved = typeof limits === 'number' ? { max: limits, window } : limits;

    const result = await rateLimitCheck(bucket, identifier, resolved);

    res.set('RateLimit-Limit', String(result.limit));
    res.set('RateLimit-Remaining', String(result.remaining));
    res.set('RateLimit-Reset', String(Math.max(0, result.resetAt - Math.floor(Date.now() / 1000))));

    if (result.degraded && failClosed) {
      logger.error({ bucket }, 'rate limiter degraded on a fail-closed route — rejecting');
      return next(
        tooManyRequests('We cannot verify request limits right now. Please try again shortly.')
      );
    }

    if (!result.allowed) {
      const retryAfter = Math.max(1, result.resetAt - Math.floor(Date.now() / 1000));
      res.set('Retry-After', String(retryAfter));
      return next(tooManyRequests(message ?? 'Too many requests. Slow down a moment.', { retryAfter }));
    }

    return next();
  };
}

/** Site-wide backstop. Generous — this catches scrapers, not users. */
export const globalLimiter = rateLimit({
  bucket: 'global',
  ...config.rateLimit.global,
  message: 'That is a lot of requests. Give it a minute.',
});

/** Login, register, password reset. Keyed by IP *and* by the email attempted. */
export const authLimiter = rateLimit({
  bucket: 'auth',
  ...config.rateLimit.auth,
  failClosed: true,
  key: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return email ? `ip:${req.ip}|em:${email}` : `ip:${req.ip}`;
  },
  message: 'Too many attempts. Wait a few minutes before trying again.',
});

/**
 * Sakha. Every call here spends real tokens at Groq, so anonymous visitors get
 * a much tighter budget than signed-in ones.
 */
export const sakhaLimiter = rateLimit({
  bucket: 'sakha',
  failClosed: true,
  max: (req) => (req.auth?.isAuthenticated ? config.rateLimit.sakhaUser : config.rateLimit.sakhaAnon),
  key: (req) => (req.auth?.userId ? `u:${req.auth.userId}` : `v:${req.visitorId ?? req.ip}`),
  message:
    "You've reached the limit for now. Sign in for a higher allowance, or email a founder directly — hello@sakhaai.com.",
});

/** Contact form. Tight, because this one reaches a human inbox. */
export const leadLimiter = rateLimit({
  bucket: 'lead',
  ...config.rateLimit.lead,
  failClosed: true,
  message: "We've already got your message. A founder will reply within 24 hours.",
});

/** Expensive admin actions: publishing, re-indexing, bulk operations. */
export const heavyLimiter = rateLimit({
  bucket: 'heavy',
  max: 20,
  window: 300,
  message: 'That action is rate limited. Give the last one a moment to finish.',
});
