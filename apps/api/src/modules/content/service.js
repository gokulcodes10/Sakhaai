/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Content service — the CMS engine.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Model:
 *    ContentDraft    one row, the working copy editors mutate
 *    ContentRevision one row per publish, immutable, numbered
 *
 *  Publishing snapshots the draft into a new revision and marks it live.
 *  Reverting publishes an old revision's data as a NEW revision — history is
 *  never rewritten, so the audit trail stays truthful.
 *
 *  Every publish invalidates the content cache and enqueues a Sakha re-index,
 *  which is what makes the assistant's knowledge live rather than scheduled.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../../lib/prisma.js';
import logger from '../../lib/logger.js';
import { cacheInvalidateTags, k, redis, redisReady } from '../../lib/redis.js';
import { TAGS } from '../../middleware/cache.js';
import { notFound, badRequest } from '../../lib/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SEED_CONTENT_PATH = path.resolve(__dirname, '../../../../../content/site-content.json');

/** Read the JSON file that ships with the repo. The bootstrap source. */
export async function readSeedContent() {
  const raw = await fs.readFile(SEED_CONTENT_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * The live content tree. Cached in Redis under a dedicated key (not the generic
 * response cache) because Sakha's retriever reads it on every indexing run too.
 */
export async function getPublishedContent({ fresh = false } = {}) {
  if (!fresh && redisReady()) {
    try {
      const hit = await redis.get(k.content());
      if (hit) return JSON.parse(hit);
    } catch {
      /* fall through */
    }
  }

  const revision = await prisma.contentRevision.findFirst({
    where: { isPublished: true },
    orderBy: { version: 'desc' },
  });

  // Nothing published yet (fresh install) — fall back to the repo's JSON so the
  // site renders correctly before anyone has opened the CMS.
  const data = revision?.data ?? (await readSeedContent());

  if (redisReady()) {
    redis.set(k.content(), JSON.stringify(data), 'EX', 3600).catch(() => {});
  }
  return data;
}

/** The editor's working copy. Created from the published tree on first access. */
export async function getDraftContent() {
  const draft = await prisma.contentDraft.findUnique({ where: { id: 'singleton' } });
  if (draft) return draft.data;

  const seed = await getPublishedContent({ fresh: true });
  const created = await prisma.contentDraft.create({ data: { id: 'singleton', data: seed } });
  return created.data;
}

// ── Dot-path access ───────────────────────────────────────────────────────────

/**
 * Read a dot path like "home.hero.headline" or "services.items.0.name".
 * Numeric segments index into arrays.
 */
export function getPath(obj, dotPath) {
  return dotPath.split('.').reduce((acc, seg) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[Array.isArray(acc) ? Number.parseInt(seg, 10) : seg];
  }, obj);
}

/**
 * Immutably set a dot path, cloning only the spine that changes.
 * Refuses to create new object keys along the path, so a typo in the CMS
 * cannot silently invent `home.heroo.headline` and lose an edit.
 */
export function setPath(obj, dotPath, value) {
  const segs = dotPath.split('.');
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  let cursor = clone;

  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = Array.isArray(cursor) ? Number.parseInt(segs[i], 10) : segs[i];
    const child = cursor[seg];
    if (child === undefined || child === null || typeof child !== 'object') {
      throw badRequest(`Content path does not exist: ${segs.slice(0, i + 1).join('.')}`);
    }
    cursor[seg] = Array.isArray(child) ? [...child] : { ...child };
    cursor = cursor[seg];
  }

  const last = Array.isArray(cursor) ? Number.parseInt(segs.at(-1), 10) : segs.at(-1);
  cursor[last] = value;
  return clone;
}

/** Apply a batch of { path, value } changes to the draft. */
export async function applyDraftChanges(changes, userId) {
  let data = await getDraftContent();
  for (const change of changes) {
    data = setPath(data, change.path, change.value);
  }
  await prisma.contentDraft.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', data, updatedById: userId },
    update: { data, updatedById: userId },
  });
  return data;
}

