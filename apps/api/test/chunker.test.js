import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, contentToDocuments, estimateTokens } from '../src/knowledge/chunker.js';

test('empty input produces no chunks', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText(null), []);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('short text stays as one chunk', () => {
  const chunks = chunkText('A short sentence about pricing.', { maxTokens: 350 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].ordinal, 0);
});

test('every chunk respects the token budget', () => {
  const long = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} about automation and agents.`).join(' ');
  const chunks = chunkText(long, { maxTokens: 100, overlapTokens: 20 });
  assert.ok(chunks.length > 1, 'long text should split');
  for (const c of chunks) {
    // Allow a small margin: the estimator is approximate by design.
    assert.ok(c.tokens <= 130, `chunk ${c.ordinal} was ${c.tokens} tokens`);
  }
});

test('ordinals are contiguous from zero', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i} of the document.`).join('\n\n');
  const chunks = chunkText(long, { maxTokens: 60 });
  chunks.forEach((c, i) => assert.equal(c.ordinal, i));
});

test('headings are carried onto their chunks', () => {
  const md = '# Pricing\n\nPilot costs a certain amount.\n\n## Managed plans\n\nMonthly support.';
  const chunks = chunkText(md, { maxTokens: 20, overlapTokens: 0 });
  const headings = chunks.map((c) => c.heading).filter(Boolean);
  assert.ok(headings.length > 0, 'at least one chunk should carry a heading');
});

test('a single over-long sentence is hard-split rather than dropped', () => {
  const monster = `${'word '.repeat(2000)}.`;
  const chunks = chunkText(monster, { maxTokens: 100 });
  assert.ok(chunks.length > 1);
  const rejoined = chunks.map((c) => c.content).join(' ');
  assert.ok(rejoined.length > monster.length * 0.5, 'content must not be lost');
});

test('contentToDocuments flattens the real content tree', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../../content/site-content.json', import.meta.url), 'utf8');
  const docs = contentToDocuments(JSON.parse(raw));

  assert.ok(docs.length >= 15, `expected many documents, got ${docs.length}`);

  const keys = docs.map((d) => d.sourceKey);
  assert.ok(keys.includes('company'));
  assert.ok(keys.includes('about'));
  assert.ok(keys.some((k) => k.startsWith('pricing:')));
  assert.ok(keys.some((k) => k.startsWith('service:')));

  // Every document must have real content, or it will pollute retrieval.
  for (const d of docs) {
    assert.ok(d.title, `${d.sourceKey} has no title`);
    assert.ok(d.body.trim().length > 20, `${d.sourceKey} has a near-empty body`);
  }

  // Source keys must be unique — the indexer upserts on (source, sourceKey).
  assert.equal(new Set(keys).size, keys.length, 'duplicate sourceKey found');
});

test('unpublished case studies are never indexed', async () => {
  const docs = contentToDocuments({
    work: {
      caseStudies: [
        { slug: 'live', client: 'A', headline: 'H', published: true, challenge: 'x'.repeat(40) },
        { slug: 'draft', client: 'B', headline: 'H2', published: false, challenge: 'y'.repeat(40) },
      ],
    },
  });
  const keys = docs.map((d) => d.sourceKey);
  assert.ok(keys.includes('case:live'));
  assert.ok(!keys.includes('case:draft'), 'an unpublished case study leaked into the knowledge base');
});

test('token estimate is monotonic', () => {
  assert.ok(estimateTokens('abcd') <= estimateTokens('abcdefgh'));
});
