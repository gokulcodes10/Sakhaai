import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFrom, citationsUsed, stripMarkers, wordStats } from '../src/sakha/citations.js';

test("the model's citation markers never reach the visitor", () => {
  assert.equal(
    stripMarkers('A prototype in five days【1†L1-L9】【2†L1-L4】. Then production [1], in weeks [2, 3].'),
    'A prototype in five days. Then production, in weeks.'
  );
  assert.equal(stripMarkers('  Plain answer.  '), 'Plain answer.');
  assert.equal(stripMarkers(null), '');
});

// A miniature knowledge base: words that appear everywhere ("call", "founder")
// must not be enough to cite a page; words only one page has must be.
const pages = [
  {
    title: 'How we scope an engagement',
    sourceUrl: '/how-we-scope',
    content: 'Every engagement is scoped in a written build memo after a thirty-minute call with a founder. Scope depends on integrations, data quality and the autonomy level.',
  },
  {
    title: 'Gokul Madhesh — engineering record',
    sourceUrl: '/about/gokul-madhesh',
    content: 'Containerised deployment behind an nginx reverse proxy, GPU runtime configuration and air-gapped intranet deployment at DRDO. A call with a founder.',
  },
  { title: 'Homepage', sourceUrl: '/', content: 'Five days to a prototype, four to six weeks to production. Book a call with a founder.' },
  { title: 'Support', sourceUrl: '/support', content: 'Raise a ticket and a founder replies. Call us for an outage.' },
];
const stats = wordStats(pages.map((p) => `${p.title} ${p.content}`));
const candidates = candidatesFrom(pages.map((p) => ({ ...p, source: 'cms', heading: null })));

test('a refusal or small talk cites nothing', () => {
  assert.deepEqual(citationsUsed("I'm sorry, but I can't provide that.", candidates, stats), []);
  assert.deepEqual(citationsUsed('Hello! How can I help you today?', candidates, stats), []);
});

test('everyday words shared with a page are not enough to cite it', () => {
  const answer = 'I can arrange a call with a founder. Just share your name and email.';
  assert.deepEqual(citationsUsed(answer, candidates, stats), []);
});

test('an answer that draws on a page cites that page, and only that page', () => {
  const answer =
    'Gokul has run containerised deployments behind an nginx reverse proxy, with GPU runtime configuration, including air-gapped intranet deployment at DRDO.';
  const cited = citationsUsed(answer, candidates, stats);
  assert.deepEqual(cited.map((c) => c.url), ['/about/gokul-madhesh']);
  assert.equal(cited[0].text, undefined, 'passage text is never sent to the client');
});

test('a structured-tool citation the model asked for is kept', () => {
  const services = { title: 'What we build', url: '/services', source: 'cms', heading: null };
  assert.deepEqual(citationsUsed('We offer four services.', [services, ...candidates], stats), [services]);
});

test('several passages from one page become one candidate', () => {
  const merged = candidatesFrom([
    { title: 'A', sourceUrl: '/a', content: 'first', source: 'cms' },
    { title: 'A', sourceUrl: '/a', content: 'second', source: 'cms' },
  ]);
  assert.equal(merged.length, 1);
  assert.match(merged[0].text, /first\nsecond/);
});
