/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Identity & Access Management.
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the module the brief is really about:
 *    • the super admin grants CMS access to the two admins,
 *    • the super admin creates new roles (employee, content editor, …),
 *    • nobody can grant themselves more than they already have.
 *
 *  Two invariants are enforced everywhere below:
 *    1. RANK — you may only administer roles and users strictly below your own
 *       rank. An admin cannot edit another admin, and cannot touch a super admin.
 *    2. NO ESCALATION — you may only grant permissions you personally hold.
 *       Without this, `iam.grant` alone would be equivalent to `*`.
 */

import express from 'express';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOGUE,
  SYSTEM_ROLES,
  expandPermissions,
  paginationSchema,
  permissionSatisfies,
  roleGrantSchema,
  roleSchema,
  userCreateSchema,
  userRolesSchema,
  userUpdateSchema,
} from '@sakha/shared';
import prisma from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { audit, scrub } from '../../lib/audit.js';
import { bumpUserVersion } from '../../lib/redis.js';
import { hashPassword, randomToken } from '../../lib/crypto.js';
import { canManageRank } from '../auth/permissions.js';
import { enqueueWelcome } from '../../jobs/queue.js';

const router = express.Router();

/** Refuse any grant the actor does not personally hold. */
function assertNoEscalation(req, requestedPermissions) {
  const held = req.auth.permissions ?? [];
  if (held.includes('*')) return;

  const overreach = requestedPermissions.filter((p) => !permissionSatisfies(held, p));
  if (overreach.length) {
    throw forbidden(
      'You can only grant permissions you hold yourself.',
      { wouldEscalate: overreach }
    );
  }
}

/** Refuse to act on a role at or above the actor's own rank. */
function assertCanManageRole(req, role) {
  if (req.auth.permissions?.includes('*')) return;
  if (!canManageRank(req.auth.rank, role.rank)) {
    throw forbidden(`You cannot administer the "${role.name}" role — it is at or above your own level.`);
  }
}

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ══════════════════════════════════════════════════════════════════════════════
//  Permission catalogue
// ══════════════════════════════════════════════════════════════════════════════

/** Powers the grant UI: grouped permissions with human labels. */
router.get(
  '/permissions',
  requirePermission('iam.roles.read'),
  asyncHandler(async (req, res) => {
    const held = req.auth.permissions ?? [];
    return res.json({
      catalogue: PERMISSION_CATALOGUE.map((group) => ({
        ...group,
        permissions: group.permissions.map((p) => ({
          ...p,
          // Tell the UI which boxes to disable, rather than letting an admin
          // tick something the server will then reject.
          grantable: held.includes('*') || permissionSatisfies(held, p.key),
        })),
      })),
      yourPermissions: expandPermissions(held),
    });
  })
);

// ══════════════════════════════════════════════════════════════════════════════
//  Roles
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  '/roles',
  requirePermission('iam.roles.read'),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      orderBy: [{ rank: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });

    return res.json({
      roles: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        rank: r.rank,
        isSystem: r.isSystem,
        userCount: r._count.users,
        permissions: r.permissions.map((p) => p.permission.key),
      })),
    });
  })
);

/** Create a custom role — "Content Editor", "Sales Intern", whatever is needed. */
router.post(
  '/roles',
  requirePermission('iam.roles.write'),
  validate(roleSchema),
  asyncHandler(async (req, res) => {
    const { name, description, rank, permissions } = req.body;
    const key = req.body.key ?? slugify(name);

    if (Object.values(SYSTEM_ROLES).includes(key)) {
      throw conflict(`"${key}" is a system role and cannot be recreated.`);
    }

    // A new role may never outrank its creator.
    if (!req.auth.permissions.includes('*') && rank >= req.auth.rank) {
      throw forbidden(`You cannot create a role at rank ${rank} — your own rank is ${req.auth.rank}.`);
    }

    assertNoEscalation(req, permissions);

    const unknown = permissions.filter((p) => p !== '*' && !ALL_PERMISSIONS.includes(p));
    if (unknown.length) throw badRequest('Unknown permissions.', { unknown });

    const permissionRows = await prisma.permission.findMany({ where: { key: { in: permissions } } });

    const role = await prisma.role.create({
      data: {
        key,
        name,
        description: description ?? null,
        rank,
        isSystem: false,
        permissions: { create: permissionRows.map((p) => ({ permissionId: p.id, grantedById: req.auth.userId })) },
      },
    });

    audit(req, {
      action: 'iam.roles.create',
      entity: 'Role',
      entityId: role.id,
      after: { key, name, rank, permissions },
    });

    return res.status(201).json({ ok: true, role });
  })
);

