import test from 'node:test';
import assert from 'node:assert/strict';
import { readStream } from '../src/sakha/groq.js';
import { markerFilter } from '../src/sakha/citations.js';
import { endOnSentence } from '../src/sakha/engine.js';

// A Response whose body arrives in the given raw pieces, split wherever the
// network happens to split it — mid-line included.
const sse = (pieces) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const p of pieces) controller.enqueue(new TextEncoder().encode(p));
        controller.close();
      },
    })
  );
const event = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

test('a streamed answer is passed on piece by piece and assembled', async () => {
  const body = [
    event({ choices: [{ delta: { role: 'assistant', content: 'Five ' } }] }),
    event({ choices: [{ delta: { content: 'days.' } }] }),
    event({ choices: [{ delta: {}, finish_reason: 'stop' }], x_groq: { usage: { prompt_tokens: 10, completion_tokens: 2 } } }),
    'data: [DONE]\n\n',
  ].join('');
  const pieces = [body.slice(0, 17), body.slice(17, 60), body.slice(60)];

  const deltas = [];
  const out = await readStream(sse(pieces), (t) => deltas.push(t));
  assert.deepEqual(deltas, ['Five ', 'days.']);
  assert.equal(out.message.content, 'Five days.');
  assert.equal(out.message.tool_calls, undefined);
  assert.equal(out.finishReason, 'stop');
  assert.deepEqual(out.usage, { prompt_tokens: 10, completion_tokens: 2 });
});

test('tool calls streamed in fragments are stitched back together', async () => {
  const out = await readStream(
    sse([
      event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_knowledge', arguments: '{"que' } }] } }] }),
      event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"team"}' } }] } }] }),
      event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ]),
    () => assert.fail('no text should be emitted for a tool call')
  );
  assert.equal(out.finishReason, 'tool_calls');
  assert.deepEqual(out.message.tool_calls, [
    { id: 'call_1', type: 'function', function: { name: 'search_knowledge', arguments: '{"query":"team"}' } },
  ]);
});

test('a marker split across pieces never reaches the visitor', () => {
  const f = markerFilter();
  const shown = ['Prototype by day 5', '【1†', 'L1-L9】', '. Production in weeks [', '2].', ' See [the page](/x).'].map((p) => f.push(p)).join('') + f.flush();
  assert.doesNotMatch(shown, /【|\[\d/);
  assert.match(shown, /Prototype by day 5/);
  assert.match(shown, /\[the page\]\(\/x\)/, 'ordinary brackets are released once they close');
});

test('a cut-off answer ends on its last whole sentence', () => {
  assert.equal(endOnSentence('One. Two is longer and it is cut off mid'), 'One.');
  assert.equal(endOnSentence('Complete answer.'), 'Complete answer.');
  assert.equal(endOnSentence('- first point\n- second point that stops'), '- first point');
  // No sentence end at all: keep what there is rather than nothing.
  assert.equal(endOnSentence('one long first sentence that never ends '), 'one long first sentence that never ends');
});
