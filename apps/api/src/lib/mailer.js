/**
 * Outbound email.
 *
 * When SMTP is not configured, messages are logged in full rather than silently
 * dropped — so a developer can see exactly what a client would have received,
 * and a misconfigured production box leaves evidence instead of a mystery.
 */

import nodemailer from 'nodemailer';
import config from '../config/index.js';
import logger from './logger.js';
import prisma from './prisma.js';

let transporter = null;

function getTransporter() {
  if (!config.mail.enabled) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: { user: config.mail.user, pass: config.mail.password },
  });
  return transporter;
}

export async function sendMail({ to, subject, text, html, replyTo }) {
  if (!to) return { sent: false, reason: 'no recipient' };

  const t = getTransporter();
  if (!t) {
    logger.info({ to, subject, preview: text?.slice(0, 500) }, '📧 EMAIL (not sent — SMTP not configured)');
    return { sent: false, reason: 'smtp not configured', logged: true };
  }

  try {
    const info = await t.sendMail({ from: config.mail.from, to, subject, text, html, replyTo });
    logger.info({ to, subject, messageId: info.messageId }, 'email sent');
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'email send failed');
    throw err;
  }
}

export async function sendLeadNotification(leadId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { sent: false, reason: 'lead not found' };

  const to = config.mail.leadsNotifyTo || config.mail.from;
  const viaAssistant = lead.source === 'sakha-assistant';

  const text = [
    `New enquiry${viaAssistant ? ' — captured by Sakha' : ''}`,
    '',
    `Name:     ${lead.name}`,
    `Email:    ${lead.email}`,
    lead.company ? `Company:  ${lead.company}` : null,
    lead.phone ? `Phone:    ${lead.phone}` : null,
    lead.budgetTier ? `Budget:   ${lead.budgetTier}` : null,
    `Source:   ${lead.source ?? 'website'}`,
    '',
    'The workflow they described:',
    lead.workflow,
    '',
    '---',
    'Reply within 24 hours. That promise is on the website.',
    `Open in the admin: ${config.siteUrl}/admin/leads/${lead.id}`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  return sendMail({
    to,
    replyTo: lead.email,
    subject: `New enquiry — ${lead.name}${lead.company ? ` (${lead.company})` : ''}`,
    text,
  });
}

export async function sendWelcome(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { sent: false };

  return sendMail({
    to: user.email,
    subject: 'Your Asphalix account',
    text: [
      `Hello ${user.name},`,
      '',
      'Your Asphalix account is ready. You can sign in here:',
      `${config.siteUrl}/signin`,
      '',
      'Sakha, our assistant, can answer most questions about your projects once you are signed in — ask it anything.',
      '',
      'If something is wrong, reply to this email. A founder reads it.',
      '',
      '— Asphalix',
    ].join('\n'),
  });
}

export async function sendPasswordReset(userId, token) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { sent: false };

  const url = `${config.siteUrl}/reset-password?token=${encodeURIComponent(token)}`;

  return sendMail({
    to: user.email,
    subject: 'Reset your Asphalix password',
    text: [
      `Hello ${user.name},`,
      '',
      'Use this link to set a new password. It expires in one hour and works once:',
      url,
      '',
      'If you did not ask for this, ignore this email — nothing has changed.',
      '',
      '— Asphalix',
    ].join('\n'),
  });
}

// ── Support tickets ──────────────────────────────────────────────────────────

const STATUS_LABEL = {
  open: 'Open',
  pending: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};

/**
 * One job type for every ticket email, so the queue stays small.
 * event: 'created' | 'staff-reply' | 'client-reply' | 'status'
 * Internal notes never produce an email — the service does not enqueue them.
 */
