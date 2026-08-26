/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Retrieval for Sakha.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Hybrid lexical search over Postgres:
 *    • websearch_to_tsquery over a weighted tsvector (headings outrank body)
 *    • trigram similarity as a fallback for typos and partial words
 *  Scores are combined and de-duplicated per document so one long page cannot
 *  crowd out every other source.
 *
 *  Dense vector search is layered on top only when EMBEDDING_PROVIDER is set.
 *  The deliberate choice here: for a knowledge base of a few hundred chunks
 *  about one company, good lexical search is competitive with embeddings and
 *  costs nothing, needs no extra key, and cannot silently go stale.
 */

import prisma from '../lib/prisma.js';
import config from '../config/index.js';
import logger from '../lib/logger.js';
import { embedQuery, embeddingsEnabled } from './embedder.js';

/** Visibility a caller is allowed to retrieve, by role. */
export function visibilityFor(auth) {
  if (!auth?.isAuthenticated) return ['public'];
  const roles = auth.roles ?? [];
  if (roles.includes('super_admin') || roles.includes('admin') || roles.includes('employee')) {
    return ['public', 'client', 'internal'];
  }
  return ['public', 'client'];
}

/**
 * @param {string} query
 * @param {{topK?:number, visibility?:string[], sources?:string[]}} opts
 * @returns {Promise<Array<{id,documentId,title,content,heading,sourceUrl,source,score}>>}
 */
export async function retrieve(query, { topK = config.knowledge.topK, visibility = ['public'], sources } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];

  const lexical = await lexicalSearch(q, { topK: topK * 3, visibility, sources });

  let combined = lexical;

  if (embeddingsEnabled()) {
    try {
      const dense = await vectorSearch(q, { topK: topK * 3, visibility, sources });
      combined = fuseResults(lexical, dense);
    } catch (err) {
      logger.warn({ err: err.message }, 'vector search failed, using lexical only');
    }
  }

  // At most two chunks from any single document, so an answer draws on the
  // breadth of the knowledge base rather than one verbose page.
  const perDoc = new Map();
  const out = [];
  for (const row of combined) {
    const seen = perDoc.get(row.documentId) ?? 0;
    if (seen >= 2) continue;
    perDoc.set(row.documentId, seen + 1);
    out.push(row);
    if (out.length >= topK) break;
  }
  return out;
}

/**
 * English stopwords stripped before building the tsquery. Postgres would drop
 * these anyway, but filtering here means we can tell the difference between
 * "the query had no content words" and "the query matched nothing".
 */
const STOPWORDS = new Set(
  ('a an and are as at be but by can could do does for from get got has have how i if in into is it its may me my of on or our should so'
   + ' than that the their them then there these they this to us was we were what when where which who whom why will with would you your')
    .split(' ')
);

/**
 * Domain synonyms. A visitor asks "how much", the page says "pricing"; they ask
 * "who is the CEO", the page says "Chief Executive Officer". Lexical search has
 * no idea these are related, and this is cheaper and far more predictable than
 * reaching for embeddings to solve a twenty-word vocabulary problem.
 */
const SYNONYMS = {
  cost: ['price', 'pricing', 'fee', 'charge'],
  costs: ['price', 'pricing'],
  price: ['pricing', 'cost'],
  pricing: ['price', 'cost'],
  cheap: ['price', 'pricing'],
  budget: ['price', 'pricing', 'tier'],
  ceo: ['chief', 'executive', 'founder', 'gokul'],
  cto: ['chief', 'technology', 'founder', 'gokul'],
  cro: ['chief', 'research', 'sai'],
  founder: ['team', 'chief', 'gokul', 'malarvizhi', 'sai'],
  founders: ['team', 'chief'],
  team: ['founder', 'chief', 'people'],
  fast: ['speed', 'week', 'day', 'prototype', 'timeline'],
  quick: ['speed', 'week', 'day', 'prototype'],
  quickly: ['speed', 'week', 'day'],
  timeline: ['week', 'duration', 'day'],
  long: ['week', 'duration', 'timeline'],
  mistake: ['exception', 'error', 'wrong', 'human', 'review', 'guardrail'],
  mistakes: ['exception', 'error', 'review'],
  wrong: ['exception', 'escalation', 'human', 'review'],
  refuse: ['not', 'fit', 'wouldn', 'build'],
  wont: ['not', 'fit'],
  own: ['ownership', 'code', 'handover'],
  security: ['audit', 'access', 'pii', 'governance'],
  safe: ['governance', 'audit', 'guardrail', 'autonomy'],
  support: ['managed', 'maintenance', 'response'],
  whatsapp: ['channel', 'message', 'customer'],
  contact: ['email', 'phone', 'founder', 'touch'],
  hire: ['engagement', 'memo', 'contact'],
};