router.put(
  '/roles/:id',
  requirePermission('iam.roles.write'),
  validate(roleSchema.partial()),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) throw notFound('No such role.');
    assertCanManageRole(req, role);

    if (role.isSystem && (req.body.key || req.body.rank !== undefined)) {
      throw forbidden('A system role\'s key and rank are fixed.');
    }

    const updated = await prisma.role.update({
      where: { id: role.id },
      data: {
        name: req.body.name ?? role.name,
        description: req.body.description ?? role.description,
        ...(role.isSystem ? {} : { rank: req.body.rank ?? role.rank }),
      },
    });

    audit(req, {
      action: 'iam.roles.update',
      entity: 'Role',
      entityId: role.id,
      before: scrub(role),
      after: scrub(updated),
    });

    return res.json({ ok: true, role: updated });
  })
);

/**
 * Replace a role's permission set.
 *
 * This is the endpoint the brief's central requirement runs through: the super
 * admin ticks the CMS boxes for the Admin role, and both admins get CMS access.
 */
router.put(
  '/roles/:id/permissions',
  requirePermission('iam.grant'),
  validate(roleGrantSchema),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { permissions: { select: { permission: { select: { key: true } } } }, users: { select: { userId: true } } },
    });
    if (!role) throw notFound('No such role.');
    assertCanManageRole(req, role);

    if (role.key === SYSTEM_ROLES.SUPER_ADMIN) {
      throw forbidden('The super admin role always holds every permission. It cannot be reduced.');
    }

    const requested = [...new Set(req.body.permissions)];
    assertNoEscalation(req, requested);

    const unknown = requested.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (unknown.length) throw badRequest('Unknown permissions.', { unknown });

    const before = role.permissions.map((p) => p.permission.key);
    const permissionRows = await prisma.permission.findMany({ where: { key: { in: requested } } });

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: permissionRows.map((p) => ({
          roleId: role.id,
          permissionId: p.id,
          grantedById: req.auth.userId,
        })),
      }),
    ]);

    // Every holder of this role gets a new token version, so the change takes
    // effect on their very next request rather than up to 15 minutes later.
    await Promise.all(role.users.map((u) => bumpUserVersion(u.userId)));

    audit(req, {
      action: 'iam.grant',
      entity: 'Role',
      entityId: role.id,
      before: { permissions: before },
      after: { permissions: requested, affectedUsers: role.users.length },
    });

    return res.json({
      ok: true,
      role: role.key,
      permissions: requested,
      added: requested.filter((p) => !before.includes(p)),
      removed: before.filter((p) => !requested.includes(p)),
      usersAffected: role.users.length,
      message: 'Applied immediately — affected users do not need to sign in again.',
    });
  })
);

router.delete(
  '/roles/:id',
  requirePermission('iam.roles.delete'),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw notFound('No such role.');
    if (role.isSystem) throw forbidden('System roles cannot be deleted.');
    assertCanManageRole(req, role);
    if (role._count.users > 0) {
      throw conflict(`${role._count.users} user(s) still hold that role. Reassign them first.`);
    }

    await prisma.role.delete({ where: { id: role.id } });
    audit(req, { action: 'iam.roles.delete', entity: 'Role', entityId: role.id, before: scrub(role) });

    return res.json({ ok: true });
  })
);

