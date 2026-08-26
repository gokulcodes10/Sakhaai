import express from 'express';
import { contentPatchSchema, pageSchema, paginationSchema, publishSchema } from '@sakha/shared';
import prisma from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { cacheResponse, TAGS } from '../../middleware/cache.js';
import { requirePermission } from '../../middleware/auth.js';
import { heavyLimiter } from '../../middleware/rateLimit.js';
import { audit } from '../../lib/audit.js';
import { cacheInvalidateTags } from '../../lib/redis.js';
import { notFound } from '../../lib/errors.js';
import {
  applyDraftChanges,
  draftDiff,
  getDraftContent,
  getPublishedContent,
  listRevisions,
  publishDraft,
  resetDraft,
  revertToRevision,
} from './service.js';

const router = express.Router();

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC — what the marketing site reads
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The whole content tree, plus published CMS pages merged into it.
 * Cached hard: this is the single hottest endpoint on the site and it only
 * changes when someone publishes, which invalidates the tag.
 */
router.get(
  '/',
  cacheResponse({ ttl: 600, tags: [TAGS.CONTENT] }),
  asyncHandler(async (_req, res) => {
    const [content, pages] = await Promise.all([
      getPublishedContent(),
      prisma.page.findMany({
        where: { status: 'published' },
        orderBy: [{ kind: 'asc' }, { order: 'asc' }],
        select: {
          slug: true,
          kind: true,
          title: true,
          summary: true,
          data: true,
          ogImage: true,
          order: true,
          publishedAt: true,
        },
      }),
    ]);

    // CMS pages of kind "industry" join the industry list the nav renders, so
    // adding a vertical page really is a five-minute job with no deploy.
    const merged = structuredClone(content);
    const cmsIndustries = pages
      .filter((p) => p.kind === 'industry')
      .map((p) => ({
        slug: p.slug,
        name: p.title,
        headline: p.data?.headline ?? p.summary ?? '',
        workflow: p.data?.workflow ?? '',
        metric: p.data?.metric ?? '',
        objection: p.data?.objection ?? '',
        objectionAnswer: p.data?.objectionAnswer ?? '',
        published: true,
        fromCms: true,
      }));

    if (cmsIndustries.length) {
      merged.industries = merged.industries ?? { items: [] };
      merged.industries.items = [...(merged.industries.items ?? []), ...cmsIndustries];
    }

    return res.json({
      content: merged,
      pages: pages.filter((p) => p.kind !== 'industry'),
    });
  })
);

/** A single published CMS page, by kind and slug. */
router.get(
  '/pages/:kind/:slug',
  cacheResponse({ ttl: 600, tags: [TAGS.PAGES] }),
  asyncHandler(async (req, res) => {
    const page = await prisma.page.findUnique({
      where: { kind_slug: { kind: req.params.kind, slug: req.params.slug } },
    });
    if (!page || page.status !== 'published') throw notFound('That page does not exist.');
    return res.json({ page });
  })
);

// ══════════════════════════════════════════════════════════════════════════════
//  CMS — everything below needs cms.access plus a specific permission
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  '/draft',
  requirePermission('cms.access', 'cms.content.read'),
  asyncHandler(async (_req, res) => {
    const [draft, changes] = await Promise.all([getDraftContent(), draftDiff()]);
    return res.json({ draft, pendingChanges: changes.length, changes });
  })
);

router.patch(
  '/draft',
  requirePermission('cms.access', 'cms.content.write'),
  validate(contentPatchSchema),
  asyncHandler(async (req, res) => {
    const data = await applyDraftChanges(req.body.changes, req.auth.userId);
    audit(req, {
      action: 'cms.content.write',
      entity: 'ContentDraft',
      entityId: 'singleton',
      after: { paths: req.body.changes.map((c) => c.path), message: req.body.message },
    });
    const changes = await draftDiff();
    return res.json({ ok: true, draft: data, pendingChanges: changes.length });
  })
);

router.post(
  '/draft/reset',
  requirePermission('cms.access', 'cms.content.write'),
  asyncHandler(async (req, res) => {
    const data = await resetDraft(req.auth.userId);
    audit(req, { action: 'cms.content.draft_reset', entity: 'ContentDraft', entityId: 'singleton' });
    return res.json({ ok: true, draft: data, pendingChanges: 0 });
  })
);

/**
 * Publish. This is the moment content goes live AND Sakha re-reads it, so it is
 * rate limited and always audited.
 */
