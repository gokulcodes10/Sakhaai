/**
 * Integration tests — these run against a real Postgres and Redis.
 *
 *   npm run infra:up && npm run db:deploy && npm run db:seed
 *   npm run test:integration --workspace @sakha/api
 *
 * They exercise the paths that unit tests cannot prove: that the auth cookies
 * really work, that a permission grant really takes effect without a re-login,
 * and that publishing content really invalidates the cache.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import prisma, { disconnectPrisma } from '../src/lib/prisma.js';
import { connectRedis, disconnectRedis, redis, redisReady } from '../src/lib/redis.js';
import { closeQueues } from '../src/jobs/queue.js';

let server;
let base;

/** Minimal cookie-aware fetch, so we exercise the real cookie flow. */
function makeClient() {
  const jar = new Map();
  return {
    get cookies() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    async fetch(path, opts = {}) {
      const res = await fetch(`${base}${path}`, {
        ...opts,
        headers: {
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
          ...(jar.size ? { cookie: this.cookies } : {}),
          ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx);
        const value = pair.slice(idx + 1);
        if (value === '' ) jar.delete(name);
        else jar.set(name, value);
      }
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON response */
      }
      return { status: res.status, body: json, headers: res.headers };
    },
  };
}

/**
 * Clear this suite's rate-limit buckets.
 *
 * The auth limiter allows 8 attempts per five minutes per IP+email, which is
 * correct in production and fatal for a suite that signs in on nearly every
 * test. Rather than weaken the limiter for tests (and stop testing the thing
 * that protects the login endpoint), the suite resets its own buckets.
 */
