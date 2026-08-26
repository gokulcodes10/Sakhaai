/**
 * Splits documents into retrieval chunks.
 *
 * Chunking is boundary-aware: it prefers to break at a markdown heading, then a
 * paragraph, then a sentence, and only falls back to a hard cut mid-sentence
 * when a single sentence is longer than the whole budget. A chunk that ends
 * mid-thought retrieves badly and reads worse when it is quoted back to a user.
 */

/** Rough token estimate. ~4 characters per token holds well enough for English. */
export const estimateTokens = (text) => Math.ceil(text.length / 4);

const HEADING = /^#{1,6}\s+.+$/;

/**
 * @param {string} text
 * @param {{maxTokens?:number, overlapTokens?:number, title?:string}} opts
 * @returns {Array<{content:string, ordinal:number, tokens:number, heading:string|null}>}
 */
export function chunkText(text, { maxTokens = 350, overlapTokens = 60, title = null } = {}) {
  const clean = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!clean) return [];

  const maxChars = maxTokens * 4;
  const overlapChars = Math.min(overlapTokens * 4, Math.floor(maxChars / 2));

  // Split into blocks, remembering the most recent heading for each one so a
  // retrieved chunk can tell the model which section it came from.
  const lines = clean.split('\n');
  const blocks = [];
  let currentHeading = title;
  let buffer = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) blocks.push({ heading: currentHeading, body });
    buffer = [];
  };

  for (const line of lines) {
    if (HEADING.test(line.trim())) {
      flush();
      currentHeading = line.replace(/^#{1,6}\s+/, '').trim();
      buffer.push(line);
    } else if (line.trim() === '') {
      buffer.push('');
    } else {
      buffer.push(line);
    }
  }
  flush();

  const chunks = [];
  let pending = '';
  let pendingHeading = currentHeading;

  const push = (content, heading) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      content: trimmed,
      ordinal: chunks.length,
      tokens: estimateTokens(trimmed),
      heading: heading ?? null,
    });
  };

  for (const block of blocks) {
    // A block that fits inside the remaining budget joins the current chunk.
    if (pending.length + block.body.length + 2 <= maxChars) {
      pending = pending ? `${pending}\n\n${block.body}` : block.body;
      pendingHeading = pending === block.body ? block.heading : pendingHeading;
      continue;
    }

    if (pending) {
      push(pending, pendingHeading);
      // Carry the tail of the previous chunk forward so a fact that straddles a
      // boundary is still retrievable from at least one whole chunk.
      pending = overlapChars > 0 ? tailOf(pending, overlapChars) : '';
    }

    if (block.body.length <= maxChars) {
      pending = pending ? `${pending}\n\n${block.body}` : block.body;
      pendingHeading = block.heading;
      continue;
    }

    // The block alone exceeds the budget: split it by sentence.
    pendingHeading = block.heading;
    for (const sentence of splitSentences(block.body)) {
      if (pending.length + sentence.length + 1 > maxChars) {
        push(pending, pendingHeading);
        pending = overlapChars > 0 ? tailOf(pending, overlapChars) : '';
      }
      // A single sentence longer than the budget gets hard-cut. Rare, and the
      // alternative is dropping it.
      if (sentence.length > maxChars) {
        for (let i = 0; i < sentence.length; i += maxChars) {
          push(sentence.slice(i, i + maxChars), pendingHeading);
        }
        pending = '';
      } else {
        pending = pending ? `${pending} ${sentence}` : sentence;
      }
    }
  }

  push(pending, pendingHeading);
  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z“"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Last `chars` characters, snapped forward to a sentence or word boundary. */
function tailOf(text, chars) {
  if (text.length <= chars) return text;
  const slice = text.slice(-chars);
  const sentenceStart = slice.search(/(?<=[.!?])\s+/);
  if (sentenceStart > -1 && sentenceStart < chars / 2) return slice.slice(sentenceStart).trim();
  const wordStart = slice.indexOf(' ');
  return wordStart > -1 ? slice.slice(wordStart + 1) : slice;
}