/** Turn a natural-language question into a safe, OR-based tsquery string. */
export function buildTsQuery(raw) {
  const words = String(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .slice(0, 12);

  if (!words.length) return { or: '', and: '', words: [] };

  const expanded = new Set(words);
  for (const w of words) {
    for (const syn of SYNONYMS[w] ?? []) expanded.add(syn);
  }

  // :* gives prefix matching, so "automat" finds "automation" and "automated"
  // without us having to guess which form the page used.
  const safe = (w) => `${w.replace(/[^a-z0-9]/g, '')}:*`;

  return {
    or: [...expanded].filter(Boolean).map(safe).join(' | '),
    and: words.map(safe).join(' & '),
    words,
  };
}

/**
 * Lexical retrieval.
 *
 * Two tsqueries are run against the same weighted vector:
 *   • an OR query over the question's content words plus their synonyms, which
 *     provides recall — this is what actually finds things;
 *   • an AND query over the original words only, which provides precision and
 *     is used purely as a ranking bonus.
 * Trigram similarity is added on top so a typo still lands somewhere sensible.
 */
async function lexicalSearch(q, { topK, visibility, sources }) {
  const vis = visibility.length ? visibility : ['public'];
  const { or, and, words } = buildTsQuery(q);

  if (!or) return [];

  try {
    const rows = await prisma.$queryRawUnsafe(
      `
      WITH params AS (
        SELECT
          to_tsquery('english', $1) AS or_q,
          CASE WHEN $2 = '' THEN NULL ELSE to_tsquery('english', $2) END AS and_q,
          $3::text AS raw
      )
      SELECT
        kc.id,
        kc."documentId",
        kc.content,
        kc.heading,
        kd.title,
        kd."sourceUrl",
        kd.source,
        (
          ts_rank_cd(kc.search_vector, params.or_q) * 6.0
          + CASE WHEN params.and_q IS NOT NULL AND kc.search_vector @@ params.and_q THEN 2.0 ELSE 0 END
          + similarity(kc.content, params.raw) * 1.5
          + similarity(kd.title, params.raw) * 2.5
        ) AS score
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc."documentId"
      CROSS JOIN params
      WHERE kc.visibility = ANY($4::text[])
        ${sources?.length ? 'AND kd.source = ANY($6::text[])' : ''}
        AND (
          kc.search_vector @@ params.or_q
          OR similarity(kc.content, params.raw) > 0.08
          OR similarity(kd.title, params.raw) > 0.15
        )
      ORDER BY score DESC
      LIMIT $5
      `,
      or,
      and,
      q,
      vis,
      topK,
      ...(sources?.length ? [sources] : [])
    );
    return rows.map((r) => ({ ...r, score: Number(r.score) }));
  } catch (err) {
    logger.warn({ err: err.message, words }, 'lexical search failed, falling back to ILIKE');
    return fallbackSearch(q, { topK, visibility: vis, sources });
  }
}

/**
 * Last resort when pg_trgm or the tsvector column is unavailable (a locked-down
 * managed Postgres, or a boot before the DDL ran). Crude, but the assistant
 * answers something grounded rather than nothing at all.
 */
async function fallbackSearch(q, { topK, visibility, sources }) {
  const terms = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);

  if (!terms.length) return [];

  const chunks = await prisma.knowledgeChunk.findMany({
    where: {
      visibility: { in: visibility },
      OR: terms.map((t) => ({ content: { contains: t, mode: 'insensitive' } })),
      ...(sources?.length ? { document: { source: { in: sources } } } : {}),
    },
    take: topK * 2,
    include: { document: { select: { title: true, sourceUrl: true, source: true } } },
  });

  return chunks
    .map((c) => {
      const hay = `${c.heading ?? ''} ${c.content}`.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0) / terms.length;
      return {
        id: c.id,
        documentId: c.documentId,
        content: c.content,
        heading: c.heading,
        title: c.document.title,
        sourceUrl: c.document.sourceUrl,
        source: c.document.source,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

async function vectorSearch(q, { topK, visibility, sources }) {
  const vec = await embedQuery(q);
  if (!vec) return [];

  // Cosine similarity in SQL. Chunk counts here are small enough that a
  // sequential scan is genuinely fine; swap in pgvector's <=> operator and an
  // HNSW index if the knowledge base ever grows past a few thousand chunks.
  const rows = await prisma.knowledgeChunk.findMany({
    where: {
      visibility: { in: visibility },
      ...(sources?.length ? { document: { source: { in: sources } } } : {}),
    },
    select: {
      id: true,
      documentId: true,
      content: true,
      heading: true,
      embedding: true,
      document: { select: { title: true, sourceUrl: true, source: true } },
    },
  });

  return rows
    .filter((r) => r.embedding?.length === vec.length)
    .map((r) => ({
      id: r.id,
      documentId: r.documentId,
      content: r.content,
      heading: r.heading,
      title: r.document.title,
      sourceUrl: r.document.sourceUrl,
      source: r.document.source,
      score: cosine(vec, r.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Reciprocal rank fusion. Rank-based rather than score-based, because a
 * ts_rank_cd value and a cosine similarity are not on the same scale and
 * normalising them is guesswork.
 */
function fuseResults(a, b, kConst = 60) {
  const scores = new Map();
  const meta = new Map();
  const add = (list) => {
    list.forEach((row, i) => {
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (kConst + i + 1));
      if (!meta.has(row.id)) meta.set(row.id, row);
    });
  };
  add(a);
  add(b);
  return [...scores.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([id, score]) => ({ ...meta.get(id), score }));
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Format retrieved chunks into the context block the model sees. */
export function formatContext(results) {
  if (!results.length) return '';
  return results
    .map((r, i) => {
      const where = r.sourceUrl ? ` (${r.sourceUrl})` : '';
      return `[${i + 1}] ${r.title}${r.heading && r.heading !== r.title ? ` › ${r.heading}` : ''}${where}\n${r.content}`;
    })
    .join('\n\n---\n\n');
}

/** Citations the UI renders under an answer. */
export function toCitations(results) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const key = r.sourceUrl ?? r.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: r.title, url: r.sourceUrl ?? null, source: r.source, heading: r.heading ?? null });
  }
  return out.slice(0, 5);
}
