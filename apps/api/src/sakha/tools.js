/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Sakha's tools — what makes her an agent rather than a chatbot.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Each tool declares an OpenAI-style JSON schema and a handler. Handlers are
 *  role-scoped: the tool list a visitor's turn is given depends on who they are,
 *  so an anonymous visitor is never even *offered* the tool that reads client
 *  projects. Authorisation is enforced again inside the handler, because a
 *  model that hallucinates a tool name must not be able to reach data.
 *
 *  Every tool returns a plain object which is serialised back to the model.
 *  Handlers never throw at the model: a failure becomes { error: "..." } so the
 *  conversation degrades into an honest apology rather than a 500.
 */

import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import config from '../config/index.js';
import { retrieve, toCitations, visibilityFor } from '../knowledge/retriever.js';
import { getPublishedContent } from '../modules/content/service.js';
import { leadSchema } from '@sakha/shared';

/**
 * @typedef {Object} SakhaTool
 * @property {string} name
 * @property {string} description
 * @property {object} parameters JSON schema
 * @property {(args:object, ctx:object) => Promise<object>} handler
 * @property {string[]} [requires] permissions needed; omit for public tools
 * @property {boolean} [authOnly]
 */

/** @type {SakhaTool[]} */
export const TOOLS = [
  // ── Retrieval ───────────────────────────────────────────────────────────────
  {
    name: 'search_knowledge',
    description:
      "Search Sakha AI's knowledge base — website content, services, pricing, case studies, policies, published documents and crawled public pages. Use this for almost every factual question about the company. Prefer several specific searches over one broad one.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look for. Use the visitor\'s own words plus any obvious synonyms.',
        },
        limit: { type: 'integer', description: 'How many passages to return (1-10).', default: 6 },
      },
      required: ['query'],
    },
    async handler({ query, limit = 6 }, ctx) {
      const results = await retrieve(query, {
        topK: Math.min(Math.max(Number(limit) || 6, 1), 10),
        visibility: visibilityFor(ctx.auth),
      });

      // Record citations on the turn so the UI can render sources under the
      // answer even when the model does not mention them in prose.
      ctx.citations.push(...toCitations(results));

      if (!results.length) {
        return {
          found: 0,
          note: 'Nothing in the knowledge base matches that. Say you do not know rather than guessing.',
        };
      }

      return {
        found: results.length,
        passages: results.map((r) => ({
          title: r.title,
          section: r.heading,
          url: r.sourceUrl,
          text: r.content,
        })),
      };
    },
  },

  // ── Structured company facts ────────────────────────────────────────────────
  {
    name: 'get_pricing',
    description:
      'Return the published price tiers exactly as they appear on the pricing page, including what each includes and excludes. Use this whenever money comes up — never quote a price from memory.',
    parameters: { type: 'object', properties: {}, required: [] },
    async handler(_args, ctx) {
      const content = await getPublishedContent();
      const p = content?.pricing;
      ctx.citations.push({ title: 'Pricing', url: '/pricing', source: 'cms', heading: null });
      return {
        currencyNote: p?.currencyNote ?? null,
        tiers: (p?.tiers ?? []).map((t) => ({
          name: t.name,
          price: t.priceDisplay,
          duration: t.duration,
          bestFor: t.bestFor,
          includes: t.includes ?? [],
          notIncluded: t.notIncluded ?? [],
        })),
        managedPlans: p?.managed?.enabled
          ? (p.managed.plans ?? []).map((m) => ({ name: m.name, price: m.price, note: m.priceNote, includes: m.includes ?? [] }))
          : [],
        note: 'These are published ranges, not quotes. Where a project lands depends on system count and data quality, and only a founder can confirm a figure.',
      };
    },
  },

  {
    name: 'list_services',
    description:
      'List the services Sakha AI offers, with what each is for and — importantly — when it is NOT a fit. Use the not-a-fit information; telling someone their problem is a poor fit is expected behaviour.',
    parameters: { type: 'object', properties: {}, required: [] },
    async handler(_args, ctx) {
      const content = await getPublishedContent();
      ctx.citations.push({ title: 'What we build', url: '/services', source: 'cms', heading: null });
      return {
        services: (content?.services?.items ?? []).map((s) => ({
          name: s.name,
          slug: s.slug,
          summary: s.oneLiner,
          outcomes: s.outcomes ?? [],
          goodFitWhen: s.goodFitWhen,
          notAFitWhen: s.notAFitWhen,
          url: `/services/${s.slug}`,
        })),
      };
    },
  },

  {
    name: 'list_case_studies',
    description:
      'List published case studies with their measured results. Only published work with a real number appears here. If the list is short, say so honestly rather than implying there is more.',
    parameters: {
      type: 'object',
      properties: { industry: { type: 'string', description: 'Optional industry filter.' } },
      required: [],
    },
    async handler({ industry }, ctx) {
      const content = await getPublishedContent();
      let studies = (content?.work?.caseStudies ?? []).filter((c) => c.published);

      const dbStudies = await prisma.page.findMany({
        where: { kind: 'case_study', status: 'published' },
        select: { slug: true, title: true, summary: true, data: true },
      });

      if (industry) {
        const needle = industry.toLowerCase();
        studies = studies.filter((c) => String(c.industry ?? '').toLowerCase().includes(needle));
      }

      ctx.citations.push({ title: 'Work', url: '/work', source: 'cms', heading: null });

      return {
        count: studies.length + dbStudies.length,
        caseStudies: [
          ...studies.map((c) => ({
            client: c.client,
            headline: c.headline,
            industry: c.industry,
            isOurOwn: Boolean(c.isDogfood),
            results: (c.metrics ?? []).map((m) => `${m.label}: ${m.value}`),
            url: `/work/${c.slug}`,
          })),
          ...dbStudies.map((p) => ({
            client: p.data?.client ?? p.title,
            headline: p.title,
            industry: p.data?.industry ?? null,
            results: p.data?.metrics ?? [],
            url: `/work/${p.slug}`,
          })),
        ],
        note:
          studies.length + dbStudies.length <= 1
            ? 'The company is early and publishes only measured results. Say that plainly if asked for more references.'
            : undefined,
      };
    },
  },

  {
    name: 'get_engagement_process',
    description:
      'Explain how an engagement actually runs, day by day, and what the responsible-deployment checklist and autonomy levels are. Use this for "how do you work", "how fast", "what happens if it gets something wrong", and governance or compliance questions.',
    parameters: { type: 'object', properties: {}, required: [] },
    async handler(_args, ctx) {
      const content = await getPublishedContent();
      ctx.citations.push({ title: 'Responsible deployment', url: '/responsible-ai', source: 'cms', heading: null });
      return {
        steps: (content?.home?.howItWorks?.steps ?? []).map((s) => ({
          when: s.day,
          what: s.title,
          detail: s.body,
        })),
        autonomyLevels: (content?.responsibleAi?.autonomyLevels ?? []).map((l) => ({
          level: l.level,
          name: l.name,
          description: l.description,
        })),
        checklist: (content?.responsibleAi?.checklist ?? []).map((c) => c.item),
        ownershipPolicy:
          'Code, infrastructure, prompts, evaluation harness and documentation belong to the client from day one, written into the contract by default.',
      };
    },
  },

  {
    name: 'get_company_facts',
    description:
      'Live facts read from the database right now: how many services, industries and case studies are published, when the knowledge base last rebuilt, and how to contact the company. Use this when asked how current you are, or for contact details.',
    parameters: { type: 'object', properties: {}, required: [] },
    async handler(_args, _ctx) {
      const [content, lastIndex, publishedPages] = await Promise.all([
        getPublishedContent(),
        prisma.indexRun.findFirst({
          where: { status: { in: ['ok', 'partial'] } },
          orderBy: { startedAt: 'desc' },
          select: { finishedAt: true, documentsSeen: true },
        }),
        prisma.page.count({ where: { status: 'published' } }),
      ]);

      return {
        company: {
          brand: content?.company?.brandName,
          legalName: content?.company?.legalName,
          tagline: content?.company?.tagline,
          email: content?.company?.email,
          phone: content?.company?.phone,
          location: [content?.company?.address?.city, content?.company?.address?.state, content?.company?.address?.country]
            .filter(Boolean)
            .join(', '),
          responsePromise: content?.company?.responsePromise,
        },
        team: (content?.about?.team ?? []).map((t) => ({ name: t.name, role: t.role })),
        counts: {
          services: (content?.services?.items ?? []).length,
          industries: (content?.industries?.items ?? []).filter((i) => i.published !== false).length,
          publishedCaseStudies: (content?.work?.caseStudies ?? []).filter((c) => c.published).length,
          extraCmsPages: publishedPages,
        },
        knowledge: {
          lastRebuiltAt: lastIndex?.finishedAt?.toISOString() ?? null,
          documentsIndexed: lastIndex?.documentsSeen ?? 0,
          refreshEveryHours: config.knowledge.refreshHours,
          note: 'The knowledge base also rebuilds immediately whenever site content is published.',
        },
      };
    },
  },

  // ── Action ──────────────────────────────────────────────────────────────────
  {
    name: 'capture_lead',
    description:
      "Pass a qualified conversation to a founder. Call this ONLY after the visitor has explicitly agreed and has given you their name, email and a description of their workflow. Never call it speculatively, never invent details, and never call it for a casual question.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The visitor's name, as they gave it." },
        email: { type: 'string', description: 'Their email address, as they gave it.' },
        company: { type: 'string', description: 'Their company, if mentioned.' },
        phone: { type: 'string', description: 'Their phone number, if they offered one.' },
        workflow: {
          type: 'string',
          description:
            'The workflow they described, in their own words as far as possible. This is what the founder reads first — be specific and do not embellish.',
        },
        budgetTier: {
          type: 'string',
          enum: ['pilot', 'single', 'multi', 'unsure'],
          description: 'Which tier they indicated, or "unsure".',
        },
      },
      required: ['name', 'email', 'workflow'],
    },
    async handler(args, ctx) {
      const parsed = leadSchema.safeParse({
        name: args.name,
        email: args.email,
        company: args.company ?? '',
        phone: args.phone ?? '',
        workflow: args.workflow,
        budgetTier: args.budgetTier,
        source: 'sakha-assistant',
      });

      if (!parsed.success) {
        return {
          ok: false,
          error: 'Those details are not complete enough to pass on.',
          problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          instruction: 'Ask the visitor for the missing detail. Do not invent it.',
        };
      }

      // Do not create a second lead for the same person in the same thread.
      const existing = await prisma.lead.findFirst({
        where: { email: parsed.data.email, conversationId: ctx.conversationId },
        select: { id: true },
      });
      if (existing) {
        return { ok: true, alreadyCaptured: true, message: 'Already passed to a founder in this conversation.' };
      }

      const lead = await prisma.lead.create({
        data: {
          ...parsed.data,
          company: parsed.data.company || null,
          phone: parsed.data.phone || null,
          conversationId: ctx.conversationId ?? null,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      logger.info({ leadId: lead.id, via: 'sakha' }, 'lead captured by assistant');

      const { enqueueLeadNotification } = await import('../jobs/queue.js');
      await enqueueLeadNotification(lead.id);

      return {
        ok: true,
        message:
          'Passed to a founder. Tell the visitor they will hear back within 24 hours, from a person and not an autoresponder.',
      };
    },
  },

  // ── Client-only ─────────────────────────────────────────────────────────────
  {
    name: 'get_my_projects',
    description:
      "Look up the signed-in client's own projects, their status, autonomy level and the metric each is being measured against. Only available to signed-in clients.",
    parameters: { type: 'object', properties: {}, required: [] },
    authOnly: true,
    requires: ['portal.projects.read'],
    async handler(_args, ctx) {
      if (!ctx.auth?.userId) return { error: 'Not signed in.' };

      const user = await prisma.user.findUnique({
        where: { id: ctx.auth.userId },
        select: { clientAccountId: true },
      });
      if (!user?.clientAccountId) {
        return { projects: [], note: 'This account is not linked to a client organisation.' };
      }

      const projects = await prisma.project.findMany({
        where: { clientAccountId: user.clientAccountId },
        orderBy: { updatedAt: 'desc' },
        select: {
          name: true,
          status: true,
          tier: true,
          autonomyLevel: true,
          metricLabel: true,
          metricBaseline: true,
          metricCurrent: true,
          liveAt: true,
          updates: { orderBy: { createdAt: 'desc' }, take: 2, select: { title: true, createdAt: true } },
        },
      });

      return {
        projects: projects.map((p) => ({
          name: p.name,
          status: p.status,
          tier: p.tier,
          autonomyLevel: p.autonomyLevel,
          metric: p.metricLabel
            ? { label: p.metricLabel, baseline: p.metricBaseline, current: p.metricCurrent }
            : null,
          liveSince: p.liveAt?.toISOString() ?? null,
          recentUpdates: p.updates.map((u) => u.title),
        })),
      };
    },
  },
];

const TOOL_INDEX = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/**
 * The tool list for one turn, filtered by who is asking.
 * A tool the caller may not use is never advertised — a model cannot misuse a
 * capability it was never shown.
 */
export function toolsForContext(ctx, { enabled } = {}) {
  return TOOLS.filter((tool) => {
    if (enabled && !enabled.includes(tool.name)) return false;
    if (tool.authOnly && !ctx.auth?.isAuthenticated) return false;
    if (tool.requires?.length) {
      const granted = ctx.auth?.permissions ?? [];
      if (granted.includes('*')) return true;
      return tool.requires.every((r) => granted.includes(r));
    }
    return true;
  }).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Execute one tool call. Never throws — the model gets a structured error and
 * can apologise honestly instead of the request 500ing.
 */
export async function executeTool(name, rawArgs, ctx) {
  const tool = TOOL_INDEX[name];
  if (!tool) {
    return { error: `No tool named "${name}".` };
  }

  // Re-check authorisation at execution, not only at advertisement.
  if (tool.authOnly && !ctx.auth?.isAuthenticated) {
    return { error: 'That information is only available to signed-in clients.' };
  }
  if (tool.requires?.length) {
    const granted = ctx.auth?.permissions ?? [];
    const ok = granted.includes('*') || tool.requires.every((r) => granted.includes(r));
    if (!ok) return { error: 'This account does not have access to that information.' };
  }

  let args = {};
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs ?? {});
  } catch {
    return { error: 'Those tool arguments were not valid JSON. Try again with a simpler call.' };
  }

  const startedAt = Date.now();
  try {
    const result = await tool.handler(args, ctx);
    logger.debug({ tool: name, ms: Date.now() - startedAt }, 'tool executed');
    return result;
  } catch (err) {
    logger.error({ err, tool: name, args }, 'tool execution failed');
    return { error: 'That lookup failed. Tell the visitor you could not check just now.' };
  }
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);
