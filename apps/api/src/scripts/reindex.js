#!/usr/bin/env node
/** One-off knowledge rebuild from the command line. */

import logger from '../lib/logger.js';
import { connectRedis, disconnectRedis } from '../lib/redis.js';
import { disconnectPrisma } from '../lib/prisma.js';
import { ensureSearchInfrastructure } from '../knowledge/searchSetup.js';
import { runIndex } from '../knowledge/indexer.js';
import { closeQueues } from '../jobs/queue.js';

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const sources = requested.length ? requested : ['cms', 'doc', 'db'];

await connectRedis();
await ensureSearchInfrastructure();

try {
  const result = await runIndex({ trigger: 'manual', sources });
  logger.info(result, 'reindex finished');
} catch (err) {
  logger.error({ err }, 'reindex failed');
  process.exitCode = 1;
} finally {
  await closeQueues();
  await disconnectPrisma();
  await disconnectRedis();
}
