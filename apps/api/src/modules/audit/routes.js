import express from 'express';
import { paginationSchema } from '@sakha/shared';
import prisma from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { validateQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';

const router = express.Router();

router.get(
  '/',
  requirePermission('ops.audit.read'),
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const { page, limit, q } = req.query;
    const { action, entity, actorId } = req.query;

    const where = {
      ...(action ? { action: { startsWith: action } } : {}),
      ...(entity ? { entity } : {}),
      ...(actorId ? { actorId } : {}),
      ...(q ? { OR: [{ actorEmail: { contains: q, mode: 'insensitive' } }, { action: { contains: q, mode: 'insensitive' } }] } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return res.json({ items, total, page, limit });
  })
);

/** Distinct action names, for the filter dropdown. */
router.get(
  '/actions',
  requirePermission('ops.audit.read'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.auditLog.groupBy({
      by: ['action'],
      _count: true,
      orderBy: { _count: { action: 'desc' } },
      take: 50,
    });
    return res.json({ actions: rows.map((r) => ({ action: r.action, count: r._count })) });
  })
);

export default router;
