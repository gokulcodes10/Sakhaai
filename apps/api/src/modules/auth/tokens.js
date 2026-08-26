import jwt from 'jsonwebtoken';
import config from '../../config/index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import prisma from '../../lib/prisma.js';
import { getUserVersion } from '../../lib/redis.js';

const ACCESS_COOKIE = 'sakha_at';
const REFRESH_COOKIE = 'sakha_rt';
const VISITOR_COOKIE = 'sakha_vid';

export const COOKIES = { ACCESS: ACCESS_COOKIE, REFRESH: REFRESH_COOKIE, VISITOR: VISITOR_COOKIE };

/** Turn "15m" / "30d" / "3600" into seconds. */
export function ttlToSeconds(ttl) {
  if (typeof ttl === 'number') return ttl;
  const m = /^(\d+)\s*([smhd])?$/.exec(String(ttl).trim());
  if (!m) return 900;
  const n = Number.parseInt(m[1], 10);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] ?? 's'];
}

/**
 * Mint an access token. `ver` is the user's token version — bumping it in Redis
 * invalidates every token issued before the bump, which is how a role change or
 * a suspension takes effect immediately instead of up to 15 minutes later.
 */
export function signAccessToken({ userId, email, roles, permissions, version = 0 }) {
  const jti = randomToken(12);
  const token = jwt.sign(
    { sub: userId, email, roles, perms: permissions, ver: version, jti },
    config.auth.accessSecret,
    { expiresIn: config.auth.accessTtl, issuer: 'sakha-api', audience: 'sakha-web' }
  );
  return { token, jti, expiresIn: ttlToSeconds(config.auth.accessTtl) };
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.auth.accessSecret, {
    issuer: 'sakha-api',
    audience: 'sakha-web',
  });
}

/**
 * Issue a refresh token. Stored only as a SHA-256 hash, inside a rotation
 * family: if an already-used token is presented again we assume theft and
 * revoke the whole family rather than just that token.
 */
export async function issueRefreshToken({ userId, family, req }) {
  const raw = randomToken(48);
  const expiresAt = new Date(Date.now() + ttlToSeconds(config.auth.refreshTtl) * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      family: family ?? randomToken(12),
      expiresAt,
      ip: req?.ip?.slice(0, 60) ?? null,
      userAgent: req?.get?.('user-agent')?.slice(0, 400) ?? null,
    },
  });

  return { raw, expiresAt };
}

/**
 * Exchange a refresh token for a new one (rotation).
 * @returns {Promise<{ok:true, userId:string, raw:string, expiresAt:Date} | {ok:false, reason:string}>}
 */
export async function rotateRefreshToken(rawToken, req) {
  if (!rawToken) return { ok: false, reason: 'missing' };
  const hash = sha256(rawToken);

  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!existing) return { ok: false, reason: 'unknown' };

  if (existing.revokedAt) {
    // Reuse of a revoked token: someone has a copy they should not have.
    await prisma.refreshToken.updateMany({
      where: { family: existing.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: 'reuse_detected' };
  }

  if (existing.expiresAt < new Date()) return { ok: false, reason: 'expired' };

  const next = await issueRefreshToken({ userId: existing.userId, family: existing.family, req });

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedBy: sha256(next.raw) },
  });

  return { ok: true, userId: existing.userId, ...next };
}

export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ── Cookies ───────────────────────────────────────────────────────────────────

const baseCookie = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: config.isProd ? 'strict' : 'lax',
  domain: config.auth.cookieDomain,
  path: '/',
});

export function setAuthCookies(res, { accessToken, refreshToken, refreshExpiresAt }) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookie(),
    maxAge: ttlToSeconds(config.auth.accessTtl) * 1000,
  });
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...baseCookie(),
      // Scoped to the refresh endpoint only, so it is never sent on ordinary
      // API calls and cannot be stolen by an XSS that reads a response.
      path: '/api/auth',
      expires: refreshExpiresAt,
    });
  }
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie() });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: '/api/auth' });
}

export async function currentUserVersion(userId) {
  return getUserVersion(userId);
}
