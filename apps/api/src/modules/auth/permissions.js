/**
 * Resolves the effective permission set for a user.
 *
 * Effective permissions = union of
 *   • every permission attached to every role the user holds, plus
 *   • every direct UserGrant that has not expired.
 *
 * The direct-grant path is what makes the brief's requirement work: the super
 * admin hands CMS access to Malarvizhi specifically, without promoting every
 * admin in the system to CMS editor.
 *
 * Cached in Redis and invalidated by bumpUserVersion(), which every mutation to
 * roles or grants calls — so a revoked permission stops working immediately.
 */

import { ANONYMOUS_PERMISSIONS, ROLE_RANK, SYSTEM_ROLES } from '@sakha/shared';
import prisma from '../../lib/prisma.js';
import { k, redis, redisReady } from '../../lib/redis.js';

const PERMS_TTL = 300;

export async function resolveUserAccess(userId) {
  if (!userId) {
    return { permissions: [...ANONYMOUS_PERMISSIONS], roles: [], rank: 0 };
  }

  if (redisReady()) {
    try {
      const cachedRaw = await redis.get(k.perms(userId));
      if (cachedRaw) return JSON.parse(cachedRaw);
    } catch {
      /* fall through to the database */
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      roles: {
        select: {
          role: {
            select: {
              key: true,
              rank: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      },
      grants: {
        select: { expiresAt: true, permission: { select: { key: true } } },
      },
    },
  });

  if (!user || user.deletedAt || user.status === 'suspended') {
    return { permissions: [], roles: [], rank: 0, inactive: true };
  }

  const permissions = new Set();
  const roles = [];
  let rank = 0;

  for (const { role } of user.roles) {
    roles.push(role.key);
    rank = Math.max(rank, role.rank ?? ROLE_RANK[role.key] ?? 0);
    for (const rp of role.permissions) permissions.add(rp.permission.key);
  }

  const now = Date.now();
  for (const g of user.grants) {
    if (g.expiresAt && g.expiresAt.getTime() < now) continue;
    permissions.add(g.permission.key);
  }

  // The super admin role is a wildcard regardless of what rows exist, so a
  // half-applied migration can never lock the owner out of their own system.
  if (roles.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
    permissions.add('*');
    rank = Math.max(rank, ROLE_RANK[SYSTEM_ROLES.SUPER_ADMIN]);
  }

  const access = { permissions: [...permissions], roles, rank };

  if (redisReady()) {
    redis.set(k.perms(userId), JSON.stringify(access), 'EX', PERMS_TTL).catch(() => {});
  }

  return access;
}

/**
 * Can `actor` administer a role at `targetRank`?
 * Strictly greater, so an admin can never edit another admin's permissions or
 * promote themselves. Only the super admin sits above every rank.
 */
export function canManageRank(actorRank, targetRank) {
  return actorRank > targetRank;
}
