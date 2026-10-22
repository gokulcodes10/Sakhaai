/**
 * The staff side of the support desk: /api/support/*.
 * The client side lives in the portal routes, scoped to the caller's account.
 */

import express from 'express';
import { ticketListQuerySchema, ticketReplySchema, ticketUpdateSchema } from '@asphalix/shared';
import prisma from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { addTicketMessage, getStaffTicket, ticketSummarySelect, updateTicket } from './service.js';

const router = express.Router();

router.get(
  '/tickets',
  requirePermission('support.tickets.read'),
  validateQuery(ticketListQuerySchema),
  asyncHandler(async (req, res) => {
    const { status, priority, assignee, q, page, limit } = req.query;

    const where = {};
    if (status === 'active') where.status = { in: ['open', 'pending'] };
    else if (status !== 'all') where.status = status;
    if (priority) where.priority = priority;
    if (assignee === 'me') where.assigneeId = req.auth.userId;
    else if (assignee === 'none') where.assigneeId = null;
    else if (assignee) where.assigneeId = assignee;
    if (q) {
      const n = Number.parseInt(q.replace(/^#/, ''), 10);
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { body: { contains: q, mode: 'insensitive' } },
        { requesterEmail: { contains: q, mode: 'insensitive' } },
        ...(Number.isFinite(n) ? [{ number: n }] : []),
      ];
    }

    const [items, total, counts] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          ...ticketSummarySelect,
          requesterName: true,
          requesterEmail: true,
          raisedBy: { select: { name: true, email: true } },
          assignee: { select: { id: true, name: true } },
          clientAccount: { select: { name: true } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.ticket.count({ where }),
      prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return res.json({
      items,
      total,
      page,
      limit,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    });
  })
);

/** People a ticket can be assigned to: anyone who can work the queue. */
router.get(
  '/assignees',
  requirePermission('support.tickets.write'),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { status: 'active', deletedAt: null, clientAccountId: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    return res.json({ users });
  })
);

router.get(
  '/tickets/:id',
  requirePermission('support.tickets.read'),
  asyncHandler(async (req, res) => {
    const ticket = await getStaffTicket(req.params.id);
    if (!ticket) throw notFound('No such ticket.');
    audit(req, { action: 'support.ticket.read', entity: 'Ticket', entityId: ticket.id });
    return res.json({ ticket });
  })
);

router.patch(
  '/tickets/:id',
  requirePermission('support.tickets.write'),
  validate(ticketUpdateSchema),
  asyncHandler(async (req, res) => {
    if (Object.keys(req.body).length === 0) throw badRequest('Nothing to change.');
    if (req.body.assigneeId) {
      const exists = await prisma.user.findFirst({ where: { id: req.body.assigneeId, clientAccountId: null } });
      if (!exists) throw badRequest('That person cannot be assigned tickets.');
    }
    const result = await updateTicket(req.params.id, req.body);
    if (!result) throw notFound('No such ticket.');
    audit(req, {
      action: 'support.ticket.update',
      entity: 'Ticket',
      entityId: req.params.id,
      before: { status: result.before.status, priority: result.before.priority, assigneeId: result.before.assigneeId },
      after: req.body,
    });
    return res.json({ ticket: await getStaffTicket(req.params.id) });
  })
);

router.post(
  '/tickets/:id/messages',
  requirePermission('support.tickets.write'),
  validate(ticketReplySchema),
  asyncHandler(async (req, res) => {
    const message = await addTicketMessage({
      ticketId: req.params.id,
      authorType: 'staff',
      authorId: req.auth.userId,
      body: req.body.body,
      internal: req.body.internal,
    });
    if (!message) throw notFound('No such ticket.');
    audit(req, {
      action: message.internal ? 'support.ticket.note' : 'support.ticket.reply',
      entity: 'Ticket',
      entityId: req.params.id,
    });
    return res.status(201).json({ ticket: await getStaffTicket(req.params.id) });
  })
);

export default router;