export async function sendTicketEmail({ ticketId, event, messageId }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      raisedBy: { select: { name: true, email: true } },
      assignee: { select: { email: true } },
      clientAccount: { select: { name: true } },
    },
  });
  if (!ticket) return { sent: false, reason: 'ticket not found' };

  const ref = `#${ticket.number}`;
  const requester = {
    name: ticket.raisedBy?.name ?? ticket.requesterName ?? 'there',
    email: ticket.raisedBy?.email ?? ticket.requesterEmail ?? null,
  };
  const team = config.mail.supportNotifyTo || config.mail.leadsNotifyTo || config.mail.from;
  const adminUrl = `${config.siteUrl}/admin/tickets/${ticket.id}`;
  // Visitors without an account have no portal to go to; they reply by email.
  const clientUrl = ticket.raisedBy ? `${config.siteUrl}/portal/tickets/${ticket.id}` : null;
  const message = messageId ? await prisma.ticketMessage.findUnique({ where: { id: messageId } }) : null;

  if (event === 'created') {
    const toTeam = sendMail({
      to: [team, ticket.assignee?.email].filter(Boolean).join(','),
      replyTo: requester.email ?? undefined,
      subject: `[${ticket.priority.toUpperCase()}] Ticket ${ref} — ${ticket.subject}`,
      text: [
        `New ticket ${ref}${ticket.source === 'sakha' ? ' — raised through Sakha' : ''}`,
        '',
        `From:      ${requester.name}${requester.email ? ` <${requester.email}>` : ''}`,
        ticket.clientAccount ? `Account:   ${ticket.clientAccount.name}` : 'Account:   (not a client account yet)',
        `Priority:  ${ticket.priority}`,
        ticket.category ? `Category:  ${ticket.category}` : null,
        '',
        ticket.body,
        '',
        '---',
        `Open in the admin: ${adminUrl}`,
      ]
        .filter((l) => l !== null)
        .join('\n'),
    });
    const toRequester = requester.email
      ? sendMail({
          to: requester.email,
          subject: `We have your request — ticket ${ref}`,
          text: [
            `Hello ${requester.name},`,
            '',
            `Your request "${ticket.subject}" is logged as ticket ${ref}. A person on the team will pick it up — you do not need to chase it.`,
            clientUrl ? `\nFollow it here: ${clientUrl}` : '\nReply to this email to add anything.',
            '',
            '— Asphalix support',
          ].join('\n'),
        })
      : Promise.resolve({ sent: false, reason: 'no requester email' });
    const [team_, requester_] = await Promise.all([toTeam, toRequester]);
    return { team: team_, requester: requester_ };
  }

  if (event === 'staff-reply') {
    if (!requester.email || !message) return { sent: false, reason: 'no recipient or message' };
    return sendMail({
      to: requester.email,
      replyTo: team,
      subject: `Re: ticket ${ref} — ${ticket.subject}`,
      text: [
        `Hello ${requester.name},`,
        '',
        message.body,
        '',
        clientUrl ? `Reply or follow the ticket here: ${clientUrl}` : 'Reply to this email to continue.',
        '',
        '— Asphalix support',
      ].join('\n'),
    });
  }

  if (event === 'client-reply') {
    if (!message) return { sent: false, reason: 'no message' };
    return sendMail({
      to: [team, ticket.assignee?.email].filter(Boolean).join(','),
      replyTo: requester.email ?? undefined,
      subject: `Client replied on ticket ${ref} — ${ticket.subject}`,
      text: [`${requester.name} wrote:`, '', message.body, '', '---', `Open in the admin: ${adminUrl}`].join('\n'),
    });
  }

  if (event === 'status') {
    if (!requester.email) return { sent: false, reason: 'no requester email' };
    return sendMail({
      to: requester.email,
      replyTo: team,
      subject: `Ticket ${ref} is now ${STATUS_LABEL[ticket.status]?.toLowerCase() ?? ticket.status}`,
      text: [
        `Hello ${requester.name},`,
        '',
        `Ticket ${ref} ("${ticket.subject}") is now: ${STATUS_LABEL[ticket.status] ?? ticket.status}.`,
        ticket.status === 'resolved'
          ? 'If it is not actually fixed, reply and it reopens — no need to raise a new one.'
          : null,
        clientUrl ? `\n${clientUrl}` : null,
        '',
        '— Asphalix support',
      ]
        .filter((l) => l !== null)
        .join('\n'),
    });
  }

  return { sent: false, reason: `unknown event ${event}` };
}