// ══════════════════════════════════════════════════════════════════════════════
//  Users
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  '/users',
  requirePermission('iam.users.read'),
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const { page, limit, q } = req.query;
    const where = {
      deletedAt: null,
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          title: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          roles: { select: { role: { select: { key: true, name: true, rank: true } } } },
          grants: { select: { permission: { select: { key: true } }, expiresAt: true } },
          clientAccount: { select: { id: true, name: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return res.json({
      items: items.map((u) => ({
        ...u,
        roles: u.roles.map((r) => r.role),
        directGrants: u.grants.map((g) => g.permission.key),
      })),
      total,
      page,
      limit,
    });
  })
);

router.post(
  '/users',
  requirePermission('iam.users.write'),
  validate(userCreateSchema),
  asyncHandler(async (req, res) => {
    const { name, email, title, roleKeys, status } = req.body;

    const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });
    if (roles.length !== roleKeys.length) {
      throw badRequest('One or more of those roles does not exist.', {
        unknown: roleKeys.filter((k) => !roles.some((r) => r.key === k)),
      });
    }
    for (const role of roles) assertCanManageRole(req, role);

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw conflict('Someone already has an account with that email.');

    // No password given: create an invited account with an unguessable
    // placeholder. They must use the reset flow to set one.
    const password = req.body.password ?? randomToken(24);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        title: title ?? null,
        passwordHash: await hashPassword(password),
        status: req.body.password ? status : 'invited',
        roles: { create: roles.map((r) => ({ roleId: r.id, assignedById: req.auth.userId })) },
      },
    });

    audit(req, {
      action: 'iam.users.create',
      entity: 'User',
      entityId: user.id,
      after: { email, name, roles: roleKeys },
    });

    await enqueueWelcome(user.id);

    return res.status(201).json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, status: user.status },
      ...(req.body.password
        ? {}
        : { note: 'No password was set. Ask them to use "Forgot password" to choose one.' }),
    });
  })
);

router.put(
  '/users/:id',
  requirePermission('iam.users.write'),
  validate(userUpdateSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { roles: { select: { role: true } } },
    });
    if (!user || user.deletedAt) throw notFound('No such user.');

    // You may not edit someone whose highest role is at or above your own rank.
    const targetRank = Math.max(0, ...user.roles.map((r) => r.role.rank));
    if (!req.auth.permissions.includes('*') && !canManageRank(req.auth.rank, targetRank)) {
      throw forbidden('You cannot edit a user at or above your own level.');
    }

    // roleKeys is handled by its own endpoint; peel it off so it never reaches update().
    const { roleKeys: _ignoredRoleKeys, ...fields } = req.body;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: fields,
    });

    if (updated.status !== user.status) await bumpUserVersion(user.id);

    audit(req, {
      action: 'iam.users.update',
      entity: 'User',
      entityId: user.id,
      before: scrub({ name: user.name, title: user.title, status: user.status }),
      after: scrub({ name: updated.name, title: updated.title, status: updated.status }),
    });

    return res.json({ ok: true, user: { id: updated.id, name: updated.name, status: updated.status } });
  })
);

router.put(
  '/users/:id/roles',
  requirePermission('iam.users.write'),
  validate(userRolesSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { roles: { select: { role: true } } },
    });
    if (!user || user.deletedAt) throw notFound('No such user.');

    const currentRank = Math.max(0, ...user.roles.map((r) => r.role.rank));
    if (!req.auth.permissions.includes('*') && !canManageRank(req.auth.rank, currentRank)) {
      throw forbidden('You cannot change the roles of a user at or above your own level.');
    }

    const roles = await prisma.role.findMany({ where: { key: { in: req.body.roleKeys } } });
    if (roles.length !== req.body.roleKeys.length) throw badRequest('One or more of those roles does not exist.');
    for (const role of roles) assertCanManageRole(req, role);

    // The last super admin must not be able to demote themselves and lock
    // everyone out of the system.
    const wasSuper = user.roles.some((r) => r.role.key === SYSTEM_ROLES.SUPER_ADMIN);
    const willBeSuper = roles.some((r) => r.key === SYSTEM_ROLES.SUPER_ADMIN);
    if (wasSuper && !willBeSuper) {
      const superCount = await prisma.userRole.count({
        where: { role: { key: SYSTEM_ROLES.SUPER_ADMIN }, user: { deletedAt: null } },
      });
      if (superCount <= 1) {
        throw conflict('That is the only super admin. Promote someone else before removing this role.');
      }
    }

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: user.id } }),
      prisma.userRole.createMany({
        data: roles.map((r) => ({ userId: user.id, roleId: r.id, assignedById: req.auth.userId })),
      }),
    ]);

    await bumpUserVersion(user.id);

    audit(req, {
      action: 'iam.users.roles',
      entity: 'User',
      entityId: user.id,
      before: { roles: user.roles.map((r) => r.role.key) },
      after: { roles: req.body.roleKeys },
    });

    return res.json({ ok: true, roles: req.body.roleKeys, message: 'Applied immediately.' });
  })
);

