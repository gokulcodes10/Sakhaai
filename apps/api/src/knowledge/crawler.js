/**
 * Polite public-web crawler.
 *
 * Fetches an allowlisted set of URLs so Sakha stays current with what the world
 * can see about the company — the live site, a Clutch profile, a LinkedIn page.
 * Deliberately conservative: robots.txt is honoured, requests are serialised
 * with a delay, only same-origin links are followed, and a per-source page cap
 * is enforced. A crawler that gets the company IP-banned is worse than no
 * crawler at all.
 */

import config from '../config/index.js';
import logger from '../lib/logger.js';

const DEFAULT_DELAY_MS = 800;

/** Minimal robots.txt parser: User-agent groups and Disallow/Allow rules. */
async function fetchRobots(origin) {
  try {
    const res = await fetch(new URL('/robots.txt', origin), {
      headers: { 'user-agent': config.knowledge.crawlUserAgent },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { disallow: [], allow: [] };
    return parseRobots(await res.text());
  } catch {
    // No robots.txt, or it did not load. Absence is permission, by convention.
    return { disallow: [], allow: [] };
  }
}

export function parseRobots(text) {
  const lines = String(text).split('\n');
  const groups = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const key = field.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'disallow' || key === 'allow') && current) {
      current.rules.push({ type: key, path: value });
    }
  }

  // Prefer a group naming us; otherwise the wildcard group.
  const ua = 'sakhabot';
  const mine =
    groups.find((g) => g.agents.some((a) => ua.includes(a) && a !== '*')) ??
    groups.find((g) => g.agents.includes('*'));

  return {
    disallow: (mine?.rules ?? []).filter((r) => r.type === 'disallow' && r.path).map((r) => r.path),
    allow: (mine?.rules ?? []).filter((r) => r.type === 'allow' && r.path).map((r) => r.path),
  };
}

export function robotsAllows(robots, pathname) {
  // Longest matching rule wins; Allow beats Disallow at equal length.
  let decision = true;
  let bestLength = -1;
  for (const p of robots.disallow) {
    if (pathname.startsWith(p) && p.length > bestLength) {
      bestLength = p.length;
      decision = false;
    }
  }
  for (const p of robots.allow) {
    if (pathname.startsWith(p) && p.length >= bestLength) {
      bestLength = p.length;
      decision = true;
    }
  }
  return decision;
}

/** Strip a fetched HTML document down to readable text. */
export function htmlToText(html) {
  let text = String(html);

  // Remove everything that is not prose.
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ');

  // Preserve document structure as markdown so the chunker can use headings.
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, inner) => `\n\n${'#'.repeat(Number(lvl))} ${strip(inner)}\n\n`);
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `\n- ${strip(inner)}`);
  text = text.replace(/<\/(p|div|section|article|tr|br)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  text = strip(text);

  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function strip(html) {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ');
}

export function extractTitle(html, fallback) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? strip(m[1]).trim().slice(0, 250) : fallback;
}

function extractLinks(html, baseUrl) {
  const out = new Set();
  const re = /<a\s[^>]*href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const url = new URL(m[1], baseUrl);
      url.hash = '';
      url.search = '';
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4|css|js|ico|woff2?)$/i.test(url.pathname)) continue;
      out.add(url.toString());
    } catch {
      /* malformed href */
    }
  }
  return [...out];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Crawl one source.
 * @param {{url:string, maxPages?:number}} source
 * @returns {Promise<{pages:Array<{url,title,text}>, error:string|null}>}
 */
export async function crawlSource(source) {
  const startUrl = new URL(source.url);
  const origin = startUrl.origin;
  const maxPages = Math.min(source.maxPages ?? 20, config.knowledge.crawlMaxPages);

  const robots = await fetchRobots(origin);
  const queue = [startUrl.toString()];
  const visited = new Set();
  const pages = [];
  let error = null;

  while (queue.length > 0 && pages.length < maxPages) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const url = new URL(current);
    if (!robotsAllows(robots, url.pathname)) {
      logger.debug({ url: current }, 'crawl skipped by robots.txt');
      continue;
    }

    try {
      const res = await fetch(current, {
        headers: { 'user-agent': config.knowledge.crawlUserAgent, accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(config.knowledge.crawlTimeoutMs),
      });

      if (!res.ok) {
        logger.debug({ url: current, status: res.status }, 'crawl page not ok');
        continue;
      }
      if (!String(res.headers.get('content-type') ?? '').includes('text/html')) continue;

      const html = await res.text();
      const text = htmlToText(html);

      // Pages with almost no prose are navigation shells, not knowledge.
      if (text.length > 200) {
        pages.push({ url: current, title: extractTitle(html, current), text });
      }

      // Only follow links within the same origin as the seed URL.
      for (const link of extractLinks(html, current)) {
        if (new URL(link).origin === origin && !visited.has(link) && queue.length < maxPages * 3) {
          queue.push(link);
        }
      }
    } catch (err) {
      error = err.message;
      logger.warn({ url: current, err: err.message }, 'crawl page failed');
    }

    await sleep(DEFAULT_DELAY_MS);
  }

  return { pages, error };
}
