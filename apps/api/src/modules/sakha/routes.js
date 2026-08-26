import express from 'express';
import { paginationSchema, sakhaFeedbackSchema, sakhaMessageSchema } from '@sakha/shared';
import prisma from '../../lib/prisma.js';
import config from '../../config/index.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { sakhaLimiter } from '../../middleware/rateLimit.js';
import { requirePermission } from '../../middleware/auth.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { runTurn } from '../../sakha/engine.js';
import { getSetting, setSetting } from '../ops/settings.js';
import { audit } from '../../lib/audit.js';
import { TOOL_NAMES } from '../../sakha/tools.js';
import { DEFAULT_SYSTEM_PROMPT } from '../../sakha/prompt.js';

const router = express.Router();

/** Is Sakha usable at all? The UI asks this before rendering the panel. */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [lastIndex, docCount] = await Promise.all([
      prisma.indexRun.findFirst({
        where: { status: { in: ['ok', 'partial'] } },
        orderBy: { startedAt: 'desc' },
        select: { finishedAt: true, documentsSeen: true, status: true },
      }),
      prisma.knowledgeDocument.count(),
    ]);

    return res.json({
      available: config.groq.configured,
      reason: config.groq.configured ? null : 'GROQ_API_KEY is not set',
      knowledge: {
        documents: docCount,
        lastUpdatedAt: lastIndex?.finishedAt ?? null,
        refreshEveryHours: config.knowledge.refreshHours,
      },
    });
  })
);

/**
 * One turn of conversation. Rate limited hard, because every call here spends
 * money — anonymous visitors get a much smaller allowance than signed-in users.
 */
router.post(
  '/chat',
  sakhaLimiter,
  validate(sakhaMessageSchema),
  asyncHandler(async (req, res) => {
    const result = await runTurn({
      conversationId: req.body.conversationId ?? null,
      message: req.body.message,
      pageContext: req.body.pageContext,
      auth: req.auth,
      visitorId: req.visitorId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.json(result);
  })
);

/** Load a thread the caller owns. Ownership is checked, never assumed. */
router.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        messages: {
          where: { role: { in: ['user', 'assistant'] } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, citations: true, createdAt: true },
        },
      },
    });

    if (!conversation) throw notFound('That conversation does not exist.');

    const ownedByUser = req.auth?.userId && conversation.userId === req.auth.userId;
    const ownedByVisitor = !conversation.userId && conversation.visitorId === req.visitorId;
    if (!ownedByUser && !ownedByVisitor) throw forbidden('That is not your conversation.');

    return res.json({ conversation });
  })
);

/** The caller's own recent threads. */
router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const where = req.auth?.userId
      ? { userId: req.auth.userId }
      : { visitorId: req.visitorId, userId: null };

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
    });

    return res.json({ conversations });
  })
);

router.post(
  '/feedback',
  validate(sakhaFeedbackSchema),
  asyncHandler(async (req, res) => {
    const message = await prisma.message.findUnique({
      where: { id: req.body.messageId },
      select: { id: true, conversation: { select: { userId: true, visitorId: true } } },
    });
    if (!message) throw notFound('No such message.');

    const c = message.conversation;
    const owns =
      (req.auth?.userId && c.userId === req.auth.userId) ||
      (!c.userId && c.visitorId === req.visitorId);
    if (!owns) throw forbidden('That is not your conversation.');

    await prisma.messageFeedback.create({
      data: {
        messageId: message.id,
        rating: req.body.rating,
        comment: req.body.comment ?? null,
        userId: req.auth?.userId ?? null,
      },
    });

    return res.json({ ok: true });
  })
);

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Read visitor conversations. Genuinely powerful — this is what people asked
 * before they became leads — so it sits behind its own permission and every
 * read is audited.
 */
router.get(
  '/admin/conversations',
  requirePermission('sakha.conversations.read'),
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const { page, limit, q } = req.query;
    const where = q ? { messages: { some: { content: { contains: q, mode: 'insensitive' } } } } : {};

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          pagePath: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, name: true, email: true } },
          _count: { select: { messages: true, leads: true } },
          messages: { orderBy: { createdAt: 'asc' }, take: 1, select: { content: true } },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    audit(req, { action: 'sakha.conversations.read', entity: 'Conversation', after: { count: items.length, query: q ?? null } });

    return res.json({ items, total, page, limit });
  })
);

