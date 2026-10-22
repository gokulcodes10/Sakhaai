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
 * the same JSON the site renders — one source of truth, so the page and
 * the assistant can never disagree.
 */
export function contentToDocuments(content) {
  const docs = [];
  const add = (key, title, lines, meta = {}) => {
    const body = lines.filter(Boolean).join('\n').trim();
    if (body) docs.push({ sourceKey: key, title, body, ...meta });
  };

  const c = content ?? {};

  add('company', `${c.company?.brandName ?? 'Asphalix'} — company overview`, [
    `# ${c.company?.brandName ?? 'Asphalix'} (${c.company?.legalName ?? 'Asphalix'})`,
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

  // Prices are deliberately not indexed: Asphalix does not publish them, and
  // Sakha must not be able to quote one. See the "Prices — never" prompt rule.

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

  add('about', `About ${c.company?.brandName ?? 'Asphalix'}`, [
    `# ${c.about?.hero?.headline ?? 'About'}`,
    c.about?.hero?.subhead,
    c.about?.story?.headline && `## ${c.about.story.headline}`,
    ...(c.about?.story?.body ?? []),
    c.about?.principles?.length &&
      `## How we work\n${c.about.principles.map((p) => `### ${p.title}\n${p.body}`).join('\n\n')}`,
    c.about?.team?.length &&
      // Both the full title and the short form ("CEO & CTO") go in, because a
      // visitor asks "who is the CEO" and the page says "Chief Executive Officer".
      `## Founders' desk — the team\n${c.about.team
        .map((t) => `- ${t.name} — ${t.role}${t.shortRole && t.shortRole !== t.role ? ` (${t.shortRole})` : ''}. ${t.bio ?? ''} Contact: ${t.email ?? ''}`)
        .join('\n')}`,
  ], { sourceUrl: '/about' });

  // A founder's engineering record gets its own document, so "who builds your
  // agents?" or "has your team done on-premise LLMs?" retrieves the evidence
  // and links to the profile page rather than the About page in general.
  for (const t of (c.about?.team ?? []).filter((m) => m.record)) {
    const r = t.record;
    const src = (s) => r.sources?.[s] ?? s;
    add(`person:${t.slug}`, `${t.name} — ${t.role}: engineering record`, [
      `# ${t.name}, ${t.role}`,
      r.summary,
      r.lifecycle?.length &&
        `## Plan to production, stage by stage\n${r.lifecycle
          .map((s) => `### ${s.label}\n${s.summary}\n${(s.evidence ?? []).map((e) => `- ${e.text} (Source: ${src(e.source)})`).join('\n')}`)
          .join('\n\n')}`,
      r.projects?.length &&
        `## Projects\n${r.projects.map((p) => `- ${p.name} (${p.kind}): ${p.body}${p.stack?.length ? ` Stack: ${p.stack.join(', ')}.` : ''}`).join('\n')}`,
      r.timeline?.length &&
        `## Experience and education\n${r.timeline.map((e) => `- ${e.period}: ${e.title}, ${e.org}. ${e.body ?? ''}`).join('\n')}`,
      r.skills?.length && `## Skills\n${r.skills.map((g) => `- ${g.group}: ${g.items.join(', ')}`).join('\n')}`,
      r.reference?.quotes?.length &&
        `## Reference\n${r.reference.name}, ${r.reference.title}, wrote on ${r.reference.date}:\n${r.reference.quotes.map((q) => `> ${q}`).join('\n')}`,
      t.linkedin && `LinkedIn: ${t.linkedin}`,
      t.github && `GitHub: ${t.github}`,
    ], { sourceUrl: `/about/${t.slug}` });
  }

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
