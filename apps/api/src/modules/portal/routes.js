/**
 * Client portal. Every query here is scoped to the caller's own
 * clientAccountId — there is no endpoint that takes an account id from the
 * request, because that is exactly how cross-tenant leaks happen.
 */

import express from 'express';
import prisma from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/auth.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

const router = express.Router();

/** Resolve the caller's account, or refuse. Never trust a client-supplied id. */
async function ownAccountId(req) {
  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { clientAccountId: true },
  });
  if (!user?.clientAccountId) {
    throw forbidden('This account is not linked to a client organisation yet. Email hello@sakhaai.com.');
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
      prisma.ticket.count({ where: { clientAccountId: accountId, status: 'open' } }),
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
      orderBy: { createdAt: 'desc' },
      include: { raisedBy: { select: { id: true, name: true } } },
    });
    return res.json({ tickets });
  })
);

router.post(
  '/tickets',
  requirePermission('portal.tickets.write'),
  asyncHandler(async (req, res) => {
    const accountId = await ownAccountId(req);
    const subject = String(req.body?.subject ?? '').trim().slice(0, 200);
    const body = String(req.body?.body ?? '').trim().slice(0, 8000);

    if (subject.length < 3 || body.length < 10) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Give the request a subject and a sentence or two of detail.' },
      });
    }

    const ticket = await prisma.ticket.create({
      data: {
        clientAccountId: accountId,
        raisedById: req.auth.userId,
        subject,
        body,
        priority: ['low', 'normal', 'high'].includes(req.body?.priority) ? req.body.priority : 'normal',
      },
    });

    audit(req, { action: 'portal.ticket.create', entity: 'Ticket', entityId: ticket.id });
    return res.status(201).json({ ok: true, ticket });
  })
);

export default router;
