/**
 * Support tickets — the one place tickets are created and changed.
 *
 * The portal routes, the admin routes and Sakha's tools all go through here,
 * so the status rules, the activity timestamp and the emails behave the same
 * however a ticket was touched.
 */

import prisma from '../../lib/prisma.js';
import logger from '../../lib/logger.js';

const PERSON = { select: { id: true, name: true, email: true } };

async function notify(ticketId, event, extra) {
  try {
    const { enqueueTicketEmail } = await import('../../jobs/queue.js');
    await enqueueTicketEmail(ticketId, event, extra);
  } catch (err) {
    logger.warn({ err: err.message, ticketId, event }, 'ticket email not queued');
  }
}

/** Resolve the caller's client account, or null. Never trust a client-supplied id. */
export async function clientAccountIdFor(userId) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { clientAccountId: true } });
  return user?.clientAccountId ?? null;
}

/**
 * @param {object} input
 * @param {string|null} input.clientAccountId
 * @param {string|null} input.raisedById
 * @param {string} [input.requesterName]   for visitors without an account
 * @param {string} [input.requesterEmail]
 * @param {'portal'|'sakha'|'email'|'admin'} input.source
 */
export async function createTicket(input) {
  const ticket = await prisma.ticket.create({
    data: {
      clientAccountId: input.clientAccountId ?? null,
      raisedById: input.raisedById ?? null,
      requesterName: input.requesterName ?? null,
      requesterEmail: input.requesterEmail ?? null,
      subject: input.subject,
      body: input.body,
      priority: input.priority ?? 'normal',
      category: input.category ?? null,
      source: input.source ?? 'portal',
      conversationId: input.conversationId ?? null,
    },
  });
  logger.info({ ticketId: ticket.id, number: ticket.number, source: ticket.source }, 'ticket created');
  await notify(ticket.id, 'created');
  return ticket;
}

/**
 * Add a message and move the status the way a helpdesk should:
 * a staff reply puts the ticket in "pending" (waiting on the client), a client
 * reply puts it back to "open" — including reopening a resolved one.
 * Internal notes change nothing the client can see and send no email.
 */
export async function addTicketMessage({ ticketId, authorType, authorId = null, body, internal = false }) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
  if (!ticket) return null;

  const isStaff = authorType === 'staff';
  const note = isStaff && internal;
  let status = ticket.status;
  if (!note) {
    if (isStaff && ['open'].includes(ticket.status)) status = 'pending';
    if (!isStaff && ['pending', 'resolved'].includes(ticket.status)) status = 'open';
  }

  const [message] = await prisma.$transaction([
    prisma.ticketMessage.create({ data: { ticketId, authorType, authorId, body, internal: note } }),
    prisma.ticket.update({
      where: { id: ticketId },
      data: { lastActivityAt: new Date(), status, closedAt: status === 'closed' ? new Date() : null },
    }),
  ]);

  if (!note) await notify(ticketId, isStaff ? 'staff-reply' : 'client-reply', { messageId: message.id });
  return message;
}

/**
 * Status / priority / assignee changes. Emails the requester when the status
 * moves, unless `silent` (the requester made the change themselves).
 */
export async function updateTicket(ticketId, patch, { silent = false } = {}) {
  const before = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!before) return null;

  const data = { ...patch, lastActivityAt: new Date() };
  if (patch.status) data.closedAt = ['resolved', 'closed'].includes(patch.status) ? new Date() : null;

  const after = await prisma.ticket.update({ where: { id: ticketId }, data });
  if (!silent && patch.status && patch.status !== before.status) await notify(ticketId, 'status');
  return { before, after };
}

/** A ticket as a client may see it: no internal notes, no staff emails. */
export async function getClientTicket(ticketId, clientAccountId) {
  if (!clientAccountId) return null;
  return prisma.ticket.findFirst({
    where: { id: ticketId, clientAccountId },
    include: {
      raisedBy: { select: { id: true, name: true } },
      assignee: { select: { name: true } },
      messages: {
        where: { internal: false },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { name: true } } },
      },
    },
  });
}

/** A ticket as staff see it: everything, plus the Sakha thread it came from. */
export function getStaffTicket(ticketId) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      raisedBy: PERSON,
      assignee: PERSON,
      clientAccount: { select: { id: true, name: true } },
      conversation: { select: { id: true, title: true, createdAt: true } },
      messages: { orderBy: { createdAt: 'asc' }, include: { author: PERSON } },
    },
  });
}

export const ticketSummarySelect = {
  id: true,
  number: true,
  subject: true,
  status: true,
  priority: true,
  category: true,
  source: true,
  lastActivityAt: true,
  createdAt: true,
};
