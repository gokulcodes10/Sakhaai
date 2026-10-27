import test from 'node:test';
import assert from 'node:assert/strict';
import { interleave, rewritePrompt, searchQueryFor } from '../src/sakha/followUp.js';

const history = [
  { role: 'user', content: "who's the lead tech person?" },
  { role: 'assistant', content: 'The technical lead is Gokul Madhesh, Founder & Chief Technology Officer.' },
];

test('the first message of a thread is searched as typed, with no model call', async () => {
  const query = await searchQueryFor('How fast can you go live?', [], {
    rewrite: () => assert.fail('should not call the model on the first turn'),
  });
  assert.equal(query, 'How fast can you go live?');
});

test('a follow-up is rewritten using the previous question and answer', async () => {
  let seen;
  const query = await searchQueryFor('business head?', history, {
    rewrite: async (prompt) => {
      seen = prompt;
      return '"business head CEO Asphalix"';
    },
  });
  assert.equal(query, 'business head CEO Asphalix', 'surrounding quotes are stripped');
  assert.match(seen, /Earlier question: who's the lead tech person\?/);
  assert.match(seen, /Earlier answer \(start\): The technical lead is Gokul Madhesh/);
  assert.match(seen, /Latest message: business head\?/);
});

test('a failed, empty or runaway rewrite falls back to the message as typed', async () => {
  for (const rewrite of [
    async () => {
      throw new Error('429');
    },
    async () => '',
    async () => 'x'.repeat(301),
  ]) {
    assert.equal(await searchQueryFor('business head?', history, { rewrite }), 'business head?');
  }
});

test('the rewrite prompt sends only the start of a long previous answer', () => {
  const prompt = rewritePrompt({ previousQuestion: 'q', previousAnswer: 'a'.repeat(5000), message: 'm' });
  assert.ok(prompt.length < 1200, `prompt is ${prompt.length} chars`);
});

test('interleave keeps the typed search first, alternates, and drops duplicates', () => {
  const r = (id) => ({ id });
  assert.deepEqual(
    interleave([r(1), r(2), r(3)], [r(9), r(1), r(8)], 4).map((x) => x.id),
    [1, 9, 2, 3]
  );
  assert.deepEqual(interleave([], [r(5)], 4).map((x) => x.id), [5]);
  assert.deepEqual(interleave([r(1)], [], 4).map((x) => x.id), [1]);
});