async function clearRateLimits() {
  if (!redisReady()) return;
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${process.env.REDIS_PREFIX ?? 'sakha'}:rate:*`, 'COUNT', 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  if (keys.length) await redis.del(...keys);
}

before(async () => {
  await connectRedis();
  await clearRateLimits();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await closeQueues();
  await disconnectPrisma();
  await disconnectRedis();
});

const SUPER = {
  email: process.env.SEED_SUPERADMIN_EMAIL,
  password: process.env.SEED_SUPERADMIN_PASSWORD,
};
const ADMIN = {
  email: process.env.SEED_ADMIN_BD_EMAIL,
  password: process.env.SEED_ADMIN_BD_PASSWORD,
};

test('health and readiness', async () => {
  const c = makeClient();
  const health = await c.fetch('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  const ready = await c.fetch('/api/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.checks.database, true);
});

test('public content is served without auth', async () => {
  const c = makeClient();
  const res = await c.fetch('/api/content');
  assert.equal(res.status, 200);
  assert.ok(res.body.content.company.brandName);
  assert.ok(Array.isArray(res.body.content.pricing.tiers));
});

test('the CMS refuses anonymous callers', async () => {
  const c = makeClient();
  const res = await c.fetch('/api/content/draft');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('bad credentials are rejected without revealing which half was wrong', async () => {
  const c = makeClient();
  const res = await c.fetch('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody@example.com', password: 'WrongPassword123' },
  });
  assert.equal(res.status, 401);
  assert.match(res.body.error.message, /do not match/i);
});

test('super admin signs in and holds the wildcard', async () => {
  const c = makeClient();
  const res = await c.fetch('/api/auth/login', { method: 'POST', body: SUPER });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.user.roles.includes('super_admin'));
  assert.ok(res.body.user.permissions.includes('*'));

  const me = await c.fetch('/api/auth/me');
  assert.equal(me.body.user.email, SUPER.email.toLowerCase());
});

test('a granted permission takes effect without signing in again', async () => {
  const superC = makeClient();
  const adminC = makeClient();

  await superC.fetch('/api/auth/login', { method: 'POST', body: SUPER });
  const login = await adminC.fetch('/api/auth/login', { method: 'POST', body: ADMIN });
  assert.equal(login.status, 200);
  const adminId = login.body.user.id;

  // Start from a clean slate so the test is repeatable.
  await superC.fetch(`/api/iam/users/${adminId}/grants`, { method: 'PUT', body: { permissions: [] } });

  const before = await adminC.fetch('/api/content/draft');
  assert.equal(before.status, 403, 'admin should not reach the CMS before the grant');

  const grant = await superC.fetch(`/api/iam/users/${adminId}/grants`, {
    method: 'PUT',
    body: { permissions: ['cms.access', 'cms.content.read'] },
  });
  assert.equal(grant.status, 200);
  assert.deepEqual(grant.body.added.sort(), ['cms.access', 'cms.content.read']);

  // Same cookies, same session — the token version bump must make this work.
  const afterGrant = await adminC.fetch('/api/content/draft');
  assert.equal(afterGrant.status, 200, 'grant did not take effect on the existing session');

  // And revoking must take effect just as fast.
  await superC.fetch(`/api/iam/users/${adminId}/grants`, { method: 'PUT', body: { permissions: [] } });
  const afterRevoke = await adminC.fetch('/api/content/draft');
  assert.equal(afterRevoke.status, 403, 'revocation did not take effect immediately');
});

test('an admin cannot escalate their own privileges', async () => {
  const adminC = makeClient();
  const login = await adminC.fetch('/api/auth/login', { method: 'POST', body: ADMIN });
  const adminId = login.body.user.id;

  const attempt = await adminC.fetch(`/api/iam/users/${adminId}/grants`, {
    method: 'PUT',
    body: { permissions: ['iam.grant', 'cms.access'] },
  });
  assert.equal(attempt.status, 403, 'an admin managed to grant themselves permissions');
});

test('an admin cannot delete a super admin', async () => {
  const superC = makeClient();
  const adminC = makeClient();
  await superC.fetch('/api/auth/login', { method: 'POST', body: SUPER });
  await adminC.fetch('/api/auth/login', { method: 'POST', body: ADMIN });

  const users = await superC.fetch('/api/iam/users');
  const superUser = users.body.items.find((u) => u.roles.some((r) => r.key === 'super_admin'));

  const res = await adminC.fetch(`/api/iam/users/${superUser.id}`, { method: 'DELETE' });
  assert.ok(res.status === 403 || res.status === 401, `expected refusal, got ${res.status}`);
});

test('the last super admin cannot be demoted', async () => {
  const superC = makeClient();
  await superC.fetch('/api/auth/login', { method: 'POST', body: SUPER });

  const users = await superC.fetch('/api/iam/users');
  const supers = users.body.items.filter((u) => u.roles.some((r) => r.key === 'super_admin'));

  if (supers.length === 1) {
    const res = await superC.fetch(`/api/iam/users/${supers[0].id}/roles`, {
      method: 'PUT',
      body: { roleKeys: ['admin'] },
    });
    assert.equal(res.status, 409, 'the only super admin was allowed to demote themselves');
  }
});

test('the contact form validates and rejects a honeypot submission', async () => {
  const c = makeClient();

  const bad = await c.fetch('/api/leads', {
    method: 'POST',
    body: { name: 'A', email: 'not-an-email', workflow: 'too short' },
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.fields.email);

  const before = await prisma.lead.count();
  const honeypot = await c.fetch('/api/leads', {
    method: 'POST',
    body: {
      name: 'Spam Bot',
      email: 'bot@example.com',
      workflow: 'This is a long enough description to pass validation checks.',
      website: 'http://spam.example.com',
    },
  });
  assert.equal(honeypot.status, 201, 'honeypot should look like success to the bot');
  assert.equal(await prisma.lead.count(), before, 'a honeypot submission was stored');
});

test('publishing invalidates the public content cache', async () => {
  const c = makeClient();
  await c.fetch('/api/auth/login', { method: 'POST', body: SUPER });

  const marker = `Test headline ${Date.now()}`;
  await c.fetch('/api/content/draft', {
    method: 'PATCH',
    body: { changes: [{ path: 'home.hero.eyebrow', value: marker }] },
  });

  // Warm the cache with the pre-publish value.
  const anon = makeClient();
  await anon.fetch('/api/content');
  const warmed = await anon.fetch('/api/content');
  assert.equal(warmed.headers.get('x-cache'), 'HIT');

  const published = await c.fetch('/api/content/publish', { method: 'POST', body: {} });
  assert.equal(published.status, 200);

  const fresh = await anon.fetch('/api/content');
  assert.equal(fresh.headers.get('x-cache'), 'MISS', 'cache was not invalidated by publish');
  assert.equal(fresh.body.content.home.hero.eyebrow, marker);

  // Put it back so re-running the suite is idempotent.
  await c.fetch('/api/content/draft', {
    method: 'PATCH',
    body: { changes: [{ path: 'home.hero.eyebrow', value: 'Sakha means friend' }] },
  });
  await c.fetch('/api/content/publish', { method: 'POST', body: {} });
});

test('the CMS refuses a path that does not exist', async () => {
  const c = makeClient();
  await c.fetch('/api/auth/login', { method: 'POST', body: SUPER });

  const res = await c.fetch('/api/content/draft', {
    method: 'PATCH',
    body: { changes: [{ path: 'home.heroo.headline', value: 'typo' }] },
  });
  assert.equal(res.status, 400, 'a typo in a content path was silently accepted');
});

test('Sakha reports her own status honestly', async () => {
  const c = makeClient();
  const res = await c.fetch('/api/sakha/status');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.available, 'boolean');
  assert.ok(res.body.knowledge.documents >= 0);
});

test('one visitor cannot read another visitor\'s conversation', async () => {

  const stranger = makeClient();

  const conversation = await prisma.conversation.create({
    data: { visitorId: 'visitor-under-test', title: 'private' },
  });

  const res = await stranger.fetch(`/api/sakha/conversations/${conversation.id}`);
  assert.ok(res.status === 403 || res.status === 404, `expected refusal, got ${res.status}`);

  await prisma.conversation.delete({ where: { id: conversation.id } });
});

test('logging out clears the session', async () => {
  const c = makeClient();
  await c.fetch('/api/auth/login', { method: 'POST', body: SUPER });
  assert.equal((await c.fetch('/api/auth/me')).body.user?.email, SUPER.email.toLowerCase());

  await c.fetch('/api/auth/logout', { method: 'POST' });
  const after = await c.fetch('/api/auth/me');
  assert.equal(after.body.user, null, 'session survived a logout');
});
