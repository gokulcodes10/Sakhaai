/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  The knowledge indexer — what keeps Sakha current.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Four sources, one pipeline:
 *    cms   — the live content tree (instant, on every publish)
 *    doc   — markdown files in content/knowledge and CMS-authored documents
 *    crawl — allowlisted public URLs, on the schedule
 *    db    — live counts and facts, so Sakha is never wrong about her own data
 *
 *  Every document carries a checksum. Unchanged documents are skipped entirely:
 *  no re-chunking, no re-embedding, no writes. That is what makes an hourly
 *  refresh affordable rather than theoretical.
 *
 *  The whole run holds a Redis lock, so scaling the API to several instances
 *  does not multiply the crawl traffic.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import config from '../config/index.js';
import { checksum } from '../lib/crypto.js';
import { withLock, cacheInvalidateTags } from '../lib/redis.js';
import { TAGS } from '../middleware/cache.js';
import { chunkText, contentToDocuments } from './chunker.js';
import { crawlSource } from './crawler.js';
import { embedBatch, embeddingsEnabled } from './embedder.js';
import { getPublishedContent } from '../modules/content/service.js';

const REPO_ROOT = path.resolve(process.cwd());

/**
 * Run a full or partial re-index.
 * @param {{trigger?:string, sources?:string[]}} opts
 */
export async function runIndex({ trigger = 'manual', sources = ['cms', 'doc', 'crawl', 'db'] } = {}) {
  return withLock('knowledge-index', 15 * 60, async () => {
    const run = await prisma.indexRun.create({
      data: { trigger, status: 'running', sources },
    });
    const startedAt = Date.now();

    const stats = { seen: 0, changed: 0, chunks: 0, errors: [] };

    try {
      if (sources.includes('cms')) await indexSource('cms', collectCmsDocuments, stats);
      if (sources.includes('doc')) await indexSource('doc', collectDocDocuments, stats);
      if (sources.includes('db')) await indexSource('db', collectDbDocuments, stats);
      if (sources.includes('crawl')) await indexSource('crawl', collectCrawlDocuments, stats);

      await cacheInvalidateTags(TAGS.KNOWLEDGE);

      const durationMs = Date.now() - startedAt;
      await prisma.indexRun.update({
        where: { id: run.id },
        data: {
          status: stats.errors.length ? 'partial' : 'ok',
          documentsSeen: stats.seen,
          documentsChanged: stats.changed,
          chunksWritten: stats.chunks,
          error: stats.errors.length ? stats.errors.join('\n').slice(0, 4000) : null,
          finishedAt: new Date(),
          durationMs,
        },
      });

      logger.info({ trigger, ...stats, durationMs }, 'knowledge index complete');
      return { runId: run.id, ...stats, durationMs };
    } catch (err) {
      await prisma.indexRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: String(err.stack ?? err.message).slice(0, 4000),
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      });
      logger.error({ err, trigger }, 'knowledge index failed');
      throw err;
    }
  });
}

/**
 * Index one source: collect its documents, upsert the changed ones, and remove
 * documents that have disappeared from the source since the last run.
 */
async function indexSource(source, collect, stats) {
  let documents = [];
  try {
    documents = await collect();
  } catch (err) {
    stats.errors.push(`${source}: ${err.message}`);
    logger.error({ err, source }, 'source collection failed');
    return;
  }

  const liveKeys = new Set();

  for (const doc of documents) {
    stats.seen += 1;
    liveKeys.add(doc.sourceKey);
    try {
      const written = await upsertDocument({ source, ...doc });
      if (written.changed) {
        stats.changed += 1;
        stats.chunks += written.chunks;
      }
    } catch (err) {
      stats.errors.push(`${source}/${doc.sourceKey}: ${err.message}`);
      logger.warn({ err: err.message, source, key: doc.sourceKey }, 'document index failed');
    }
  }

  // Prune: a service deleted in the CMS must stop being retrievable. Skipped
  // when a source yields nothing, so a transient crawl failure cannot wipe the
  // knowledge base.
  if (documents.length > 0) {
    const stale = await prisma.knowledgeDocument.findMany({
      where: { source, sourceKey: { notIn: [...liveKeys] } },
      select: { id: true, sourceKey: true },
    });
    if (stale.length) {
      await prisma.knowledgeDocument.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      logger.info({ source, pruned: stale.map((s) => s.sourceKey) }, 'pruned stale documents');
    }
  }
}

/** Upsert a document and rebuild its chunks only if the content actually changed. */
async function upsertDocument({ source, sourceKey, title, body, sourceUrl, tags = [], visibility = 'public' }) {
  const sum = checksum(`${title}\n${body}`);

  const existing = await prisma.knowledgeDocument.findUnique({
    where: { source_sourceKey: { source, sourceKey } },
    select: { id: true, checksum: true },
  });

  if (existing?.checksum === sum) {
    await prisma.knowledgeDocument.update({
      where: { id: existing.id },
      data: { indexedAt: new Date() },
    });
    return { changed: false, chunks: 0 };
  }

  const chunks = chunkText(body, {
    maxTokens: config.knowledge.chunkTokens,
    overlapTokens: config.knowledge.chunkOverlap,
    title,
  });

  const embeddings = embeddingsEnabled()
    ? await embedBatch(chunks.map((c) => `${title}\n${c.heading ?? ''}\n${c.content}`))
    : [];

  await prisma.$transaction(async (tx) => {
    const doc = await tx.knowledgeDocument.upsert({
      where: { source_sourceKey: { source, sourceKey } },
      create: { source, sourceKey, title, body, sourceUrl: sourceUrl ?? null, checksum: sum, tags, visibility, indexedAt: new Date() },
      update: { title, body, sourceUrl: sourceUrl ?? null, checksum: sum, tags, visibility, indexedAt: new Date() },
    });

    await tx.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });

    if (chunks.length) {
      await tx.knowledgeChunk.createMany({
        data: chunks.map((c, i) => ({
          documentId: doc.id,
          ordinal: c.ordinal,
          content: c.content,
          heading: c.heading,
          tokens: c.tokens,
          visibility,
          embedding: embeddings[i] ?? [],
        })),
      });
    }
  });

  return { changed: true, chunks: chunks.length };
}

