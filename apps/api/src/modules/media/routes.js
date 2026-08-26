import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import prisma from '../../lib/prisma.js';
import config from '../../config/index.js';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

const router = express.Router();

const UPLOAD_ROOT = path.resolve(process.cwd(), config.uploads.dir);

/**
 * An allowlist, not a blocklist. Anything not named here is refused, so an
 * uploaded .svg (which can carry script) or .html never reaches the disk.
 */
const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: ${Object.keys(ALLOWED).join(', ')}`));
    }
    return cb(null, true);
  },
});

router.get(
  '/',
  requirePermission('cms.media.read'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit ?? '40', 10)));

    const [items, total] = await Promise.all([
      prisma.media.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { uploadedBy: { select: { id: true, name: true } } },
      }),
      prisma.media.count(),
    ]);

    return res.json({ items, total, page, limit });
  })
);

router.post(
  '/',
  requirePermission('cms.media.write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No file was uploaded.');

    const ext = ALLOWED[req.file.mimetype];
    // Filename is generated, never taken from the client — a client-supplied
    // name is a path traversal waiting to happen.
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const folder = /^[a-z0-9-]{1,40}$/.test(req.body?.folder ?? '') ? req.body.folder : 'uploads';

    const dir = path.join(UPLOAD_ROOT, folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), req.file.buffer);

    const media = await prisma.media.create({
      data: {
        filename,
        originalName: req.file.originalname.slice(0, 200),
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: `/uploads/${folder}/${filename}`,
        alt: req.body?.alt?.slice(0, 300) ?? null,
        folder,
        uploadedById: req.auth.userId,
      },
    });

    audit(req, { action: 'cms.media.write', entity: 'Media', entityId: media.id, after: { filename, size: media.size } });
    return res.status(201).json({ ok: true, media });
  })
);

router.delete(
  '/:id',
  requirePermission('cms.media.write'),
  asyncHandler(async (req, res) => {
    const media = await prisma.media.findUnique({ where: { id: req.params.id } });
    if (!media) throw notFound('No such file.');

    // Resolve and confirm the path stays inside the upload root before unlink.
    const target = path.resolve(UPLOAD_ROOT, media.folder, media.filename);
    if (target.startsWith(UPLOAD_ROOT)) {
      await fs.unlink(target).catch(() => {});
    }

    await prisma.media.delete({ where: { id: media.id } });
    audit(req, { action: 'cms.media.delete', entity: 'Media', entityId: media.id, before: { filename: media.filename } });

    return res.json({ ok: true });
  })
);

export default router;
