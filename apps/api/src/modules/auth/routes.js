import express from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  SYSTEM_ROLES,
  USER_STATUS,
} from '@sakha/shared';
import prisma from '../../lib/prisma.js';
import logger from '../../lib/logger.js';
import config from '../../config/index.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { badRequest, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { hashPassword, needsRehash, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { bumpUserVersion, getUserVersion, revokeToken } from '../../lib/redis.js';
import { audit } from '../../lib/audit.js';
import { resolveUserAccess } from './permissions.js';
import {
  COOKIES,
  clearAuthCookies,
  issueRefreshToken,
  revokeAllUserTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  setAuthCookies,
  signAccessToken,
  ttlToSeconds,
} from './tokens.js';
import { enqueuePasswordReset, enqueueWelcome } from '../../jobs/queue.js';

const router = express.Router();

const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_MINUTES = 15;

/** The user shape the frontend receives. Never includes a hash. */
async function publicUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      title: true,
      company: true,
      phone: true,
      avatarUrl: true,
      status: true,
      lastLoginAt: true,
      clientAccountId: true,
      clientAccount: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!user) return null;
  const access = await resolveUserAccess(userId);
  return { ...user, roles: access.roles, permissions: access.permissions, rank: access.rank };
}

/** Mint an access token + rotate a refresh token and set both cookies. */
async function establishSession(res, req, userId, { family } = {}) {
  const access = await resolveUserAccess(userId);
  const version = await getUserVersion(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  const { token: accessToken } = signAccessToken({
    userId,
    email: user.email,
    roles: access.roles,
    permissions: access.permissions,
    version,
  });

  const refresh = await issueRefreshToken({ userId, family, req });

  setAuthCookies(res, {
    accessToken,
    refreshToken: refresh.raw,
    refreshExpiresAt: refresh.expiresAt,
  });

  return { accessToken, expiresIn: ttlToSeconds(config.auth.accessTtl) };
}

// ── Register ──────────────────────────────────────────────────────────────────

/**
 * Public signup creates a CLIENT account only. There is no path from this
 * endpoint to an admin role — staff accounts are created by a super admin.
 */
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, company, phone, website } = req.body;

    // Honeypot: a bot fills every field it finds.
    if (website) {
      logger.warn({ ip: req.ip }, 'signup honeypot triggered');
      return res.status(201).json({ ok: true }); // look identical to success
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // Do not confirm which addresses have accounts.
      logger.info({ email }, 'signup attempted for existing email');
      return res.status(201).json({
        ok: true,
        message: 'Check your email to continue.',
      });
    }

    const clientRole = await prisma.role.findUnique({ where: { key: SYSTEM_ROLES.CLIENT } });
    if (!clientRole) throw conflict('Signup is not available yet. Try again shortly.');

    const user = await prisma.user.create({
      data: {
        name,
        email,
        company: company || null,
        phone: phone || null,
        passwordHash: await hashPassword(password),
        status: USER_STATUS.ACTIVE,
        roles: { create: [{ roleId: clientRole.id }] },
      },
    });

    audit(req, { action: 'auth.register', entity: 'User', entityId: user.id });
    await enqueueWelcome(user.id);
    await establishSession(res, req, user.id);

    return res.status(201).json({ ok: true, user: await publicUser(user.id) });
  })
);

// ── Login ─────────────────────────────────────────────────────────────────────

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        deletedAt: true,
        failedLoginCount: true,
        lockedUntil: true,
      },
    });

    // Always do the password work, even for an unknown address, so response
    // time does not reveal whether the account exists.
    const ok = await verifyPassword(user?.passwordHash, password);

    if (!user || user.deletedAt) throw unauthorized('That email and password do not match.');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      throw forbidden(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
    }

    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed,
          lockedUntil:
            failed >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        },
      });
      audit(req, { action: 'auth.login.failed', entity: 'User', entityId: user.id });
      throw unauthorized('That email and password do not match.');
    }

    if (user.status === USER_STATUS.SUSPENDED) {
      throw forbidden('That account is suspended. Email hello@sakhaai.com if that is unexpected.');
    }

    // Upgrade the hash if our argon parameters have got stronger since signup.
    const updates = {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(user.status === USER_STATUS.INVITED ? { status: USER_STATUS.ACTIVE } : {}),
    };
    if (needsRehash(user.passwordHash)) updates.passwordHash = await hashPassword(password);
    await prisma.user.update({ where: { id: user.id }, data: updates });

    audit(req, { action: 'auth.login', entity: 'User', entityId: user.id });
    const session = await establishSession(res, req, user.id);

    return res.json({ ok: true, user: await publicUser(user.id), ...session });
  })
);

