/**
 * Runtime settings the super admin can change without a deploy: Sakha's system
 * prompt, which tools are enabled, the knowledge refresh cadence, feature flags.
 *
 * Cached in-process for a short TTL because getSetting sits on the hot path of
 * every assistant turn, and a settings row changes perhaps twice a month.
 */

import prisma from '../../lib/prisma.js';
import logger from '../../lib/logger.js';
import { cacheInvalidateTags } from '../../lib/redis.js';

const TTL_MS = 30_000;
const memo = new Map();

export async function getSetting(key, fallback = null) {
  const hit = memo.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    const value = row ? row.value : fallback;
    memo.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    logger.warn({ err: err.message, key }, 'setting read failed, using fallback');
    return fallback;
  }
}

export async function setSetting(key, value, { category = 'general', userId } = {}) {
  const row = await prisma.setting.upsert({
    where: { key },
    create: { key, value, category, updatedById: userId ?? null },
    update: { value, category, updatedById: userId ?? null },
  });
  memo.delete(key);
  await cacheInvalidateTags('settings');
  return row;
}

export async function listSettings(category) {
  return prisma.setting.findMany({
    where: category ? { category } : undefined,
    orderBy: { key: 'asc' },
  });
}

/** Drop the in-process memo — used after a bulk settings import. */
export const clearSettingsCache = () => memo.clear();
