/**
 * Client portal. Every query here is scoped to the caller's own
 * clientAccountId — there is no endpoint that takes an account id from the
 * request, because that is exactly how cross-tenant leaks happen.
 */

import express from 'express';
import prisma from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { validate } from '../../middleware/validate.js';
import { ticketCreateSchema, ticketReplySchema } from '@asphalix/shared';
import {
  addTicketMessage,
  createTicket,
  getClientTicket,
  ticketSummarySelect,
  updateTicket,
} from '../tickets/service.js';

const router = express.Router();

/** Resolve the caller's account, or refuse. Never trust a client-supplied id. */
async function ownAccountId(req) {
  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { clientAccountId: true },
  });
  if (!user?.clientAccountId) {
    throw forbidden('This account is not linked to a client organisation yet. Reach us from the contact page.');
  }
  return user.clientAccountId;
}

router.get(
  '/overview',
  requirePermission('portal.access'),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);

    const [account, projects, documents, openTickets] = await Promise.all([
      prisma.clientAccount.findUnique({
        where: { id: accountId },
        select: { id: true, name: true, industry: true, createdAt: true },
      }),
      prisma.project.findMany({
        where: { clientAccountId: accountId },
        orderBy: { updatedAt: 'desc' },
        include: { updates: { orderBy: { createdAt: 'desc' }, take: 3 } },
      }),
      prisma.document.count({ where: { clientAccountId: accountId } }),
      prisma.ticket.count({ where: { clientAccountId: accountId, status: { in: ['open', 'pending'] } } }),
    ]);

    return res.json({ account, projects, counts: { documents, openTickets } });
  })
);

router.get(
  '/projects/:id',
  requirePermission('portal.projects.read'),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);

    const project = await prisma.project.findFirst({
      where: { id: req.params.id, clientAccountId: accountId },
      include: {
        updates: { orderBy: { createdAt: 'desc' } },
        documents: { select: { id: true, title: true, url: true, createdAt: true } },
      },
    });
    if (!project) throw notFound('No such project.');

    return res.json({ project });
  })
);

router.get(
  '/documents',
  requirePermission('portal.documents.read'),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);
    const documents = await prisma.document.findMany({
      where: { clientAccountId: accountId },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { id: true, name: true } } },
    });
    return res.json({ documents });
  })
);

router.get(
  '/tickets',
  requirePermission('portal.access'),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);
    const tickets = await prisma.ticket.findMany({
      where: { clientAccountId: accountId },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        ...ticketSummarySelect,
        raisedBy: { select: { id: true, name: true } },
        _count: { select: { messages: { where: { internal: false } } } },
      },
    });
    return res.json({ tickets });
  })
);

router.get(
  '/tickets/:id',
  requirePermission('portal.access'),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);
    const ticket = await getClientTicket(req.params.id, accountId);
    if (!ticket) throw notFound('No such ticket.');
    return res.json({ ticket });
  })
);

router.post(
  '/tickets',
  requirePermission('portal.tickets.write'),
  validate(ticketCreateSchema),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);
    const ticket = await createTicket({
      clientAccountId: accountId,
      raisedById: req.auth.userId,
      ...req.body,
      source: 'portal',
    });
    audit(req, { action: 'portal.ticket.create', entity: 'Ticket', entityId: ticket.id });
    return res.status(201).json({ ok: true, ticket });
  })
);

router.post(
  '/tickets/:id/messages',
  requirePermission('portal.tickets.write'),
  validate(ticketReplySchema),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);
    const own = await getClientTicket(req.params.id, accountId);
    if (!own) throw notFound('No such ticket.');
    if (own.status === 'closed') throw badRequest('That ticket is closed. Raise a new one and mention its number.');

    // `internal` is a staff-only flag; a client message is never internal.
    await addTicketMessage({ ticketId: own.id, authorType: 'client', authorId: req.auth.userId, body: req.body.body });
    audit(req, { action: 'portal.ticket.reply', entity: 'Ticket', entityId: own.id });
    return res.status(201).json({ ticket: await getClientTicket(own.id, accountId) });
  })
);

router.post(
  '/tickets/:id/close',
  requirePermission('portal.tickets.write'),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);
    const own = await getClientTicket(req.params.id, accountId);
    if (!own) throw notFound('No such ticket.');
    if (own.status !== 'closed') await updateTicket(own.id, { status: 'closed' }, { silent: true });
    audit(req, { action: 'portal.ticket.close', entity: 'Ticket', entityId: own.id });
    return res.json({ ticket: await getClientTicket(own.id, accountId) });
  })
);

export default router;
