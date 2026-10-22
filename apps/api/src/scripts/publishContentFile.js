/**
 * Publish content/site-content.json as a new content revision, the same way
 * the CMS publish button does (cache purge + Sakha re-index).
 *
 * Once the database is seeded the site reads the latest published revision,
 * not the file, so a release that changes the file needs this step:
 *
 *   npm run content:publish-file --workspace @asphalix/api -- "Asphalix rebrand"
 *
 * Refuses when the CMS draft has unpublished edits, so nobody's work in
 * progress is silently replaced. Pass --force to publish anyway.
 */
import { isDeepStrictEqual } from 'node:util';
import prisma from '../lib/prisma.js';
import { connectRedis, disconnectRedis } from '../lib/redis.js';
import { closeQueues } from '../jobs/queue.js';
import { getDraftContent, getPublishedContent, publishDraft, readSeedContent } from '../modules/content/service.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const message = args.find((a) => !a.startsWith('--')) ?? 'Published from content/site-content.json';

await connectRedis().catch(() => {});

const [draft, live, file] = await Promise.all([
  getDraftContent(),
  getPublishedContent({ fresh: true }),
  readSeedContent(),
]);

if (isDeepStrictEqual(live, file)) {
  console.log('  Live content already matches the file. Nothing to publish.');
} else if (!force && !isDeepStrictEqual(draft, live)) {
  console.error('  The CMS draft has unpublished edits. Publish or reset them first, or pass --force.');
  process.exitCode = 1;
} else {
  await prisma.contentDraft.update({ where: { id: 'singleton' }, data: { data: file } });
  const revision = await publishDraft({ userId: null, message });
  console.log(`  Published content revision ${revision.version}: ${message}`);
}

await closeQueues();
await prisma.$disconnect();
await disconnectRedis().catch(() => {});
