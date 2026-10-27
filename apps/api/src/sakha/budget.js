/**
 * Keeping a turn inside the provider's per-minute token allowance.
 *
 * Groq's free tier gives each model 8,000 tokens a minute, and a single request
 * that is too big can never succeed. The estimate here is deliberately crude —
 * four characters to a token over the serialised request — because it only has
 * to be safe, not exact, and a real tokenizer would be one more dependency.
 */

/** Rough token count of anything that will be sent: messages, tool schemas. */
export const estimateTokens = (value) => Math.ceil(JSON.stringify(value ?? '').length / 4);

/**
 * Drop the oldest history until `fixedTokens` plus the history fits `budget`.
 * The current question, system prompt and retrieved context are the fixed part;
 * old turns are the only thing that can go without changing the answer much.
 *
 * Never starts on an assistant message: a reply without its question reads to
 * the model as something it said unprompted.
 */
export function trimHistory(history, fixedTokens, budget) {
  const out = [...history];
  let total = fixedTokens + estimateTokens(out);
  while (out.length && total > budget) {
    total -= estimateTokens([out.shift()]);
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}
