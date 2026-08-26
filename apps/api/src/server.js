#!/usr/bin/env node
/**
 * API entry point.
 *
 * Boot order matters: Redis and the search DDL are established before the
 * listener opens, so the first request never races an uninitialised dependency.
 * Shutdown is graceful — in-flight requests finish before the process exits, or
 * we force it after 15 seconds rather than hanging a deploy forever.
 */

import config from './config/index.js';
import logger from './lib/logger.js';
import { createApp } from './app.js';
import prisma, { disconnectPrisma } from './lib/prisma.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { ensureSearchInfrastructure } from './knowledge/searchSetup.js';
import { closeQueues } from './jobs/queue.js';

async function main() {
  await connectRedis();

  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('postgres connected');
  } catch (err) {
    logger.fatal({ err: err.message }, 'cannot reach postgres — is it running? try `npm run infra:up`');
    process.exit(1);
  }

  await ensureSearchInfrastructure();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.env,
        site: config.siteUrl,
        llm: config.groq.configured ? config.groq.model : 'NOT CONFIGURED (set GROQ_API_KEY)',
        embeddings: config.embedding.enabled ? config.embedding.provider : 'lexical only',
      },
      '▸ Sakha API listening'
    );
  });

  // Slowloris protection: a client that dawdles over its headers is dropped.
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 65_000;

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 15_000);
    force.unref();

    server.close(async () => {
      await Promise.allSettled([closeQueues(), disconnectPrisma(), disconnectRedis()]);
      clearTimeout(force);
      logger.info('shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception — exiting');
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
