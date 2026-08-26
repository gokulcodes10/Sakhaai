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
    subject: 'Your Sakha AI account',
    text: [
      `Hello ${user.name},`,
      '',
      'Your Sakha AI account is ready. You can sign in here:',
      `${config.siteUrl}/signin`,
      '',
      'Sakha, our assistant, can answer most questions about your projects once you are signed in — ask her anything.',
      '',
      'If something is wrong, reply to this email. A founder reads it.',
      '',
      '— Sakha AI',
    ].join('\n'),
  });
}

export async function sendPasswordReset(userId, token) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { sent: false };

  const url = `${config.siteUrl}/reset-password?token=${encodeURIComponent(token)}`;

  return sendMail({
    to: user.email,
    subject: 'Reset your Sakha AI password',
    text: [
      `Hello ${user.name},`,
      '',
      'Use this link to set a new password. It expires in one hour and works once:',
      url,
      '',
      'If you did not ask for this, ignore this email — nothing has changed.',
      '',
      '— Sakha AI',
    ].join('\n'),
  });
}
