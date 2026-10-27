import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion } from '../src/sakha/groq.js';
import { estimateTokens, trimHistory } from '../src/sakha/budget.js';
import config from '../src/config/index.js';

// A stand-in for Groq: each call takes the next scripted response and records
// which model was asked for.
function scriptFetch(responses) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.model);
    const r = responses.shift();
    if (r.ok) {
      return new Response(
        JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }),
        { status: 200 }
      );
    }
    return new Response('{"error":{"code":"rate_limit_exceeded"}}', {
      status: r.status,
      headers: r.retryAfter ? { 'retry-after': String(r.retryAfter) } : {},
    });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

const opts = { messages: [{ role: 'user', content: 'hello' }], model: 'big', fallbackModel: 'small' };

test('a rate-limited model hands over to the fallback at once, without waiting', async (t) => {
  if (!config.groq.configured) return t.skip('needs GROQ_API_KEY set to any value');
  const groq = scriptFetch([{ status: 429, retryAfter: 30 }, { ok: true }]);
  try {
    const started = Date.now();
    const res = await chatCompletion(opts);
    assert.deepEqual(groq.calls, ['big', 'small']);
    assert.equal(res.model, 'small');
    assert.ok(Date.now() - started < 1_000, 'should not have waited for Retry-After');
  } finally {
    groq.restore();
  }
});

test('a request too large for the per-minute limit also falls back', async (t) => {
  if (!config.groq.configured) return t.skip('needs GROQ_API_KEY set to any value');
  const groq = scriptFetch([{ status: 413 }, { ok: true }]);
  try {
    const res = await chatCompletion(opts);
    assert.equal(res.model, 'small');
  } finally {
    groq.restore();
  }
});

test('when every model is busy it fails fast with a "busy" message, not a long wait', async (t) => {
  if (!config.groq.configured) return t.skip('needs GROQ_API_KEY set to any value');
  const groq = scriptFetch([{ status: 429, retryAfter: 30 }, { status: 429, retryAfter: 20 }]);
  try {
    const started = Date.now();
    await assert.rejects(chatCompletion(opts), (err) => {
      assert.equal(err.status, 503);
      assert.match(err.message, /a lot of questions/);
      assert.doesNotMatch(err.message, /@/, 'no email address while the domain is unconfirmed');
      return true;
    });
    assert.ok(Date.now() - started < 1_000, 'should not have waited for Retry-After');
    assert.deepEqual(groq.calls, ['big', 'small']);
  } finally {
    groq.restore();
  }
});

test('history is trimmed oldest-first to fit the budget, never starting on a reply', () => {
  const turn = (role, n) => ({ role, content: `${role} ${n} `.repeat(100) });
  const history = [turn('user', 1), turn('assistant', 1), turn('user', 2), turn('assistant', 2), turn('user', 3), turn('assistant', 3)];
  const fixed = 1_000;
  const budget = fixed + estimateTokens(history.slice(3)) + 10;

  const kept = trimHistory(history, fixed, budget);
  assert.ok(fixed + estimateTokens(kept) <= budget);
  assert.equal(kept[0].role, 'user');
  assert.deepEqual(kept.at(-1), history.at(-1), 'the most recent turn survives');

  assert.deepEqual(trimHistory(history, 0, 1e9), history, 'nothing is dropped when it fits');
  assert.deepEqual(trimHistory(history, 1e9, 1_000), [], 'everything goes when the fixed part alone is over');
});
