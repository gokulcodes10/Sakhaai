/**
 * Which sources an answer actually drew on, and the clean-up of its text.
 *
 * Retrieval returns everything that might be relevant; the panel's "From" row
 * should show only what the answer used. Rather than trusting the model to
 * list its sources (it invents page names when asked), each retrieved passage
 * is checked against the answer's own wording: a source is shown when the
 * answer shares enough words with it that are rare across the site. Small
 * talk and refusals share none, so they show no sources at all.
 */

// The model's own citation syntax (gpt-oss writes 【1†L1-L9】), and bare
// passage numbers like [1] or [2, 3]. The panel shows sources separately.
const MARKERS = /\s?【[^】]*】|\s?\[\d+(?:\s*[,–-]\s*\d+)*\]/g;

/**
 * The same clean-up for text that arrives in pieces. A marker can be split
 * across two pieces, so text from an unclosed bracket onwards is held back
 * until it closes (or is clearly not a marker). The final saved answer is
 * cleaned again in full, so this only has to be good enough to look right.
 */
export function markerFilter() {
  let held = '';
  return {
    push(text) {
      held += text;
      const open = Math.max(held.lastIndexOf('【'), held.lastIndexOf('['));
      const closed = open !== -1 && /[】\]]/.test(held.slice(open));
      const cut = open !== -1 && !closed && held.length - open < 40 ? open : held.length;
      const out = held.slice(0, cut).replace(MARKERS, '');
      held = held.slice(cut);
      return out;
    },
    flush() {
      const out = held.replace(MARKERS, '');
      held = '';
      return out;
    },
  };
}

/** Remove citation markers the model writes into its prose. */
export function stripMarkers(text) {
  return String(text ?? '')
    .replace(MARKERS, '')
    .replace(/ +([.,;:!?])/g, '$1')
    .trim();
}

// Words too common on this site to show that a passage was used.
const IGNORE = new Set(
  ('about also asphalix sakha agent your ours their there these those which would could should with from that this have been were what when where will into than then them they more most such only very just like over each other some here does make made '
   + 'company team work build built help need want cannot dont youre were its').split(' ')
);

// Crude stemming, so "agents"/"agent" and "measured"/"measure" match.
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');

const words = (text) =>
  new Set(
    String(text ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => !IGNORE.has(w))
      .map(stem)
      .filter((w) => w.length >= 4 && !IGNORE.has(w))
  );

/**
 * How rare each word is across the knowledge base. Sharing "nginx" or "DRDO"
 * with a page says far more than sharing "call" or "founder", so each shared
 * word is weighted by inverse document frequency.
 *
 * @param {string[]} documents the full text of every indexed document
 */
export function wordStats(documents) {
  const df = new Map();
  for (const doc of documents) for (const w of words(doc)) df.set(w, (df.get(w) ?? 0) + 1);
  return { df, n: documents.length };
}

// Tuned on the stored conversations: below this, the overlap is everyday words
// a refusal or a generic answer happens to share with a page.
export const MIN_SCORE = 12;
// A second source must be at least this fraction as well supported as the first.
const RELATIVE_SCORE = 0.5;

/**
 * Turn retrieved passages into citation candidates, one per page, carrying the
 * text of every passage from that page so usage can be checked later.
 */
export function candidatesFrom(results) {
  const byKey = new Map();
  for (const r of results) {
    const key = r.sourceUrl ?? r.title;
    const existing = byKey.get(key);
    if (existing) {
      existing.text += `\n${r.content}`;
    } else {
      byKey.set(key, { title: r.title, url: r.sourceUrl ?? null, source: r.source, heading: r.heading ?? null, text: r.content });
    }
  }
  return [...byKey.values()];
}

/**
 * The citations to show under `answer`, best-supported first, without their
 * text. Candidates without text came from a structured tool the model chose to
 * call (services, case studies) and are kept as they are.
 *
 * @param {string} answer
 * @param {Array} candidates from candidatesFrom, plus structured-tool citations
 * @param {{df:Map<string,number>, n:number}} stats from wordStats
 */
export function citationsUsed(answer, candidates, stats, { limit = 4 } = {}) {
  const idf = (w) => Math.log((stats.n + 1) / ((stats.df.get(w) ?? 0) + 0.5));
  const said = words(answer);
  const chosen = [];
  const scored = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = c.url ?? c.title;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.text === undefined) {
      chosen.push(c);
      continue;
    }
    const source = words(`${c.title} ${c.heading ?? ''} ${c.text}`);
    let score = 0;
    for (const w of said) if (source.has(w)) score += idf(w);
    scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const floor = Math.max(MIN_SCORE, (scored[0]?.score ?? 0) * RELATIVE_SCORE);
  for (const { c, score } of scored) if (score >= floor) chosen.push(c);
  return chosen.slice(0, limit).map(({ text: _text, ...citation }) => citation);
}
