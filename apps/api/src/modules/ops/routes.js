import express from 'express';
import prisma from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/auth.js';
import { heavyLimiter } from '../../middleware/rateLimit.js';
import { cacheInvalidateTags, redisReady } from '../../lib/redis.js';
import { TAGS } from '../../middleware/cache.js';
import { audit } from '../../lib/audit.js';
import { listSettings, setSetting } from './settings.js';
import { knowledgeQueue, mailQueue, maintenanceQueue } from '../../jobs/queue.js';

const router = express.Router();

/** Dashboard numbers for the admin home screen. */
router.get(
  '/dashboard',
  requirePermission('crm.leads.read'),
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86400_000);

    const [leads, newLeads, conversations, users, lastIndex, lastPublish] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { createdAt: { gte: since } } }),
      prisma.conversation.count({ where: { createdAt: { gte: since } } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.indexRun.findFirst({ where: { status: { in: ['ok', 'partial'] } }, orderBy: { startedAt: 'desc' } }),
      prisma.contentRevision.findFirst({ where: { isPublished: true }, orderBy: { version: 'desc' }, select: { version: true, publishedAt: true } }),
    ]);

    return res.json({
      leads: { total: leads, last30Days: newLeads },
      conversations: { last30Days: conversations },
      users,
      knowledge: {
        lastIndexedAt: lastIndex?.finishedAt ?? null,
        documents: lastIndex?.documentsSeen ?? 0,
        status: lastIndex?.status ?? 'never',
      },
      content: lastPublish,
    });
  })
);

router.get(
  '/jobs',
  requirePermission('ops.jobs.read'),
  asyncHandler(async (_req, res) => {
    const queues = [
      { name: 'knowledge', queue: knowledgeQueue },
      { name: 'mail', queue: mailQueue },
      { name: 'maintenance', queue: maintenanceQueue },
    ];

    const stats = await Promise.all(
      queues.map(async ({ name, queue }) => {
        try {
          const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
          const repeatables = await queue.getRepeatableJobs();
          return { name, counts, scheduled: repeatables.map((r) => ({ name: r.name, every: r.every, next: r.next })) };
        } catch (err) {
          return { name, error: err.message };
        }
      })
    );

    return res.json({ queues: stats, redisAvailable: redisReady() });
  })
);

router.get(
  '/settings',
  requirePermission('ops.settings.write'),
  asyncHandler(async (req, res) => {
    return res.json({ settings: await listSettings(req.query.category) });
  })
);

router.put(
  '/settings/:key',
  requirePermission('ops.settings.write'),
  asyncHandler(async (req, res) => {
    const row = await setSetting(req.params.key, req.body?.value, {
      category: req.body?.category ?? 'general',
      userId: req.auth.userId,
    });
    audit(req, { action: 'ops.settings.write', entity: 'Setting', entityId: req.params.key, after: { value: req.body?.value } });
    return res.json({ ok: true, setting: row });
  })
);

router.post(
  '/cache/purge',
  requirePermission('ops.cache.purge'),
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const removed = await cacheInvalidateTags(TAGS.CONTENT, TAGS.PAGES, TAGS.KNOWLEDGE, 'settings');
    audit(req, { action: 'ops.cache.purge', after: { keysRemoved: removed } });
    return res.json({ ok: true, keysRemoved: removed });
  })
);

export default router;