/** Discard the working copy and start again from what is live. */
export async function resetDraft(userId) {
  const live = await getPublishedContent({ fresh: true });
  await prisma.contentDraft.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', data: live, updatedById: userId },
    update: { data: live, updatedById: userId },
  });
  return live;
}

// ── Publish / revert ──────────────────────────────────────────────────────────

/**
 * Snapshot the draft into a new published revision.
 * @returns {Promise<{version:number, id:string}>}
 */
export async function publishDraft({ userId, message }) {
  const data = await getDraftContent();

  const revision = await prisma.$transaction(async (tx) => {
    await tx.contentRevision.updateMany({
      where: { isPublished: true },
      data: { isPublished: false },
    });
    return tx.contentRevision.create({
      data: {
        data,
        message: message ?? null,
        isPublished: true,
        publishedAt: new Date(),
        authorId: userId ?? null,
      },
    });
  });

  await afterPublish(data);
  logger.info({ version: revision.version, userId }, 'content published');
  return revision;
}

/** Republish an old revision's data as a new revision. */
export async function revertToRevision(version, { userId, message }) {
  const source = await prisma.contentRevision.findUnique({ where: { version } });
  if (!source) throw notFound(`No content revision numbered ${version}`);

  const revision = await prisma.$transaction(async (tx) => {
    await tx.contentRevision.updateMany({
      where: { isPublished: true },
      data: { isPublished: false },
    });
    const created = await tx.contentRevision.create({
      data: {
        data: source.data,
        message: message ?? `Reverted to revision ${version}`,
        isPublished: true,
        publishedAt: new Date(),
        authorId: userId ?? null,
      },
    });
    await tx.contentDraft.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', data: source.data, updatedById: userId },
      update: { data: source.data, updatedById: userId },
    });
    return created;
  });

  await afterPublish(source.data);
  logger.info({ from: version, to: revision.version, userId }, 'content reverted');
  return revision;
}

/**
 * Everything that must happen the moment content goes live.
 * Cache first (so the site is correct immediately), then the re-index (which
 * is slower and must not block the publish response).
 */
async function afterPublish(data) {
  if (redisReady()) {
    await redis.set(k.content(), JSON.stringify(data), 'EX', 3600).catch(() => {});
  }
  await cacheInvalidateTags(TAGS.CONTENT, TAGS.PAGES);

  // Lazy import breaks a cycle: the queue imports nothing from content, but the
  // indexer it enqueues does.
  const { enqueueReindex } = await import('../../jobs/queue.js');
  await enqueueReindex({ trigger: 'publish', sources: ['cms', 'db'] });
}

export async function listRevisions({ page = 1, limit = 20 } = {}) {
  const [items, total] = await Promise.all([
    prisma.contentRevision.findMany({
      orderBy: { version: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        version: true,
        message: true,
        isPublished: true,
        publishedAt: true,
        createdAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.contentRevision.count(),
  ]);
  return { items, total, page, limit };
}

/**
 * Shallow diff between the draft and what is live, so the CMS can show
 * "3 unpublished changes" and exactly which fields they are.
 */
export async function draftDiff() {
  const [draft, live] = await Promise.all([getDraftContent(), getPublishedContent()]);
  const changes = [];

  const walk = (a, b, prefix = '') => {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const key of keys) {
      if (key.startsWith('$') || key.startsWith('_')) continue;
      const pathKey = prefix ? `${prefix}.${key}` : key;
      const av = a?.[key];
      const bv = b?.[key];
      const bothObjects =
        av && bv && typeof av === 'object' && typeof bv === 'object' &&
        Array.isArray(av) === Array.isArray(bv);

      if (bothObjects) {
        walk(av, bv, pathKey);
      } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
        changes.push({ path: pathKey, draft: av, live: bv });
      }
    }
  };

  walk(draft, live);
  return changes;
}