router.get(
  '/admin/conversations/:id',
  requirePermission('sakha.conversations.read'),
  asyncHandler(async (req, res) => {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        leads: { select: { id: true, name: true, email: true, stage: true } },
      },
    });
    if (!conversation) throw notFound('No such conversation.');

    audit(req, { action: 'sakha.conversation.read', entity: 'Conversation', entityId: conversation.id });
    return res.json({ conversation });
  })
);

/** What visitors ask most, and where Sakha is failing them. */
router.get(
  '/admin/insights',
  requirePermission('sakha.conversations.read'),
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86400_000);

    const [totals, feedback, topPages, unanswered] = await Promise.all([
      prisma.conversation.count({ where: { createdAt: { gte: since } } }),
      prisma.messageFeedback.groupBy({
        by: ['rating'],
        _count: true,
        where: { createdAt: { gte: since } },
      }),
      prisma.conversation.groupBy({
        by: ['pagePath'],
        _count: true,
        where: { createdAt: { gte: since }, pagePath: { not: null } },
        orderBy: { _count: { pagePath: 'desc' } },
        take: 10,
      }),
      // Turns where Sakha admitted she did not know — the most valuable signal
      // in the whole system, because each one is a gap in the knowledge base.
      prisma.message.count({
        where: {
          role: 'assistant',
          createdAt: { gte: since },
          OR: [
            { content: { contains: "don't have that", mode: 'insensitive' } },
            { content: { contains: 'could not get to a confident answer', mode: 'insensitive' } },
            { content: { contains: "I don't know", mode: 'insensitive' } },
          ],
        },
      }),
      ]);

    const leadsFromSakha = await prisma.lead.count({
      where: { source: 'sakha-assistant', createdAt: { gte: since } },
    });

    return res.json({
      periodDays: 30,
      conversations: totals,
      leadsCaptured: leadsFromSakha,
      feedback: Object.fromEntries(feedback.map((f) => [f.rating, f._count])),
      topPages: topPages.map((p) => ({ path: p.pagePath, conversations: p._count })),
      unansweredTurns: unanswered,
      note: 'Each unanswered turn is a gap in the knowledge base. Add a document and it disappears.',
    });
  })
);

// ── Tuning ────────────────────────────────────────────────────────────────────

router.get(
  '/admin/settings',
  requirePermission('sakha.settings.write'),
  asyncHandler(async (_req, res) => {
    const [systemPrompt, enabledTools] = await Promise.all([
      getSetting('sakha.systemPrompt', DEFAULT_SYSTEM_PROMPT),
      getSetting('sakha.enabledTools', null),
    ]);

    return res.json({
      systemPrompt,
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      enabledTools: enabledTools ?? TOOL_NAMES,
      availableTools: TOOL_NAMES,
      model: config.groq.model,
      configured: config.groq.configured,
    });
  })
);

router.put(
  '/admin/settings',
  requirePermission('sakha.settings.write'),
  asyncHandler(async (req, res) => {
    const { systemPrompt, enabledTools } = req.body ?? {};

    if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 50) {
      await setSetting('sakha.systemPrompt', systemPrompt.trim(), {
        category: 'sakha',
        userId: req.auth.userId,
      });
      audit(req, { action: 'sakha.settings.write', entity: 'Setting', entityId: 'sakha.systemPrompt' });
    }

    if (Array.isArray(enabledTools)) {
      const valid = enabledTools.filter((t) => TOOL_NAMES.includes(t));
      await setSetting('sakha.enabledTools', valid, { category: 'sakha', userId: req.auth.userId });
      audit(req, {
        action: 'sakha.tools.write',
        entity: 'Setting',
        entityId: 'sakha.enabledTools',
        after: { enabledTools: valid },
      });
    }

    return res.json({ ok: true });
  })
);

export default router;
