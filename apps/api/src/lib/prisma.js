import { PrismaClient } from '@prisma/client';
import config from '../config/index.js';
import logger from './logger.js';

/**
 * A single Prisma client per process. `globalThis` caching keeps `node --watch`
 * from opening a new connection pool on every file save.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__sakhaPrisma ??
  new PrismaClient({
    log: config.isDev
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'error' }],
  });

prisma.$on?.('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
prisma.$on?.('error', (e) => logger.error({ prisma: e }, 'prisma error'));

if (!config.isProd) globalForPrisma.__sakhaPrisma = prisma;

export async function disconnectPrisma() {
  await prisma.$disconnect();
}

export default prisma;
