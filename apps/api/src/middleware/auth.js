import { permissionSatisfies, permissionSatisfiesAll, permissionSatisfiesAny } from '@sakha/shared';
import { forbidden, unauthorized } from '../lib/errors.js';
import { getUserVersion, isTokenRevoked } from '../lib/redis.js';
import { COOKIES, verifyAccessToken } from '../modules/auth/tokens.js';
import { resolveUserAccess } from '../modules/auth/permissions.js';
import { randomToken } from '../lib/crypto.js';
import config from '../config/index.js';

/**
 * Populates req.auth for every request. Never rejects — an anonymous visitor is
 * a first-class citizen here, because Sakha and the whole public site work
 * without an account. Use requireAuth / requirePermission to actually gate.
 *
 * req.auth = { userId, email, roles, permissions, rank, isAuthenticated }
 */
export async function attachAuth(req, res, next) {
  req.auth = {
    userId: null,
    email: null,
    roles: [],
    permissions: [],
    rank: 0,
    isAuthenticated: false,
  };

  // Give every visitor a stable, non-identifying id so an anonymous Sakha
  // conversation survives a page reload without us profiling anyone.
  let visitorId = req.cookies?.[COOKIES.VISITOR];
  if (!visitorId) {
    visitorId = randomToken(16);
    res.cookie(COOKIES.VISITOR, visitorId, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      domain: config.auth.cookieDomain,
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 180,
    });
  }
  req.visitorId = visitorId;

  const bearer = req.get('authorization');
  const token =
    (bearer?.startsWith('Bearer ') ? bearer.slice(7) : null) ?? req.cookies?.[COOKIES.ACCESS];

  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);

    if (payload.jti && (await isTokenRevoked(payload.jti))) return next();

    // Token version check: a role change or suspension bumps the user's
    // version, so tokens minted before that moment stop working at once.
    const currentVersion = await getUserVersion(payload.sub);
    if (currentVersion !== (payload.ver ?? 0)) {
      const fresh = await resolveUserAccess(payload.sub);
      if (fresh.inactive) return next();
      req.auth = {
        userId: payload.sub,
        email: payload.email,
        roles: fresh.roles,
        permissions: fresh.permissions,
        rank: fresh.rank,
        isAuthenticated: true,
        stale: true, // tells the client to refresh for an up-to-date token
      };
      return next();
    }

    req.auth = {
      userId: payload.sub,
      email: payload.email,
      roles: payload.roles ?? [],
      permissions: payload.perms ?? [],
      rank: payload.rank ?? 0,
      isAuthenticated: true,
      jti: payload.jti,
      exp: payload.exp,
    };
  } catch {
    // Expired or malformed token — treat as anonymous rather than erroring, so
    // a stale tab degrades to the public site instead of a wall of 401s.
  }

  return next();
}

export function requireAuth(req, _res, next) {
  if (!req.auth?.isAuthenticated) return next(unauthorized());
  return next();
}

/** Gate on one or more permissions. All must be satisfied. */
export function requirePermission(...required) {
  return (req, _res, next) => {
    if (!req.auth?.isAuthenticated) return next(unauthorized());
    if (!permissionSatisfiesAll(req.auth.permissions, required)) {
      return next(
        forbidden('You do not have permission to do that.', {
          required,
          missing: required.filter((r) => !permissionSatisfies(req.auth.permissions, r)),
        })
      );
    }
    return next();
  };
}

/** Gate on any one of several permissions. */
export function requireAnyPermission(...required) {
  return (req, _res, next) => {
    if (!req.auth?.isAuthenticated) return next(unauthorized());
    if (!permissionSatisfiesAny(req.auth.permissions, required)) {
      return next(forbidden('You do not have permission to do that.', { requiredAnyOf: required }));
    }
    return next();
  };
}

export function requireRole(...roleKeys) {
  return (req, _res, next) => {
    if (!req.auth?.isAuthenticated) return next(unauthorized());
    if (!req.auth.roles.some((r) => roleKeys.includes(r))) {
      return next(forbidden('That area is restricted.', { requiredRoles: roleKeys }));
    }
    return next();
  };
}

export const can = (req, permission) => permissionSatisfies(req.auth?.permissions ?? [], permission);
