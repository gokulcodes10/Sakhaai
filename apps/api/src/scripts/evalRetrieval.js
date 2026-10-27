/**
 * Score Sakha's retrieval against test/fixtures/retrieval-questions.json.
 *
 *   npm run sakha:eval-retrieval --workspace @asphalix/api
 *
 * Run it before and after changing the retriever, the synonyms or the
 * knowledge base. It reads the live index, so reindex first if content
 * changed. Reports:
 *   • hit@1 / hit@5 — an acceptable page ranked first / anywhere returned;
 *   • off-target — passages returned that were not an acceptable page;
 *   • no-answer — passages returned for questions the site cannot answer.
 * As of 2026-10-27: hit@1 20/24, hit@5 23/24, off-target 62.
 */
import { readFile } from 'node:fs/promises';
import prisma from '../lib/prisma.js';
import { retrieve } from '../knowledge/retriever.js';

const set = JSON.parse(await readFile(new URL('../../test/fixtures/retrieval-questions.json', import.meta.url), 'utf8'));

let hit1 = 0;
let hit5 = 0;
let offTarget = 0;
const misses = [];

for (const { q, expect } of set.answerable) {
  const results = await retrieve(q, { topK: 5, visibility: ['public'] });
  if (expect.includes(results[0]?.title)) hit1 += 1;
  if (results.some((r) => expect.includes(r.title))) hit5 += 1;
  else misses.push(`${q}  → ${results.map((r) => r.title).join(' | ') || '(nothing)'}`);
  offTarget += results.filter((r) => !expect.includes(r.title)).length;
}

const noAnswer = [];
for (const q of set.none) {
  const results = await retrieve(q, { topK: 5, visibility: ['public'] });
  noAnswer.push(`${results.length} for "${q}"`);
}

const n = set.answerable.length;
console.log(`  hit@1 ${hit1}/${n}   hit@5 ${hit5}/${n}   off-target ${offTarget}`);
console.log(`  no-answer: ${noAnswer.join(', ')}`);
for (const m of misses) console.log(`  miss: ${m}`);

await prisma.$disconnect();
