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

/**
 * One chat completion call, with bounded retry on transient failures.
 *
 * @param {{messages:Array, tools?:Array, model?:string, temperature?:number,
 *          maxTokens?:number, toolChoice?:string, signal?:AbortSignal}} opts
 */
export async function chatCompletion({
  messages,
  tools,
  model = config.groq.model,
  temperature = config.groq.temperature,
  maxTokens = config.groq.maxTokens,
  toolChoice,
  signal,
  maxRetries = 2,
} = {}) {
  if (!config.groq.configured) {
    throw unavailable(
      'Sakha is not connected to a language model yet. Add GROQ_API_KEY to your .env and restart.'
    );
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(tools?.length ? { tools, tool_choice: toolChoice ?? 'auto' } : {}),
  };

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const startedAt = Date.now();
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

        if (!retryable || attempt === maxRetries) throw lastError;

        // Respect Retry-After when the provider tells us how long to wait.
        const retryAfter = Number.parseFloat(res.headers.get('retry-after') ?? '');
        const waitMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 2 ** attempt * 500 + Math.random() * 250;

        logger.warn({ status: res.status, attempt, waitMs }, 'groq retryable failure');
        await sleep(Math.min(waitMs, 10_000));
        continue;
      }

      const json = await res.json();
      const choice = json.choices?.[0];
      if (!choice) throw new LlmError('Groq returned no choices', { body: JSON.stringify(json).slice(0, 500) });

      return {
        message: choice.message,
        finishReason: choice.finish_reason,
        usage: json.usage ?? null,
        model: json.model ?? model,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (err instanceof LlmError && !err.retryable) throw err;
      lastError = err;
      if (attempt === maxRetries) break;
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        logger.warn({ attempt }, 'groq request timed out, retrying');
      }
      await sleep(2 ** attempt * 500);
    }
  }

  logger.error({ err: lastError }, 'groq call failed after retries');
  throw unavailable(
    'Sakha is having trouble reaching her language model. Try again in a moment, or email hello@sakhaai.com.'
  );
}

/** Short, cheap completion for titles and query rewriting. */
export async function quickCompletion(prompt, { maxTokens = 60 } = {}) {
  const { message } = await chatCompletion({
    model: config.groq.fastModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens,
    maxRetries: 1,
  });
  return message?.content?.trim() ?? '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
