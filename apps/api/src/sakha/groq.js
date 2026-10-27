/**
 * Groq client. Uses the OpenAI-compatible chat completions endpoint, so
 * swapping provider later means changing a base URL and a model name.
 *
 * Everything here is written against `fetch` rather than a vendor SDK: one less
 * dependency to keep patched, and the request shape is worth being able to read.
 */

import config from '../config/index.js';
import logger from '../lib/logger.js';
import { unavailable } from '../lib/errors.js';

export class LlmError extends Error {
  constructor(message, { status, retryable = false, body } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.retryable = retryable;
    this.body = body;
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

// 429 is the per-minute limit; 413 is a single request bigger than that limit.
// Both are about capacity on this model, not about the request being wrong.
const CAPACITY_STATUS = new Set([413, 429]);

// The longest we will sit on a Retry-After. A visitor watching a spinner will
// not wait the 30 seconds Groq sometimes asks for; failing fast with an honest
// message beats an answer that arrives after they have closed the panel.
const MAX_WAIT_MS = 4_000;

/**
 * One chat completion call, with bounded retry on transient failures.
 *
 * When the model is out of capacity it switches to `fallbackModel` at once
 * rather than waiting: on Groq each model has its own per-minute allowance, so
 * the smaller model is usually free when the large one is not.
 *
 * With `onDelta`, the answer is streamed: each piece of text is passed to it as
 * it arrives, and the assembled message is returned at the end as usual.
 *
 * @param {{messages:Array, tools?:Array, model?:string, fallbackModel?:string,
 *          temperature?:number, maxTokens?:number, toolChoice?:string,
 *          onDelta?:(text:string)=>void, signal?:AbortSignal}} opts
 */
export async function chatCompletion({
  messages,
  tools,
  model = config.groq.model,
  fallbackModel = config.groq.fallbackModel,
  temperature = config.groq.temperature,
  maxTokens = config.groq.maxTokens,
  reasoningEffort,
  toolChoice,
  onDelta,
  signal,
  maxRetries = 2,
} = {}) {
  if (!config.groq.configured) {
    throw unavailable(
      'Sakha is not connected to a language model yet. Add GROQ_API_KEY to your .env and restart.'
    );
  }

  let current = model;
  const body = {
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(tools?.length ? { tools, tool_choice: toolChoice ?? 'auto' } : {}),
    ...(onDelta ? { stream: true } : {}),
  };

  let lastError;
  let busy = false;
  // Once text has reached the visitor, a retry would repeat it. Fail instead.
  let streamed = false;
  const emit = onDelta
    ? (text) => {
        streamed = true;
        onDelta(text);
      }
    : null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const startedAt = Date.now();
    body.model = current;
    try {
      const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.groq.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const text = await res.text();
        const retryable = RETRYABLE_STATUS.has(res.status);
        lastError = new LlmError(`Groq returned ${res.status}`, {
          status: res.status,
          retryable,
          body: text.slice(0, 800),
        });

        if (CAPACITY_STATUS.has(res.status)) {
          busy = true;
          if (fallbackModel && current !== fallbackModel) {
            logger.warn({ status: res.status, from: current, to: fallbackModel }, 'groq out of capacity, switching model');
            current = fallbackModel;
            continue;
          }
        }

        // Out of capacity on every model we may use: say "busy", not "broken".
        if (busy && !retryable) break;
        if (!retryable || attempt === maxRetries) throw lastError;

        // Respect Retry-After when the provider tells us how long to wait, but
        // only up to a point: past MAX_WAIT_MS, give up now rather than later.
        const retryAfter = Number.parseFloat(res.headers.get('retry-after') ?? '');
        const waitMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 2 ** attempt * 500 + Math.random() * 250;

        logger.warn({ status: res.status, model: current, attempt, waitMs }, 'groq retryable failure');
        if (waitMs > MAX_WAIT_MS) break;
        await sleep(waitMs);
        continue;
      }

      if (emit) {
        return { ...(await readStream(res, emit)), model: current, latencyMs: Date.now() - startedAt };
      }

      const json = await res.json();
      const choice = json.choices?.[0];
      if (!choice) throw new LlmError('Groq returned no choices', { body: JSON.stringify(json).slice(0, 500) });

      return {
        message: choice.message,
        finishReason: choice.finish_reason,
        usage: json.usage ?? null,
        model: json.model ?? current,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (err instanceof LlmError && !err.retryable) throw err;
      lastError = err;
      if (streamed || attempt === maxRetries) break;
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        logger.warn({ attempt }, 'groq request timed out, retrying');
      }
      await sleep(2 ** attempt * 500);
    }
  }

  logger.error({ err: lastError, busy }, 'groq call failed after retries');
  throw unavailable(
    busy
      ? 'Sakha is answering a lot of questions right now. Try again in a minute, or use the contact page to reach a founder.'
      : 'Sakha is having trouble reaching its language model. Try again in a moment, or use the contact page to reach a founder.'
  );
}

/**
 * Assemble a streamed (server-sent events) completion into the same shape a
 * normal call returns, passing text deltas on as they arrive. Tool calls come
 * in fragments keyed by index and are stitched back together.
 */
export async function readStream(res, onDelta) {
  const decoder = new TextDecoder();
  const message = { role: 'assistant', content: '', tool_calls: [] };
  let finishReason = null;
  let usage = null;
  let buffer = '';

  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const json = JSON.parse(data);
    if (json.error) throw new LlmError(json.error.message ?? 'Groq stream error', { retryable: true });
    usage = json.x_groq?.usage ?? json.usage ?? usage;
    const choice = json.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (delta.content) {
      message.content += delta.content;
      onDelta(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const call = (message.tool_calls[part.index ?? 0] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      handle(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
    }
  }
  handle(buffer.trim());

  message.tool_calls = message.tool_calls.filter(Boolean);
  if (!message.tool_calls.length) delete message.tool_calls;
  return { message, finishReason, usage };
}

/**
 * Short, cheap completion for titles and query rewriting.
 *
 * gpt-oss models reason before they answer, and the reasoning counts against
 * max_tokens: with a small cap they spend all of it thinking and return an
 * empty string (which is why conversation titles were always blank). So the
 * cap here leaves room for that, and reasoning is turned down where supported.
 */
export async function quickCompletion(prompt, { maxTokens = 300 } = {}) {
  const model = config.groq.fastModel;
  const { message } = await chatCompletion({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens,
    reasoningEffort: /gpt-oss/.test(model) ? 'low' : undefined,
    maxRetries: 1,
  });
  return message?.content?.trim() ?? '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
