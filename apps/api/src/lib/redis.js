/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Redis. Five distinct jobs, one connection pool.
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Response cache for public content (with tag-based invalidation)
 *   2. Sliding-window rate limiting
 *   3. Refresh-token revocation list (O(1) check on the hot path)
 *   4. Distributed locks (so two API instances never re-index simultaneously)
 *   5. Pub/sub cache invalidation across instances
 *
 *  Everything degrades to a no-op if Redis is down. A cache outage should slow
 *  the site, not take it offline — but rate limiting deliberately FAILS CLOSED
 *  on the auth endpoints, because an open door is worse than a slow one.
 */

import Redis from 'ioredis';
import config from '../config/index.js';
import logger from './logger.js';

const P = config.redis.prefix;

/** Namespaced key builder. Keeps every key greppable in redis-cli. */
export const k = {
  cache: (key) => `${P}:cache:${key}`,
  cacheTag: (tag) => `${P}:tag:${tag}`,
  rate: (bucket, id) => `${P}:rate:${bucket}:${id}`,
  revoked: (jti) => `${P}:revoked:${jti}`,
  userVersion: (userId) => `${P}:uv:${userId}`,
  lock: (name) => `${P}:lock:${name}`,
  perms: (userId) => `${P}:perms:${userId}`,
  content: () => `${P}:content:published`,
  channel: `${P}:invalidate`,
};

function build(role) {
  const client = new Redis(config.redis.url, {
    maxRetriesPerRequest: null, // required by BullMQ, harmless elsewhere
    enableReadyCheck: true,
    // Lazy on purpose: importing anything that touches Redis must not open a
    // socket. Without this, a one-off script or a unit test inherits a
    // reconnecting client and never exits. connectRedis() is called explicitly
    // by the server and the worker.
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  // Reconnect storms would otherwise emit one line per attempt forever. Log the
  // first failure at warn, then throttle to one line a minute.
  let lastLoggedAt = 0;
  client.on('error', (err) => {
    const now = Date.now();
    if (now - lastLoggedAt > 60_000) {
      lastLoggedAt = now;
      logger.warn({ err: err.message || err.code || String(err), role }, 'redis unavailable');
    }
  });
  client.on('ready', () => logger.info({ role }, 'redis ready'));
  return client;
}

const globalForRedis = globalThis;

export const redis = globalForRedis.__sakhaRedis ?? build('main');
/** Separate connection: a subscriber cannot issue normal commands. */
export const subscriber = globalForRedis.__sakhaRedisSub ?? build('subscriber');

if (!config.isProd) {
  globalForRedis.__sakhaRedis = redis;
  globalForRedis.__sakhaRedisSub = subscriber;
}

/**
 * Open the Redis connections. Called once from the server and once from the
 * worker. Resolves even if Redis is down — the app degrades rather than
 * refusing to boot, and every helper here is written to tolerate that.
 */
export async function connectRedis() {
  const attempts = [redis, subscriber].map(async (client) => {
    if (client.status === 'ready') return;
    try {
      if (client.status !== 'connecting' && client.status !== 'connect') {
        await client.connect();
      }
      // connect() resolves on the socket opening, but ioredis only reports
      // `ready` once its handshake completes. Callers that immediately issue a
      // command would otherwise see status !== 'ready' and take a degraded
      // path against a Redis that is in fact about to be fine.
      if (client.status !== 'ready') {
        await new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer);
            client.off('ready', done);
            resolve();
          };
          const timer = setTimeout(done, 5000);
          timer.unref?.();
          client.once('ready', done);
        });
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'redis initial connect failed; running in degraded mode');
    }
  });
  await Promise.allSettled(attempts);
  return redisReady();
}

export const redisReady = () => redis.status === 'ready';

// ── 1. Cache ──────────────────────────────────────────────────────────────────

/**
 * Read JSON from the cache. Returns undefined on a miss OR on any Redis fault,
 * so callers only ever need one "go and compute it" branch.
 */
export async function cacheGet(key) {
  if (!redisReady()) return undefined;
  try {
    const raw = await redis.get(k.cache(key));
    return raw ? JSON.parse(raw) : undefined;
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache read failed');
    return undefined;
  }
}

/**
 * Write JSON to the cache and register it under zero or more tags.
 * Tags are Redis sets of cache keys — invalidating a tag drops every key in it,
 * which is how a single CMS publish clears every content response at once.
 */
export async function cacheSet(key, value, ttlSeconds = config.redis.cacheTtl, tags = []) {
  if (!redisReady()) return;
  try {
    const full = k.cache(key);
    const pipe = redis.multi().set(full, JSON.stringify(value), 'EX', ttlSeconds);
    for (const tag of tags) {
      pipe.sadd(k.cacheTag(tag), full);
      // Tag sets outlive their members slightly so a late write is still caught.
      pipe.expire(k.cacheTag(tag), ttlSeconds + 60);
    }
    await pipe.exec();
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache write failed');
  }
}