router.post(
  '/publish',
  requirePermission('cms.access', 'cms.content.publish'),
  heavyLimiter,
  validate(publishSchema),
  asyncHandler(async (req, res) => {
    const changes = await draftDiff();
    const revision = await publishDraft({ userId: req.auth.userId, message: req.body.message });

    audit(req, {
      action: 'cms.content.publish',
      entity: 'ContentRevision',
      entityId: revision.id,
      after: { version: revision.version, changedPaths: changes.map((c) => c.path) },
    });

    return res.json({
      ok: true,
      version: revision.version,
      publishedAt: revision.publishedAt,
      changesPublished: changes.length,
      message: 'Published. Sakha is re-reading the site now — usually done within 30 seconds.',
    });
  })
);

router.get(
  '/revisions',
  requirePermission('cms.access', 'cms.content.read'),
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    return res.json(await listRevisions(req.query));
  })
);

router.get(
  '/revisions/:version',
  requirePermission('cms.access', 'cms.content.read'),
  asyncHandler(async (req, res) => {
    const revision = await prisma.contentRevision.findUnique({
      where: { version: Number.parseInt(req.params.version, 10) },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    if (!revision) throw notFound('No such revision.');
    return res.json({ revision });
  })
);

router.post(
  '/revisions/:version/revert',
  requirePermission('cms.access', 'cms.content.revert'),
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const version = Number.parseInt(req.params.version, 10);
    const revision = await revertToRevision(version, {
      userId: req.auth.userId,
      message: req.body?.message,
    });
    audit(req, {
      action: 'cms.content.revert',
      entity: 'ContentRevision',
      entityId: revision.id,
      before: { revertedFrom: version },
      after: { newVersion: revision.version },
    });
    return res.json({ ok: true, version: revision.version });
  })
);

// ── CMS pages ─────────────────────────────────────────────────────────────────

router.get(
  '/admin/pages',
  requirePermission('cms.access', 'cms.content.read'),
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const { page, limit, q } = req.query;
    const where = q
      ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] }
      : {};

    const [items, total] = await Promise.all([
      prisma.page.findMany({
        where,
        orderBy: [{ kind: 'asc' }, { order: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { author: { select: { id: true, name: true } } },
      }),
      prisma.page.count({ where }),
    ]);

    return res.json({ items, total, page, limit });
  })
);

router.post(
  '/admin/pages',
  requirePermission('cms.access', 'cms.content.write'),
  validate(pageSchema),
  asyncHandler(async (req, res) => {
    const created = await prisma.page.create({
      data: {
        ...req.body,
        authorId: req.auth.userId,
        publishedAt: req.body.status === 'published' ? new Date() : null,
      },
    });
    audit(req, { action: 'cms.page.create', entity: 'Page', entityId: created.id, after: { slug: created.slug, kind: created.kind } });
    await cacheInvalidateTags(TAGS.CONTENT, TAGS.PAGES);
    if (created.status === 'published') {
      const { enqueueReindex } = await import('../../jobs/queue.js');
      await enqueueReindex({ trigger: 'publish', sources: ['cms'] });
    }
    return res.status(201).json({ ok: true, page: created });
  })
);

router.put(
  '/admin/pages/:id',
  requirePermission('cms.access', 'cms.content.write'),
  validate(pageSchema.partial()),
  asyncHandler(async (req, res) => {
    const before = await prisma.page.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('That page does not exist.');

    const wasPublished = before.status === 'published';
    const nowPublished = (req.body.status ?? before.status) === 'published';

    const updated = await prisma.page.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        publishedAt: nowPublished ? (before.publishedAt ?? new Date()) : null,
      },
    });

    audit(req, {
      action: 'cms.page.update',
      entity: 'Page',
      entityId: updated.id,
      before: { status: before.status, title: before.title },
      after: { status: updated.status, title: updated.title },
    });

    await cacheInvalidateTags(TAGS.CONTENT, TAGS.PAGES);
    if (wasPublished || nowPublished) {
      const { enqueueReindex } = await import('../../jobs/queue.js');
      await enqueueReindex({ trigger: 'publish', sources: ['cms'] });
    }

    return res.json({ ok: true, page: updated });
  })
);

router.delete(
  '/admin/pages/:id',
  requirePermission('cms.access', 'cms.content.write'),
  asyncHandler(async (req, res) => {
    const page = await prisma.page.findUnique({ where: { id: req.params.id } });
    if (!page) throw notFound('That page does not exist.');

    await prisma.page.delete({ where: { id: req.params.id } });
    audit(req, { action: 'cms.page.delete', entity: 'Page', entityId: page.id, before: { slug: page.slug, kind: page.kind, title: page.title } });

    await cacheInvalidateTags(TAGS.CONTENT, TAGS.PAGES);
    const { enqueueReindex } = await import('../../jobs/queue.js');
    await enqueueReindex({ trigger: 'publish', sources: ['cms'] });

    return res.json({ ok: true });
  })
);

export default router;