// ── Session ───────────────────────────────────────────────────────────────────

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.auth?.isAuthenticated) return res.json({ user: null });
    const user = await publicUser(req.auth.userId);
    if (!user) {
      clearAuthCookies(res);
      return res.json({ user: null });
    }
    return res.json({ user, stale: Boolean(req.auth.stale) });
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[COOKIES.REFRESH];
    const result = await rotateRefreshToken(raw, req);

    if (!result.ok) {
      clearAuthCookies(res);
      if (result.reason === 'reuse_detected') {
        logger.error({ ip: req.ip }, 'refresh token reuse detected — family revoked');
        throw unauthorized('Your session ended for security reasons. Please sign in again.');
      }
      throw unauthorized('Your session has expired. Please sign in again.');
    }

    const access = await resolveUserAccess(result.userId);
    if (access.inactive) {
      clearAuthCookies(res);
      throw forbidden('That account is no longer active.');
    }

    const version = await getUserVersion(result.userId);
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { email: true },
    });

    const { token: accessToken } = signAccessToken({
      userId: result.userId,
      email: user.email,
      roles: access.roles,
      permissions: access.permissions,
      version,
    });

    setAuthCookies(res, {
      accessToken,
      refreshToken: result.raw,
      refreshExpiresAt: result.expiresAt,
    });

    return res.json({
      ok: true,
      user: await publicUser(result.userId),
      expiresIn: ttlToSeconds(config.auth.accessTtl),
    });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[COOKIES.REFRESH];
    if (raw) await revokeRefreshToken(raw);

    // Blacklist the current access token for its remaining lifetime, so a
    // copied token cannot outlive the logout.
    if (req.auth?.jti && req.auth?.exp) {
      await revokeToken(req.auth.jti, req.auth.exp - Math.floor(Date.now() / 1000));
    }

    if (req.auth?.userId) audit(req, { action: 'auth.logout', entity: 'User', entityId: req.auth.userId });
    clearAuthCookies(res);
    return res.json({ ok: true });
  })
);

router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllUserTokens(req.auth.userId);
    await bumpUserVersion(req.auth.userId);
    audit(req, { action: 'auth.logout_all', entity: 'User', entityId: req.auth.userId });
    clearAuthCookies(res);
    return res.json({ ok: true });
  })
);

// ── Passwords ─────────────────────────────────────────────────────────────────

router.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { email: req.body.email },
      select: { id: true, deletedAt: true },
    });

    if (user && !user.deletedAt) {
      const token = randomToken(32);
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await enqueuePasswordReset(user.id, token);
      audit(req, { action: 'auth.password_reset_requested', entity: 'User', entityId: user.id });
    }

    // Identical response either way — never confirm which emails have accounts.
    return res.json({
      ok: true,
      message: 'If that address has an account, a reset link is on its way.',
    });
  })
);

router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const reset = await prisma.passwordReset.findUnique({
      where: { tokenHash: sha256(req.body.token) },
    });

    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw badRequest('That reset link has expired or already been used. Request a new one.');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash: await hashPassword(req.body.password),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    ]);

    // A password reset ends every existing session, everywhere.
    await revokeAllUserTokens(reset.userId);
    await bumpUserVersion(reset.userId);

    audit(req, { action: 'auth.password_reset', entity: 'User', entityId: reset.userId });
    return res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
  })
);

router.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { passwordHash: true },
    });

    if (!(await verifyPassword(user?.passwordHash, req.body.currentPassword))) {
      throw unauthorized('That is not your current password.');
    }

    await prisma.user.update({
      where: { id: req.auth.userId },
      data: { passwordHash: await hashPassword(req.body.newPassword) },
    });

    await revokeAllUserTokens(req.auth.userId);
    await bumpUserVersion(req.auth.userId);
    audit(req, { action: 'auth.password_changed', entity: 'User', entityId: req.auth.userId });

    // Re-establish this session so the user is not logged out of the tab they
    // just changed their password in.
    await establishSession(res, req, req.auth.userId);

    return res.json({ ok: true, message: 'Password updated. Other sessions have been signed out.' });
  })
);

export default router;
