import express from 'express';
import { crawlSourceSchema, knowledgeDocSchema, knowledgeSettingsSchema, paginationSchema } from '@sakha/shared';
import prisma from '../../lib/prisma.js';
import config from '../../config/index.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { heavyLimiter } from '../../middleware/rateLimit.js';
import { notFound, badRequest } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { checksum } from '../../lib/crypto.js';
import { enqueueReindex } from '../../jobs/queue.js';
import { retrieve, visibilityFor } from '../../knowledge/retriever.js';
import { getSetting, setSetting } from '../ops/settings.js';

const router = express.Router();

/** Overview for the CMS "Sakha's knowledge" screen. */
router.get(
  '/',
  requirePermission('knowledge.read'),
  asyncHandler(async (_req, res) => {
    const [bySource, chunks, lastRuns, sources, refreshHours] = await Promise.all([
      prisma.knowledgeDocument.groupBy({ by: ['source'], _count: true }),
      prisma.knowledgeChunk.count(),
      prisma.indexRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
      prisma.crawlSource.findMany({ orderBy: { createdAt: 'asc' } }),
      getSetting('knowledge.refreshHours', config.knowledge.refreshHours),
    ]);

    return res.json({
      documents: Object.fromEntries(bySource.map((s) => [s.source, s._count])),
      totalDocuments: bySource.reduce((a, s) => a + s._count, 0),
      totalChunks: chunks,
      runs: lastRuns,
      crawlSources: sources,
      settings: {
        refreshHours,
        chunkTokens: config.knowledge.chunkTokens,
        topK: config.knowledge.topK,
        embeddingProvider: config.embedding.provider,
      },
    });
  })
);

router.get(
  '/documents',
  requirePermission('knowledge.read'),
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const { page, limit, q } = req.query;
    const source = req.query.source;

    const where = {
      ...(source ? { source } : {}),
      ...(q
        ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.knowledgeDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          source: true,
          sourceKey: true,
          title: true,
          sourceUrl: true,
          visibility: true,
          tags: true,
          indexedAt: true,
          updatedAt: true,
          _count: { select: { chunks: true } },
        },
      }),
      prisma.knowledgeDocument.count({ where }),
    ]);

    return res.json({ items, total, page, limit });
  })
);

router.get(
  '/documents/:id',
  requirePermission('knowledge.read'),
  asyncHandler(async (req, res) => {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: req.params.id },
      include: { chunks: { orderBy: { ordinal: 'asc' } } },
    });
    if (!doc) throw notFound('No such document.');
    return res.json({ document: doc });
  })
);

