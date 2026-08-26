import express from 'express';
import { leadSchema, leadUpdateSchema, paginationSchema } from '@sakha/shared';
import prisma from '../../lib/prisma.js';
import logger from '../../lib/logger.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { leadLimiter } from '../../middleware/rateLimit.js';
import { requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { enqueueLeadNotification } from '../../jobs/queue.js';

const router = express.Router();

/** The public contact form. */
router.post(
  '/',
  leadLimiter,
  validate(leadSchema),
  asyncHandler(async (req, res) => {
    const { website, ...data } = req.body;

    if (website) {
      logger.warn({ ip: req.ip }, 'lead honeypot triggered');
      return res.status(201).json({ ok: true }); // indistinguishable from success
    }

    const lead = await prisma.lead.create({
      data: {
        ...data,
        company: data.company || null,
        phone: data.phone || null,
        source: data.source || 'website',
        ip: req.ip?.slice(0, 60) ?? null,
        userAgent: req.get('user-agent')?.slice(0, 400) ?? null,
      },
    });

    await enqueueLeadNotification(lead.id);
    logger.info({ leadId: lead.id, source: lead.source }, 'lead captured');

    return res.status(201).json({
      ok: true,
      message: 'That is with us. A founder will reply within 24 hours.',
    });
  })
);

// ── Admin ─────────────────────────────────────────────────────────────────────

router.get(
  '/admin',
  requirePermission('crm.leads.read'),
  validateQuery(paginationSchema.extend({})),
  asyncHandler(async (req, res) => {
    const { page, limit, q } = req.query;
    const stage = req.query.stage;

    const where = {
      ...(stage ? { stage } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { company: { contains: q, mode: 'insensitive' } },
              { workflow: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total, byStage] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          owner: { select: { id: true, name: true } },
          conversation: { select: { id: true, title: true } },
        },
      }),
      prisma.lead.count({ where }),
      prisma.lead.groupBy({ by: ['stage'], _count: true }),
    ]);

    return res.json({
      items,
      total,
      page,
      limit,
      stageCounts: Object.fromEntries(byStage.map((s) => [s.stage, s._count])),
    });
  })
);

router.get(
  '/admin/:id',
  requirePermission('crm.leads.read'),
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        conversation: {
          select: {
            id: true,
            title: true,
            messages: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true, createdAt: true } },
          },
        },
      },
    });
    if (!lead) throw notFound('No such lead.');
    return res.json({ lead });
  })
);

router.patch(
  '/admin/:id',
  requirePermission('crm.leads.write'),
  validate(leadUpdateSchema),
  asyncHandler(async (req, res) => {
    const before = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('No such lead.');

    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: req.body });

    audit(req, {
      action: 'crm.leads.update',
      entity: 'Lead',
      entityId: lead.id,
      before: { stage: before.stage, ownerId: before.ownerId },
      after: { stage: lead.stage, ownerId: lead.ownerId },
    });

    return res.json({ ok: true, lead });
  })
);

router.delete(
  '/admin/:id',
  requirePermission('crm.leads.delete'),
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw notFound('No such lead.');
    await prisma.lead.delete({ where: { id: lead.id } });
    audit(req, { action: 'crm.leads.delete', entity: 'Lead', entityId: lead.id, before: { email: lead.email } });
    return res.json({ ok: true });
  })
);

export default router;
