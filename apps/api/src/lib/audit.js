/**
 * Append-only audit trail.
 *
 * Deliberately fire-and-forget: an audit write must never fail the action it is
 * recording. A failure to log is logged, loudly, and the request continues.
 */

import prisma from './prisma.js';
import logger from './logger.js';

/**
 * @param {import('express').Request} req
 * @param {{action:string, entity?:string, entityId?:string, before?:any, after?:any}} entry
 */
export function audit(req, entry) {
  const row = {
    actorId: req?.auth?.userId ?? null,
    actorEmail: req?.auth?.email ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? undefined,
    after: entry.after ?? undefined,
    ip: req?.ip?.slice(0, 60) ?? null,
    userAgent: req?.get?.('user-agent')?.slice(0, 400) ?? null,
  };

  prisma.auditLog
    .create({ data: row })
    .catch((err) => logger.error({ err: err.message, entry: row }, 'AUDIT WRITE FAILED'));
}

/** Strip secrets before an object goes into before/after. */
export function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const key of ['passwordHash', 'password', 'tokenHash', 'apiKey', 'secret']) {
    if (key in out) out[key] = '[redacted]';
  }
  return out;
}
