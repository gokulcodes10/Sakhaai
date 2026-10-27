/**
 * Turning a follow-up into something search can use.
 *
 * "and the business side?" or "has he deployed anything?" retrieves nothing
 * useful on its own, and gluing the previous question onto every message drags
 * genuinely new questions off target. So the small model rewrites the latest
 * message as a standalone question, using the last exchange only to resolve
 * what "he", "it" or "and the…" refer to.
 */
import { quickCompletion } from './groq.js';

// What the rewrite sees of the previous answer. Enough to resolve a pronoun,
// cheap enough not to matter against the per-minute token allowance.
const PREVIOUS_ANSWER_CHARS = 400;

export function rewritePrompt({ previousQuestion, previousAnswer, message }) {
  return [
    "Turn the visitor's latest message into a short search query for a company's website.",
    'If it refers back to the earlier exchange ("he", "it", "that", "and the…", a bare noun), add the names and topics it refers to.',
    'If it already stands on its own or starts a new topic, return it unchanged.',
    'Reply with the query only, at most twelve words.',
    '',
    `Earlier question: ${previousQuestion}`,
    previousAnswer ? `Earlier answer (start): ${previousAnswer.slice(0, PREVIOUS_ANSWER_CHARS)}` : null,
    `Latest message: ${message}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * The query to pre-fetch context with. Falls back to the message as typed on
 * the first turn, or if the rewrite fails or returns something implausible —
 * a missing rewrite only costs recall, so it must never fail the turn.
 */
export async function searchQueryFor(message, history, { rewrite = quickCompletion } = {}) {
  const lastUser = history.findLastIndex((m) => m.role === 'user');
  if (lastUser === -1) return message;

  const previousAnswer = history.slice(lastUser + 1).find((m) => m.role === 'assistant')?.content;
  try {
    const query = (await rewrite(rewritePrompt({ previousQuestion: history[lastUser].content, previousAnswer, message })))
      .replace(/^["'“]|["'”]$/g, '')
      .trim();
    return query && query.length <= 300 ? query : message;
  } catch {
    return message;
  }
}

/**
 * Merge two ranked result lists, alternating between them and dropping
 * duplicates, up to `limit`. The first list leads, so the typed question's
 * best match always survives.
 */
export function interleave(first, second, limit) {
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < limit && (i < first.length || i < second.length); i += 1) {
    for (const row of [first[i], second[i]]) {
      if (row && !seen.has(row.id) && out.length < limit) {
        seen.add(row.id);
        out.push(row);
      }
    }
  }
  return out;
}
