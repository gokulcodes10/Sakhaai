#!/usr/bin/env node
/**
 * Background worker process.
 *
 * Runs the knowledge indexer, the crawler and outbound mail. Deployed as a
 * separate container from the API (see docker-compose.yml) so that a long
 * re-index cannot add latency to a visitor's request.
 */

import { Worker } from 'bullmq';
import config from '../config/index.js';
import logger from '../lib/logger.js';
import { connectRedis, disconnectRedis, redis } from '../lib/redis.js';
import prisma, { disconnectPrisma } from '../lib/prisma.js';
import { JOBS, QUEUE_NAMES, installSchedules, closeQueues } from './queue.js';
import { runIndex } from '../knowledge/indexer.js';
import { ensureSearchInfrastructure } from '../knowledge/searchSetup.js';
import { sendLeadNotification, sendPasswordReset, sendWelcome } from '../lib/mailer.js';
import { getSetting } from '../modules/ops/settings.js';

const workerOpts = {
  connection: redis,
  prefix: `${config.redis.prefix}:bull`,
  // One re-index at a time. Concurrency here would mean two crawls of the same
  // site at once, which is exactly how a bot gets blocked.
  concurrency: 2,
};

async function main() {
  await connectRedis();
  await ensureSearchInfrastructure();

  const refreshHours = await getSetting('knowledge.refreshHours', config.knowledge.refreshHours);
  await installSchedules(refreshHours);

  const knowledgeWorker = new Worker(
    QUEUE_NAMES.KNOWLEDGE,
    async (job) => {
      if (job.name === JOBS.REINDEX || job.name === JOBS.CRAWL) {
        return runIndex({ trigger: job.data.trigger, sources: job.data.sources });
      }
      throw new Error(`Unknown knowledge job: ${job.name}`);
    },
    { ...workerOpts, concurrency: 1 }
  );

  const mailWorker = new Worker(
    QUEUE_NAMES.MAIL,
    async (job) => {
      switch (job.name) {
        case JOBS.LEAD_NOTIFICATION:
          return sendLeadNotification(job.data.leadId);
        case JOBS.WELCOME:
          return sendWelcome(job.data.userId);
        case JOBS.PASSWORD_RESET:
          return sendPasswordReset(job.data.userId, job.data.token);
        default:
          throw new Error(`Unknown mail job: ${job.name}`);
      }
    },
    workerOpts
  );

  const maintenanceWorker = new Worker(
    QUEUE_NAMES.MAINTENANCE,
    async (job) => {
      if (job.name === JOBS.PRUNE_TOKENS) {
        const { count } = await prisma.refreshToken.deleteMany({
          where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: new Date(Date.now() - 30 * 86400_000) } }] },
        });
        return { pruned: count };
      }
      if (job.name === JOBS.PRUNE_CONVERSATIONS) {
        // Anonymous threads older than 90 days. Signed-in history is kept.
        const cutoff = new Date(Date.now() - 90 * 86400_000);
        const { count } = await prisma.conversation.deleteMany({
          where: { userId: null, updatedAt: { lt: cutoff } },
        });
        return { pruned: count };
      }
      throw new Error(`Unknown maintenance job: ${job.name}`);
    },
    workerOpts
  );

  const workers = [knowledgeWorker, mailWorker, maintenanceWorker];

  for (const w of workers) {
    w.on('completed', (job, result) =>
      logger.info({ job: job.name, id: job.id, result }, 'job completed')
    );
    w.on('failed', (job, err) =>
      logger.error({ job: job?.name, id: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job failed')
    );
  }

  logger.info({ queues: Object.values(QUEUE_NAMES) }, '▸ Sakha worker running');

  // Warm the knowledge base on first boot so the assistant is useful the moment
  // the site comes up, rather than after the first scheduled run.
  const anyDocs = await prisma.knowledgeDocument.count();
  if (anyDocs === 0) {
    logger.info('knowledge base is empty — running an initial index');
    runIndex({ trigger: 'startup', sources: ['cms', 'doc', 'db'] }).catch((err) =>
      logger.error({ err }, 'startup index failed')
    );
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'worker shutting down');
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    await disconnectPrisma();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
