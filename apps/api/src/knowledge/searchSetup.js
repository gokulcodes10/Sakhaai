/**
 * Search infrastructure that Prisma's schema language cannot express:
 * a generated tsvector column, a GIN index over it, and pg_trgm for fuzzy
 * matching. Idempotent — safe to run on every boot and from the seed script.
 */

import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';

const STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE EXTENSION IF NOT EXISTS unaccent`,

  // Weighted document vector: a heading match should outrank a body match,
  // so "pricing" finds the pricing chunk rather than every chunk mentioning it.
  `ALTER TABLE knowledge_chunks
     ADD COLUMN IF NOT EXISTS search_vector tsvector
     GENERATED ALWAYS AS (
       setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
       setweight(to_tsvector('english', coalesce(content, '')), 'B')
     ) STORED`,

  `CREATE INDEX IF NOT EXISTS knowledge_chunks_search_idx
     ON knowledge_chunks USING GIN (search_vector)`,

  `CREATE INDEX IF NOT EXISTS knowledge_chunks_trgm_idx
     ON knowledge_chunks USING GIN (content gin_trgm_ops)`,

  `CREATE INDEX IF NOT EXISTS knowledge_documents_title_trgm_idx
     ON knowledge_documents USING GIN (title gin_trgm_ops)`,
];

export async function ensureSearchInfrastructure() {
  for (const sql of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      // pg_trgm / unaccent need superuser on some managed Postgres tiers.
      // Lexical ranking still works without trigram, so warn rather than die.
      logger.warn({ err: err.message, sql: sql.slice(0, 60) }, 'search DDL skipped');
    }
  }
  logger.info('search infrastructure ready');
}

/** True when the generated tsvector column actually exists. */
export async function searchReady() {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_chunks' AND column_name = 'search_vector' LIMIT 1`
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