/**
 * Grant permissions to ONE user, on top of their roles.
 *
 * This is the surgical version of the brief's requirement: give Malarvizhi CMS
 * access specifically, without every admin in the system inheriting it.
 */
router.put(
  '/users/:id/grants',
  requirePermission('iam.grant'),
  validate(roleGrantSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        roles: { select: { role: true } },
        grants: { select: { permission: { select: { key: true } } } },
      },
    });
    if (!user || user.deletedAt) throw notFound('No such user.');

    const targetRank = Math.max(0, ...user.roles.map((r) => r.role.rank));
    if (!req.auth.permissions.includes('*') && !canManageRank(req.auth.rank, targetRank)) {
      throw forbidden('You cannot grant permissions to a user at or above your own level.');
    }

    const requested = [...new Set(req.body.permissions)];
    assertNoEscalation(req, requested);

    const unknown = requested.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (unknown.length) throw badRequest('Unknown permissions.', { unknown });

    const before = user.grants.map((g) => g.permission.key);
    const rows = await prisma.permission.findMany({ where: { key: { in: requested } } });

    await prisma.$transaction([
      prisma.userGrant.deleteMany({ where: { userId: user.id } }),
      prisma.userGrant.createMany({
        data: rows.map((p) => ({
          userId: user.id,
          permissionId: p.id,
          grantedById: req.auth.userId,
          reason: req.body.reason ?? null,
        })),
      }),
    ]);

    await bumpUserVersion(user.id);

    audit(req, {
      action: 'iam.grant',
      entity: 'User',
      entityId: user.id,
      before: { directGrants: before },
      after: { directGrants: requested },
    });

    return res.json({
      ok: true,
      directGrants: requested,
      added: requested.filter((p) => !before.includes(p)),
      removed: before.filter((p) => !requested.includes(p)),
      message: `${user.name} has these permissions now — no sign-out needed.`,
    });
  })
);

router.delete(
  '/users/:id',
  requirePermission('iam.users.delete'),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { roles: { select: { role: true } } },
    });
    if (!user || user.deletedAt) throw notFound('No such user.');

    if (user.id === req.auth.userId) throw badRequest('You cannot deactivate your own account.');

    const targetRank = Math.max(0, ...user.roles.map((r) => r.role.rank));
    if (!req.auth.permissions.includes('*') && !canManageRank(req.auth.rank, targetRank)) {
      throw forbidden('You cannot deactivate a user at or above your own level.');
    }

    if (user.roles.some((r) => r.role.key === SYSTEM_ROLES.SUPER_ADMIN)) {
      const superCount = await prisma.userRole.count({
        where: { role: { key: SYSTEM_ROLES.SUPER_ADMIN }, user: { deletedAt: null } },
      });
      if (superCount <= 1) throw conflict('That is the only super admin. Promote someone else first.');
    }

    // Soft delete: the audit trail must keep referring to a real person.
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date(), status: 'suspended' },
    });
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await bumpUserVersion(user.id);

    audit(req, { action: 'iam.users.delete', entity: 'User', entityId: user.id, before: { email: user.email } });

    return res.json({ ok: true, message: `${user.name} has been deactivated and signed out everywhere.` });
  })
);

export default router;
