import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import path from 'node:path';

import config from './config/index.js';
import logger from './lib/logger.js';
import prisma from './lib/prisma.js';
import { redisReady } from './lib/redis.js';
import { attachAuth } from './middleware/auth.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import authRoutes from './modules/auth/routes.js';
import contentRoutes from './modules/content/routes.js';
import sakhaRoutes from './modules/sakha/routes.js';
import leadRoutes from './modules/leads/routes.js';
import iamRoutes from './modules/roles/routes.js';
import knowledgeRoutes from './modules/knowledge/routes.js';
import portalRoutes from './modules/portal/routes.js';
import mediaRoutes from './modules/media/routes.js';
import auditRoutes from './modules/audit/routes.js';
import opsRoutes from './modules/ops/routes.js';

export function createApp() {
  const app = express();

  // Behind Nginx, req.ip must come from X-Forwarded-For or every rate limit
  // buckets the proxy instead of the visitor.
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ── Request id + logging ────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    req.id = req.get('x-request-id') ?? crypto.randomUUID();
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: {
        // Health checks every 15 seconds would drown everything else.
        ignore: (req) => req.url === '/api/health' || req.url === '/api/ready',
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  // ── Security headers ────────────────────────────────────────────────────────
  app.use(
    helmet({
      // The API serves JSON and uploaded files, never HTML with inline script,
      // so a strict default-src is safe here. The web app's CSP is set by Nginx.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin and server-to-server calls arrive without an Origin.
        if (!origin) return cb(null, true);
        if (config.corsOrigins.includes(origin)) return cb(null, true);
        logger.warn({ origin }, 'CORS rejected');
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After', 'X-Cache'],
      maxAge: 86400,
    })
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // ── Health ──────────────────────────────────────────────────────────────────

  /** Liveness: is the process up? Never touches a dependency. */
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', service: 'sakha-api', uptime: Math.floor(process.uptime()) })
  );

  /**
   * Readiness: can this instance actually serve? Postgres is required; Redis is
   * reported but not fatal, because the app is written to degrade without it.
   */
  app.get('/api/ready', async (_req, res) => {
    const checks = { database: false, redis: redisReady(), llm: config.groq.configured };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch (err) {
      logger.error({ err: err.message }, 'readiness: database check failed');
    }
    const ready = checks.database;
    return res.status(ready ? 200 : 503).json({ ready, checks });
  });

  // ── Auth context for every route below ──────────────────────────────────────
  app.use(attachAuth);
  app.use('/api', globalLimiter);

  // ── Uploaded files ──────────────────────────────────────────────────────────
  // In production Nginx serves these directly and never reaches Node.
  app.use(
    '/uploads',
    express.static(path.resolve(process.cwd(), config.uploads.dir), {
      maxAge: '30d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
    })
  );

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use('/api/auth', authRoutes);
  app.use('/api/content', contentRoutes);
  app.use('/api/sakha', sakhaRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/iam', iamRoutes);
  app.use('/api/knowledge', knowledgeRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/ops', opsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