/** Drop every cache key registered under any of these tags. */
export async function cacheInvalidateTags(...tags) {
  if (!redisReady() || tags.length === 0) return 0;
  try {
    let removed = 0;
    for (const tag of tags) {
      const setKey = k.cacheTag(tag);
      const members = await redis.smembers(setKey);
      if (members.length) {
        await redis.del(...members);
        removed += members.length;
      }
      await redis.del(setKey);
    }
    // Tell the other API instances to drop their in-process caches too.
    await redis.publish(k.channel, JSON.stringify({ type: 'tags', tags }));
    return removed;
  } catch (err) {
    logger.warn({ err: err.message, tags }, 'cache invalidation failed');
    return 0;
  }
}

/** Cache-aside helper: return cached value or compute, store and return it. */
export async function cached(key, { ttl = config.redis.cacheTtl, tags = [] } = {}, compute) {
  const hit = await cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await compute();
  if (value !== undefined && value !== null) await cacheSet(key, value, ttl, tags);
  return value;
}

// ── 2. Rate limiting ──────────────────────────────────────────────────────────

/**
 * Sliding-window counter using a sorted set of request timestamps.
 * More accurate than a fixed window (no burst at the boundary) and cheap
 * enough at this scale. Executed as one Lua script so it is atomic.
 */
const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local id     = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = now + window
  if oldest[2] then resetAt = tonumber(oldest[2]) + window end
  return { 0, count, resetAt }
end

redis.call('ZADD', key, now, id)
redis.call('EXPIRE', key, window + 1)
return { 1, count + 1, now + window }
`;

let slidingWindowSha = null;

/**
 * @returns {Promise<{allowed:boolean, remaining:number, resetAt:number, limit:number, degraded?:boolean}>}
 */
export async function rateLimitCheck(bucket, identifier, { max, window }) {
  const key = k.rate(bucket, identifier);
  const now = Math.floor(Date.now() / 1000);
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

  if (!redisReady()) {
    // Caller decides whether to fail open or closed — see middleware/rateLimit.js
    return { allowed: true, remaining: max, resetAt: now + window, limit: max, degraded: true };
  }

  try {
    if (!slidingWindowSha) slidingWindowSha = await redis.script('LOAD', SLIDING_WINDOW_LUA);
    let res;
    try {
      res = await redis.evalsha(slidingWindowSha, 1, key, now, window, max, member);
    } catch (err) {
      if (String(err.message).includes('NOSCRIPT')) {
        slidingWindowSha = await redis.script('LOAD', SLIDING_WINDOW_LUA);
        res = await redis.evalsha(slidingWindowSha, 1, key, now, window, max, member);
      } else {
        throw err;
      }
    }
    const [allowed, count, resetAt] = res;
    return {
      allowed: allowed === 1,
      remaining: Math.max(0, max - count),
      resetAt,
      limit: max,
    };
  } catch (err) {
    logger.warn({ err: err.message, bucket }, 'rate limit check failed');
    return { allowed: true, remaining: max, resetAt: now + window, limit: max, degraded: true };
  }
}

// ── 3. Token revocation ───────────────────────────────────────────────────────

/** Blacklist an access token by its jti until it would have expired anyway. */
export async function revokeToken(jti, ttlSeconds) {
  if (!redisReady() || !jti) return;
  try {
    await redis.set(k.revoked(jti), '1', 'EX', Math.max(1, ttlSeconds));
  } catch (err) {
    logger.warn({ err: err.message }, 'token revocation failed');
  }
}

export async function isTokenRevoked(jti) {
  if (!redisReady() || !jti) return false;
  try {
    return (await redis.exists(k.revoked(jti))) === 1;
  } catch {
    return false;
  }
}

/**
 * Bump a user's token version. Every access token minted before this moment
 * stops validating — used when roles change, a password is reset, or an
 * account is suspended, so a privilege change takes effect immediately rather
 * than whenever the current access token happens to expire.
 */
export async function bumpUserVersion(userId) {
  if (!redisReady()) return 0;
  try {
    const v = await redis.incr(k.userVersion(userId));
    await redis.expire(k.userVersion(userId), 60 * 60 * 24 * 60);
    await redis.del(k.perms(userId));
    return v;
  } catch {
    return 0;
  }
}

export async function getUserVersion(userId) {
  if (!redisReady()) return 0;
  try {
    return Number.parseInt((await redis.get(k.userVersion(userId))) ?? '0', 10);
  } catch {
    return 0;
  }
}

// ── 4. Locks ──────────────────────────────────────────────────────────────────

/**
 * Best-effort distributed lock. Guards work that must not run twice at once —
 * chiefly the knowledge re-index, which is expensive and non-idempotent in
 * terms of cost (it would double the crawl traffic).
 */
export async function withLock(name, ttlSeconds, fn) {
  const key = k.lock(name);
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  if (!redisReady()) return fn(); // single-instance fallback

  const acquired = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
  if (!acquired) {
    logger.info({ lock: name }, 'lock held elsewhere, skipping');
    return null;
  }

  try {
    return await fn();
  } finally {
    // Only release a lock we still own — never stomp on a successor's lock.
    await redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
      1,
      key,
      token
    );
  }
}

// ── 5. Shutdown ───────────────────────────────────────────────────────────────

export async function disconnectRedis() {
  await Promise.allSettled([redis.quit(), subscriber.quit()]);
}

export default redis;
