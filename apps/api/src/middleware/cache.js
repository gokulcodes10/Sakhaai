/**
 * Response caching for public GET endpoints.
 *
 * Only caches anonymous requests: a signed-in user may see different content
 * (client-visible knowledge, portal data), and one leaked personalised response
 * in a shared cache is a data breach, not a performance bug.
 */

import { cacheGet, cacheSet } from '../lib/redis.js';
import config from '../config/index.js';

export function cacheResponse({ ttl = config.redis.cacheTtl, tags = [], key } = {}) {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.auth?.isAuthenticated) return next();

    const cacheKey = key ? key(req) : `${req.baseUrl}${req.path}:${JSON.stringify(req.query)}`;

    const hit = await cacheGet(cacheKey);
    if (hit !== undefined) {
      res.set('X-Cache', 'HIT');
      return res.json(hit);
    }

    res.set('X-Cache', 'MISS');

    // Intercept res.json so handlers stay unaware they are being cached.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const resolvedTags = typeof tags === 'function' ? tags(req) : tags;
        cacheSet(cacheKey, body, ttl, resolvedTags).catch(() => {});
      }
      return originalJson(body);
    };

    return next();
  };
}

/** Cache tags used across the app. Publishing content invalidates CONTENT. */
export const TAGS = {
  CONTENT: 'content',
  PAGES: 'pages',
  KNOWLEDGE: 'knowledge',
};
