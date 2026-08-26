/**
 * BullMQ queues.
 *
 * Producers only. The consumers live in worker.js, which runs as its own
 * process (and its own container in production) so a fifteen-minute crawl can
 * never compete with request handling for the API's event loop.
 *
 * Every enqueue is fault-tolerant: if Redis is unavailable the job is dropped
 * with a warning rather than failing the user-facing action that triggered it.
 * A publish must succeed even when the re-index cannot be scheduled — the next
 * scheduled run will pick the change up.
 */

import { Queue } from 'bullmq';
import config from '../config/index.js';
import logger from '../lib/logger.js';
import { redis } from '../lib/redis.js';

export const QUEUE_NAMES = {
  KNOWLEDGE: 'sakha-knowledge',
  MAIL: 'sakha-mail',
  MAINTENANCE: 'sakha-maintenance',
};

export const JOBS = {
  REINDEX: 'knowledge:reindex',
  CRAWL: 'knowledge:crawl',
  LEAD_NOTIFICATION: 'mail:lead-notification',
  WELCOME: 'mail:welcome',
  PASSWORD_RESET: 'mail:password-reset',
  PRUNE_TOKENS: 'maintenance:prune-tokens',
  PRUNE_CONVERSATIONS: 'maintenance:prune-conversations',
};

const connection = redis;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 200 },
  removeOnFail: { age: 86400 * 7 },
};

const queueOpts = { connection, prefix: `${config.redis.prefix}:bull`, defaultJobOptions };

export const knowledgeQueue = new Queue(QUEUE_NAMES.KNOWLEDGE, queueOpts);
export const mailQueue = new Queue(QUEUE_NAMES.MAIL, queueOpts);
export const maintenanceQueue = new Queue(QUEUE_NAMES.MAINTENANCE, queueOpts);

export const ALL_QUEUES = [knowledgeQueue, mailQueue, maintenanceQueue];

/** Wrap an enqueue so a Redis outage degrades instead of erroring. */
async function safeAdd(queue, name, data, opts) {
  try {
    return await queue.add(name, data, opts);
  } catch (err) {
    logger.warn({ err: err.message, job: name }, 'could not enqueue job — continuing without it');
    return null;
  }
}

/**
 * Ask for a knowledge rebuild.
 *
 * `jobId` deduplicates: several CMS publishes in the same minute collapse into
 * one re-index rather than queueing five identical crawls.
 */
export function enqueueReindex({ trigger = 'manual', sources = ['cms', 'doc', 'db'] } = {}) {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  return safeAdd(
    knowledgeQueue,
    JOBS.REINDEX,
    { trigger, sources },
    {
      // BullMQ rejects ':' in a custom id — it is the internal key separator.
      jobId: `reindex-${trigger}-${sources.join('_')}-${minuteBucket}`,
      // CMS publishes should feel instant; scheduled runs can wait a moment.
      priority: trigger === 'publish' ? 1 : 5,
    }
  );
}

export function enqueueLeadNotification(leadId) {
  return safeAdd(mailQueue, JOBS.LEAD_NOTIFICATION, { leadId }, { jobId: `lead-${leadId}` });
}

export function enqueueWelcome(userId) {
  return safeAdd(mailQueue, JOBS.WELCOME, { userId }, { jobId: `welcome-${userId}` });
}

export function enqueuePasswordReset(userId, token) {
  return safeAdd(mailQueue, JOBS.PASSWORD_RESET, { userId, token });
}

/**
 * Install the repeatable jobs. Called once by the worker at boot.
 * Existing schedulers with the same key are replaced, so changing the cadence
 * in the CMS takes effect on the next worker restart without leaving orphans.
 */
export async function installSchedules(refreshHours = config.knowledge.refreshHours) {
  const hours = Math.min(Math.max(Number(refreshHours) || 10, 1), 168);

  try {
    // Clear old repeatables so a changed cadence does not leave the previous
    // schedule running alongside the new one.
    for (const queue of [knowledgeQueue, maintenanceQueue]) {
      const repeatables = await queue.getRepeatableJobs();
      for (const r of repeatables) await queue.removeRepeatableByKey(r.key);
    }

    // Full rebuild, including the public-web crawl.
    await knowledgeQueue.add(
      JOBS.REINDEX,
      { trigger: 'schedule', sources: ['cms', 'doc', 'db', 'crawl'] },
      { repeat: { every: hours * 60 * 60 * 1000 }, jobId: 'reindex-scheduled' }
    );

    // Cheap sources every 15 minutes. This is what makes the assistant feel
    // live: a markdown file added to content/knowledge is answerable within
    // the quarter hour, without paying for a crawl each time.
    await knowledgeQueue.add(
      JOBS.REINDEX,
      { trigger: 'schedule', sources: ['cms', 'doc', 'db'] },
      { repeat: { every: 15 * 60 * 1000 }, jobId: 'reindex-light' }
    );

    await maintenanceQueue.add(
      JOBS.PRUNE_TOKENS,
      {},
      { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: 'prune-tokens' }
    );

    logger.info({ refreshHours: hours }, 'schedules installed');
  } catch (err) {
    logger.error({ err: err.message }, 'could not install schedules');
  }
}

export async function closeQueues() {
  await Promise.allSettled(ALL_QUEUES.map((q) => q.close()));
}
