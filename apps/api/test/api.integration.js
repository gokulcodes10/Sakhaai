/**
 * Integration tests — these run against a real Postgres and Redis.
 *
 *   npm run infra:up && npm run db:deploy && npm run db:seed
 *   npm run test:integration --workspace @asphalix/api
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
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${process.env.REDIS_PREFIX ?? 'asphalix'}:rate:*`, 'COUNT', 200);
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
  // Asphalix does not publish prices; the live tree must not carry them.
  assert.equal(res.body.content.pricing, undefined, 'published content still has a pricing block');
  assert.ok(!JSON.stringify(res.body.content).includes('₹'), 'published content still has a rupee figure');
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


// ── Support desk ──────────────────────────────────────────────────────────────

/** Two client organisations with one user each, removed after the suite. */
async function makeClientUsers() {
  const argon2 = (await import('argon2')).default;
  const role = await prisma.role.findUnique({ where: { key: 'client' } });
  const passwordHash = await argon2.hash('Test-password-123!', { type: argon2.argon2id });
  const stamp = Date.now();
  const make = async (tag) => {
    const account = await prisma.clientAccount.create({ data: { name: `Test ${tag}`, slug: `test-${tag}-${stamp}` } });
    const user = await prisma.user.create({
      data: {
        email: `client-${tag}-${stamp}@example.test`,
        name: `Client ${tag.toUpperCase()}`,
        passwordHash,
        status: 'active',
        clientAccountId: account.id,
        roles: { create: [{ roleId: role.id }] },
      },
    });
    return { account, user, creds: { email: user.email, password: 'Test-password-123!' } };
  };
  const a = await make('a');
  const b = await make('b');
  const cleanup = async () => {
    await prisma.ticket.deleteMany({ where: { clientAccountId: { in: [a.account.id, b.account.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: [a.account.id, b.account.id] } } });
  };
  return { a, b, cleanup };
}

test('a client raises, reads and replies to a ticket; another client cannot see it', async () => {
  const { a, b, cleanup } = await makeClientUsers();
  try {
    const ca = makeClient();
    const cb = makeClient();
    assert.equal((await ca.fetch('/api/auth/login', { method: 'POST', body: a.creds })).status, 200);
    assert.equal((await cb.fetch('/api/auth/login', { method: 'POST', body: b.creds })).status, 200);

    const created = await ca.fetch('/api/portal/tickets', {
      method: 'POST',
      body: { subject: 'Agent stopped replying', body: 'Since this morning the WhatsApp agent does not answer.', priority: 'high' },
    });
    assert.equal(created.status, 201);
    const id = created.body.ticket.id;
    assert.ok(created.body.ticket.number > 0);

    const own = await ca.fetch(`/api/portal/tickets/${id}`);
    assert.equal(own.status, 200);

    const other = await cb.fetch(`/api/portal/tickets/${id}`);
    assert.equal(other.status, 404, 'a client read another organisation\'s ticket');
    const otherReply = await cb.fetch(`/api/portal/tickets/${id}/messages`, { method: 'POST', body: { body: 'hi' } });
    assert.equal(otherReply.status, 404, 'a client replied on another organisation\'s ticket');

    // A client cannot smuggle an internal note in.
    const reply = await ca.fetch(`/api/portal/tickets/${id}/messages`, {
      method: 'POST',
      body: { body: 'Still broken.', internal: true },
    });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.ticket.messages.at(-1).internal, false);

    // Clients cannot reach the staff queue.
    assert.equal((await ca.fetch('/api/support/tickets')).status, 403);
  } finally {
    await cleanup();
  }
});

test('staff replies move a ticket to pending, internal notes stay hidden from the client', async () => {
  const { a, cleanup } = await makeClientUsers();
  try {
    const client = makeClient();
    await client.fetch('/api/auth/login', { method: 'POST', body: a.creds });
    const { body } = await client.fetch('/api/portal/tickets', {
      method: 'POST',
      body: { subject: 'Question about handover docs', body: 'Where do we find the evaluation harness docs?' },
    });
    const id = body.ticket.id;

    const staff = makeClient();
    await staff.fetch('/api/auth/login', { method: 'POST', body: SUPER });

    const queue = await staff.fetch('/api/support/tickets?status=active');
    assert.equal(queue.status, 200);
    assert.ok(queue.body.items.some((t) => t.id === id));

    const note = await staff.fetch(`/api/support/tickets/${id}/messages`, {
      method: 'POST',
      body: { body: 'Check the handover folder first.', internal: true },
    });
    assert.equal(note.status, 201);
    assert.equal(note.body.ticket.status, 'open', 'an internal note changed the status');

    const reply = await staff.fetch(`/api/support/tickets/${id}/messages`, {
      method: 'POST',
      body: { body: 'It is in docs/evals in your repository.' },
    });
    assert.equal(reply.body.ticket.status, 'pending');

    const seen = await client.fetch(`/api/portal/tickets/${id}`);
    assert.equal(seen.body.ticket.messages.length, 1, 'the client saw an internal note');
    assert.ok(!seen.body.ticket.messages.some((m) => m.internal));

    // A client reply reopens it.
    const back = await client.fetch(`/api/portal/tickets/${id}/messages`, { method: 'POST', body: { body: 'Found it, thanks.' } });
    assert.equal(back.body.ticket.status, 'open');

    const resolved = await staff.fetch(`/api/support/tickets/${id}`, { method: 'PATCH', body: { status: 'resolved' } });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.ticket.status, 'resolved');
  } finally {
    await cleanup();
  }
});

test('anonymous visitors cannot reach the support queue', async () => {
  const c = makeClient();
  const res = await c.fetch('/api/support/tickets');
  assert.ok(res.status === 401 || res.status === 403, `expected refusal, got ${res.status}`);
});