/** Write a knowledge document by hand. Indexed on the next light run. */
router.post(
  '/documents',
  requirePermission('knowledge.write'),
  validate(knowledgeDocSchema),
  asyncHandler(async (req, res) => {
    const sourceKey = `${Date.now()}-${req.body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;

    const doc = await prisma.knowledgeDocument.create({
      data: {
        source: 'manual',
        sourceKey,
        title: req.body.title,
        body: req.body.body,
        sourceUrl: req.body.sourceUrl || null,
        tags: req.body.tags ?? [],
        visibility: req.body.visibility,
        checksum: checksum(`${req.body.title}\n${req.body.body}`),
        authorId: req.auth.userId,
      },
    });

    audit(req, { action: 'knowledge.write', entity: 'KnowledgeDocument', entityId: doc.id, after: { title: doc.title } });
    await enqueueReindex({ trigger: 'publish', sources: ['doc'] });

    return res.status(201).json({ ok: true, document: doc });
  })
);

router.put(
  '/documents/:id',
  requirePermission('knowledge.write'),
  validate(knowledgeDocSchema.partial()),
  asyncHandler(async (req, res) => {
    const existing = await prisma.knowledgeDocument.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('No such document.');
    if (existing.source !== 'manual') {
      throw badRequest(
        `This document comes from "${existing.source}" and is rebuilt automatically. Edit it at the source instead.`
      );
    }

    const title = req.body.title ?? existing.title;
    const body = req.body.body ?? existing.body;

    const doc = await prisma.knowledgeDocument.update({
      where: { id: existing.id },
      data: { ...req.body, title, body, checksum: checksum(`${title}\n${body}`) },
    });

    audit(req, { action: 'knowledge.write', entity: 'KnowledgeDocument', entityId: doc.id });
    await enqueueReindex({ trigger: 'publish', sources: ['doc'] });

    return res.json({ ok: true, document: doc });
  })
);

router.delete(
  '/documents/:id',
  requirePermission('knowledge.delete'),
  asyncHandler(async (req, res) => {
    const doc = await prisma.knowledgeDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) throw notFound('No such document.');

    await prisma.knowledgeDocument.delete({ where: { id: doc.id } });
    audit(req, { action: 'knowledge.delete', entity: 'KnowledgeDocument', entityId: doc.id, before: { title: doc.title, source: doc.source } });

    return res.json({
      ok: true,
      ...(doc.source !== 'manual'
        ? { warning: `That document came from "${doc.source}" and will return on the next index unless you remove it at the source.` }
        : {}),
    });
  })
);

/** Try a query against the retriever — the fastest way to debug a bad answer. */
router.post(
  '/search',
  requirePermission('knowledge.read'),
  asyncHandler(async (req, res) => {
    const q = String(req.body?.query ?? '').trim();
    if (!q) throw badRequest('Give me something to search for.');

    const results = await retrieve(q, {
      topK: Math.min(Number(req.body?.limit) || 10, 20),
      visibility: visibilityFor(req.auth),
    });

    return res.json({
      query: q,
      results: results.map((r) => ({
        score: Number(r.score.toFixed(4)),
        title: r.title,
        heading: r.heading,
        url: r.sourceUrl,
        source: r.source,
        excerpt: r.content.slice(0, 400),
      })),
    });
  })
);

// ── Crawl sources ─────────────────────────────────────────────────────────────

router.post(
  '/sources',
  requirePermission('knowledge.sources.write'),
  validate(crawlSourceSchema),
  asyncHandler(async (req, res) => {
    const source = await prisma.crawlSource.upsert({
      where: { url: req.body.url },
      create: { ...req.body, label: req.body.label ?? new URL(req.body.url).hostname },
      update: req.body,
    });
    audit(req, { action: 'knowledge.sources.write', entity: 'CrawlSource', entityId: source.id, after: { url: source.url } });
    return res.status(201).json({ ok: true, source });
  })
);

router.delete(
  '/sources/:id',
  requirePermission('knowledge.sources.write'),
  asyncHandler(async (req, res) => {
    const source = await prisma.crawlSource.findUnique({ where: { id: req.params.id } });
    if (!source) throw notFound('No such crawl source.');
    await prisma.crawlSource.delete({ where: { id: source.id } });
    audit(req, { action: 'knowledge.sources.write', entity: 'CrawlSource', entityId: source.id, before: { url: source.url } });
    return res.json({ ok: true });
  })
);

// ── Reindex + schedule ────────────────────────────────────────────────────────

router.post(
  '/reindex',
  requirePermission('knowledge.reindex'),
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const sources = Array.isArray(req.body?.sources) && req.body.sources.length
      ? req.body.sources.filter((s) => ['cms', 'doc', 'crawl', 'db'].includes(s))
      : ['cms', 'doc', 'db', 'crawl'];

    const job = await enqueueReindex({ trigger: 'manual', sources });
    audit(req, { action: 'knowledge.reindex', entity: 'IndexRun', after: { sources } });

    return res.json({
      ok: Boolean(job),
      queued: Boolean(job),
      sources,
      message: job
        ? 'Rebuild queued. A crawl can take a few minutes; CMS and document sources are usually done in seconds.'
        : 'Could not queue the rebuild — the job queue is unavailable. The next scheduled run will pick this up.',
    });
  })
);

router.put(
  '/settings',
  requirePermission('knowledge.settings.write'),
  validate(knowledgeSettingsSchema),
  asyncHandler(async (req, res) => {
    await setSetting('knowledge.refreshHours', req.body.refreshHours, {
      category: 'knowledge',
      userId: req.auth.userId,
    });

    audit(req, {
      action: 'knowledge.settings.write',
      entity: 'Setting',
      entityId: 'knowledge.refreshHours',
      after: { refreshHours: req.body.refreshHours },
    });

    return res.json({
      ok: true,
      refreshHours: req.body.refreshHours,
      message: 'Saved. The new cadence takes effect when the worker next restarts; CMS publishes still re-index immediately.',
    });
  })
);

export default router;
