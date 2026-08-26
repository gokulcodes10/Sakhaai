/**
 * Optional dense embeddings.
 *
 * Groq does not serve an embeddings endpoint, so rather than force a second
 * paid dependency on day one we ship lexical retrieval as the default and treat
 * embeddings as an upgrade. Set EMBEDDING_PROVIDER=openai to switch it on; the
 * indexer will backfill vectors on its next run.
 */

import config from '../config/index.js';
import logger from '../lib/logger.js';

export const embeddingsEnabled = () => config.embedding.enabled;

async function openaiEmbed(inputs) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.embedding.openaiKey}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: inputs }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`embedding request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

/** @returns {Promise<number[][]>} one vector per input, or [] when disabled. */
export async function embedBatch(inputs) {
  if (!embeddingsEnabled() || inputs.length === 0) return [];
  try {
    if (config.embedding.provider === 'openai') return await openaiEmbed(inputs);
    return [];
  } catch (err) {
    logger.warn({ err: err.message }, 'embedding batch failed');
    return [];
  }
}

/** @returns {Promise<number[]|null>} */
export async function embedQuery(text) {
  const [vec] = await embedBatch([text]);
  return vec ?? null;
}