// ── Source collectors ─────────────────────────────────────────────────────────

/** The live content tree, plus every published CMS page. */
async function collectCmsDocuments() {
  const content = await getPublishedContent({ fresh: true });
  const docs = contentToDocuments(content);

  const pages = await prisma.page.findMany({
    where: { status: 'published' },
    select: { slug: true, kind: true, title: true, summary: true, body: true, data: true },
  });

  for (const p of pages) {
    const body = [
      `# ${p.title}`,
      p.summary,
      p.body,
      p.data ? Object.entries(p.data).map(([kk, v]) => `${kk}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    docs.push({
      sourceKey: `page:${p.kind}:${p.slug}`,
      title: p.title,
      body,
      sourceUrl: p.kind === 'page' ? `/${p.slug}` : `/${p.kind}s/${p.slug}`,
    });
  }

  return docs;
}

/** Markdown files on disk, plus knowledge documents authored in the CMS. */
async function collectDocDocuments() {
  const docs = [];
  const dir = path.resolve(REPO_ROOT, config.knowledge.docsDir);

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(md|markdown|txt)$/i.test(entry.name)) continue;

      const parent = entry.parentPath ?? entry.path ?? dir;
      const full = path.join(parent, entry.name);
      const rel = path.relative(dir, full);
      const raw = await fs.readFile(full, 'utf8');
      const { meta, body } = parseFrontmatter(raw);

      docs.push({
        sourceKey: `file:${rel}`,
        title: meta.title ?? firstHeading(body) ?? entry.name.replace(/\.[^.]+$/, ''),
        body,
        sourceUrl: meta.url ?? null,
        tags: meta.tags ?? [],
        visibility: meta.visibility ?? 'public',
      });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    logger.debug({ dir }, 'knowledge docs directory not present, skipping');
  }

  // Documents an admin wrote directly in the CMS live in the same table but
  // with source 'manual'; re-project them so they are chunked identically.
  const manual = await prisma.knowledgeDocument.findMany({
    where: { source: 'manual' },
    select: { sourceKey: true, title: true, body: true, sourceUrl: true, tags: true, visibility: true },
  });
  for (const m of manual) {
    docs.push({ ...m, sourceKey: `manual:${m.sourceKey}` });
  }

  return docs;
}

/** Live facts from the database, so Sakha can never be stale about herself. */
async function collectDbDocuments() {
  const [publishedPages, caseStudyCount, industryCount, lastIndex, content] = await Promise.all([
    prisma.page.count({ where: { status: 'published' } }),
    prisma.page.count({ where: { status: 'published', kind: 'case_study' } }),
    prisma.page.count({ where: { status: 'published', kind: 'industry' } }),
    prisma.indexRun.findFirst({ where: { status: { in: ['ok', 'partial'] } }, orderBy: { startedAt: 'desc' } }),
    getPublishedContent(),
  ]);

  const cmsCaseStudies = (content?.work?.caseStudies ?? []).filter((c) => c.published).length;
  const cmsIndustries = (content?.industries?.items ?? []).filter((i) => i.published !== false).length;
  const services = (content?.services?.items ?? []).length;

  const body = [
    '# Live facts about Sakha AI',
    'These are read from the database at index time, not written by hand.',
    '',
    `- Services offered: ${services}`,
    `- Industry pages published: ${cmsIndustries + industryCount}`,
    `- Case studies published: ${cmsCaseStudies + caseStudyCount}`,
    `- Additional CMS pages published: ${publishedPages}`,
    `- Knowledge base last rebuilt: ${lastIndex?.finishedAt?.toISOString() ?? 'not yet'}`,
    `- Knowledge refresh cadence: every ${config.knowledge.refreshHours} hour(s), plus an immediate rebuild whenever content is published`,
  ].join('\n');

  return [{ sourceKey: 'live-facts', title: 'Live facts about Sakha AI', body, sourceUrl: null }];
}

/** Allowlisted public URLs. */
async function collectCrawlDocuments() {
  const sources = await prisma.crawlSource.findMany({ where: { enabled: true } });

  // Fall back to the env allowlist when nobody has configured sources in the CMS.
  const targets = sources.length
    ? sources
    : config.knowledge.crawlUrls.map((url) => ({ id: null, url, maxPages: 10 }));

  if (!targets.length) return [];

  const docs = [];

  for (const source of targets) {
    const { pages, error } = await crawlSource(source);

    if (source.id) {
      await prisma.crawlSource.update({
        where: { id: source.id },
        data: {
          lastCrawledAt: new Date(),
          lastStatus: error ? 'partial' : 'ok',
          lastError: error?.slice(0, 500) ?? null,
          pagesFound: pages.length,
        },
      });
    }

    for (const page of pages) {
      docs.push({
        sourceKey: `url:${page.url}`,
        title: page.title,
        body: page.text,
        sourceUrl: page.url,
        tags: ['crawl'],
      });
    }
  }

  return docs;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal YAML frontmatter: key: value, and key: [a, b] lists. */
export function parseFrontmatter(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m) return { meta: {}, body: raw };

  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!key) continue;
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      meta[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: raw.slice(m[0].length) };
}

const firstHeading = (body) => /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