/**
 * Flatten the site content tree into readable documents.
 *
 * This is the piece that lets Sakha answer "what does a pilot include?" from
 * the same JSON the pricing page renders — one source of truth, so the page and
 * the assistant can never disagree.
 */
export function contentToDocuments(content) {
  const docs = [];
  const add = (key, title, lines, meta = {}) => {
    const body = lines.filter(Boolean).join('\n').trim();
    if (body) docs.push({ sourceKey: key, title, body, ...meta });
  };

  const c = content ?? {};

  add('company', 'Sakha AI — company overview', [
    `# Sakha AI (${c.company?.legalName ?? 'Sakha InfoTech'})`,
    c.company?.tagline && `Tagline: ${c.company.tagline}`,
    c.company?.elevatorPitch,
    c.company?.originLine && `Origin: ${c.company.originLine}`,
    c.company?.responsePromise && `Response promise: ${c.company.responsePromise}`,
    c.company?.email && `Email: ${c.company.email}`,
    c.company?.phone && `Phone: ${c.company.phone}`,
    c.company?.address &&
      `Location: ${[c.company.address.city, c.company.address.state, c.company.address.country].filter(Boolean).join(', ')}`,
  ], { sourceUrl: '/' });

  add('home', 'Homepage', [
    `# ${c.home?.hero?.headline ?? ''}`,
    c.home?.hero?.subhead,
    c.home?.hero?.assurance,
    c.home?.problem?.headline && `## ${c.home.problem.headline}`,
    c.home?.problem?.body,
    ...(c.home?.problem?.points ?? []).map((p) => `- ${p.title}: ${p.body}`),
    c.home?.howItWorks?.headline && `## ${c.home.howItWorks.headline}`,
    c.home?.howItWorks?.body,
    ...(c.home?.howItWorks?.steps ?? []).map((s) => `### ${s.day} — ${s.title}\n${s.body}`),
    c.home?.trustStrip?.items?.length &&
      `## What we promise\n${c.home.trustStrip.items.map((i) => `- ${i.text}`).join('\n')}`,
  ], { sourceUrl: '/' });

  for (const s of c.services?.items ?? []) {
    add(`service:${s.slug}`, `Service — ${s.name}`, [
      `# ${s.name}`,
      s.oneLiner,
      s.body,
      s.outcomes?.length && `## Outcomes\n${s.outcomes.map((o) => `- ${o}`).join('\n')}`,
      s.includes?.length && `## What's included\n${s.includes.map((o) => `- ${o}`).join('\n')}`,
      s.goodFitWhen && `## Good fit when\n${s.goodFitWhen}`,
      s.notAFitWhen && `## Not a fit when\n${s.notAFitWhen}`,
    ], { sourceUrl: `/services/${s.slug}` });
  }

  if (c.services?.reusableModules) {
    const m = c.services.reusableModules;
    add('services:modules', 'Reusable modules — why we are fast', [
      `# ${m.headline ?? 'Reusable modules'}`,
      m.body,
      m.modules?.length && m.modules.map((x) => `- ${x}`).join('\n'),
    ], { sourceUrl: '/services' });
  }

  for (const t of c.pricing?.tiers ?? []) {
    add(`pricing:${t.slug}`, `Pricing — ${t.name}`, [
      `# ${t.name} — ${t.priceDisplay ?? ''}`,
      t.tagline,
      t.duration && `Typical duration: ${t.duration}`,
      t.bestFor && `Best for: ${t.bestFor}`,
      t.includes?.length && `## Includes\n${t.includes.map((i) => `- ${i}`).join('\n')}`,
      t.notIncluded?.length && `## Not included\n${t.notIncluded.map((i) => `- ${i}`).join('\n')}`,
    ], { sourceUrl: '/pricing' });
  }

  if (c.pricing?.managed?.enabled) {
    add('pricing:managed', 'Pricing — after launch, managed plans', [
      `# ${c.pricing.managed.headline ?? 'Managed plans'}`,
      c.pricing.managed.body,
      ...(c.pricing.managed.plans ?? []).map(
        (p) => `## ${p.name} — ${p.price} ${p.priceNote ?? ''}\n${(p.includes ?? []).map((i) => `- ${i}`).join('\n')}`
      ),
    ], { sourceUrl: '/pricing' });
  }

  if (c.pricing?.faq?.length) {
    add('pricing:faq', 'Pricing — frequently asked questions',
      c.pricing.faq.map((f) => `## ${f.q}\n${f.a}`), { sourceUrl: '/pricing' });
  }

  for (const i of c.industries?.items ?? []) {
    if (i.published === false) continue;
    add(`industry:${i.slug}`, `Industry — ${i.name}`, [
      `# ${i.name}`,
      i.headline,
      i.workflow && `Workflow: ${i.workflow}`,
      i.metric && `Metric we track: ${i.metric}`,
      i.objection && `## Common objection\n${i.objection}\n\n${i.objectionAnswer ?? ''}`,
    ], { sourceUrl: `/industries/${i.slug}` });
  }

  for (const cs of c.work?.caseStudies ?? []) {
    if (!cs.published) continue;
    add(`case:${cs.slug}`, `Case study — ${cs.client}`, [
      `# ${cs.headline}`,
      `Client: ${cs.client}${cs.industry ? ` (${cs.industry})` : ''}`,
      cs.challenge && `## Challenge\n${cs.challenge}`,
      cs.approach && `## Approach\n${cs.approach}`,
      cs.metrics?.length &&
        `## Results\n${cs.metrics.map((m) => `- ${m.label}: ${m.value}${m.note ? ` (${m.note})` : ''}`).join('\n')}`,
    ], { sourceUrl: `/work/${cs.slug}` });
  }

  add('about', 'About Sakha AI', [
    `# ${c.about?.hero?.headline ?? 'About'}`,
    c.about?.hero?.subhead,
    c.about?.story?.headline && `## ${c.about.story.headline}`,
    ...(c.about?.story?.body ?? []),
    c.about?.principles?.length &&
      `## How we work\n${c.about.principles.map((p) => `### ${p.title}\n${p.body}`).join('\n\n')}`,
    c.about?.team?.length &&
      // Both the full title and the short form ("CEO & CTO") go in, because a
      // visitor asks "who is the CEO" and the page says "Chief Executive Officer".
      `## The team\n${c.about.team
        .map((t) => `- ${t.name} — ${t.role}${t.shortRole && t.shortRole !== t.role ? ` (${t.shortRole})` : ''}. ${t.bio ?? ''} Contact: ${t.email ?? ''}`)
        .join('\n')}`,
  ], { sourceUrl: '/about' });

  add('responsible-ai', 'Responsible deployment checklist and autonomy levels', [
    `# ${c.responsibleAi?.hero?.headline ?? 'Responsible deployment'}`,
    c.responsibleAi?.hero?.subhead,
    c.responsibleAi?.autonomyLevels?.length &&
      `## Autonomy levels\n${c.responsibleAi.autonomyLevels.map((l) => `- Level ${l.level} (${l.name}): ${l.description}`).join('\n')}`,
    c.responsibleAi?.checklist?.length &&
      `## Checklist\n${c.responsibleAi.checklist.map((i) => `- ${i.item} — ${i.why}`).join('\n')}`,
  ], { sourceUrl: '/responsible-ai' });

  add('contact', 'How to get in touch', [
    `# ${c.contact?.hero?.headline ?? 'Contact'}`,
    c.contact?.hero?.subhead,
    ...(c.contact?.alternatives ?? []).map((a) => `- ${a.label}: ${a.value}`),
  ], { sourceUrl: '/contact' });

  return docs;
}
