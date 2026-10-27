/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Sakha's tools — what makes it an agent rather than a chatbot.
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
import { retrieve, visibilityFor } from '../knowledge/retriever.js';
import { candidatesFrom } from './citations.js';
import { getPublishedContent } from '../modules/content/service.js';
import { z } from 'zod';
import { emailSchema, leadSchema, ticketCreateSchema } from '@asphalix/shared';
import { addTicketMessage, clientAccountIdFor, createTicket } from '../modules/tickets/service.js';

/** What the panel shows as a ticket card under Sakha's answer. */
function ticketCard(ticket, signedIn) {
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    url: signedIn && ticket.clientAccountId ? `/portal/tickets/${ticket.id}` : null,
  };
}

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
      "Search the Asphalix knowledge base — website content, services, support guides, case studies, policies, published documents and crawled public pages. Use this for almost every factual question about the company. Prefer several specific searches over one broad one.",
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

      // Record what was found; the engine shows only the ones the answer used.
      ctx.citations.push(...candidatesFrom(results));

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
    name: 'list_services',
    description:
      'List the services Asphalix offers, with what each is for and — importantly — when it is NOT a fit. Use the not-a-fit information; telling someone their problem is a poor fit is expected behaviour.',
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
          description: 'The scope they indicated: a pilot on one workflow, one workflow in production, several workflows, or "unsure". Never ask about budget.',
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

  // ── Support desk ────────────────────────────────────────────────────────────
  {
    name: 'request_human',
    description:
      "Hand the conversation to a person on the Asphalix team by opening a support ticket they will pick up. Use when the visitor asks for a person, when you could not resolve a support problem, or at once for contracts, invoices, outages, data exposure or a live agent misbehaving. For a visitor who is not signed in you need their name and email and their explicit agreement first — never invent them. Not for new sales enquiries (use capture_lead).",
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'One line saying what the person needs help with. Becomes the ticket subject.',
        },
        details: {
          type: 'string',
          description:
            'What the visitor described and what you already tried or told them, so the human does not start from zero. Their words where possible; do not embellish.',
        },
        priority: { type: 'string', enum: ['normal', 'high', 'urgent'], description: 'See the priority rules in your instructions.' },
        name: { type: 'string', description: "Visitor's name. Required only when they are not signed in." },
        email: { type: 'string', description: "Visitor's email. Required only when they are not signed in." },
      },
      required: ['summary', 'details'],
    },
    async handler(args, ctx) {
      const signedIn = Boolean(ctx.auth?.userId);
      let requesterName = null;
      let requesterEmail = null;

      if (!signedIn) {
        const who = z
          .object({ name: z.string().trim().min(2).max(120), email: emailSchema })
          .safeParse({ name: args.name, email: args.email });
        if (!who.success) {
          return {
            ok: false,
            error: 'A name and a valid email are needed so the team can reply.',
            instruction: 'Ask the visitor for their name and email, and confirm they want a person to contact them. Do not invent either.',
          };
        }
        requesterName = who.data.name;
        requesterEmail = who.data.email;
      }

      const parsed = ticketCreateSchema.safeParse({
        subject: String(args.summary ?? '').slice(0, 200),
        body: String(args.details ?? ''),
        priority: ['normal', 'high', 'urgent'].includes(args.priority) ? args.priority : 'normal',
        category: 'question',
      });
      if (!parsed.success) {
        return { ok: false, error: 'The summary or details are too thin to hand over.', instruction: 'Ask what they need help with in a sentence or two.' };
      }

      // One handoff per conversation: a second request adds to the first.
      const existing = await prisma.ticket.findFirst({
        where: { conversationId: ctx.conversationId, source: 'sakha', status: { in: ['open', 'pending'] } },
      });
      if (existing) {
        await addTicketMessage({ ticketId: existing.id, authorType: 'sakha', body: parsed.data.body });
        ctx.tickets?.push(ticketCard(existing, signedIn));
        return { ok: true, alreadyRaised: true, ticket: `#${existing.number}`, message: 'Added to the ticket already open for this conversation.' };
      }

      const ticket = await createTicket({
        clientAccountId: signedIn ? await clientAccountIdFor(ctx.auth.userId) : null,
        raisedById: signedIn ? ctx.auth.userId : null,
        requesterName,
        requesterEmail,
        ...parsed.data,
        source: 'sakha',
        conversationId: ctx.conversationId ?? null,
      });
      ctx.tickets?.push(ticketCard(ticket, signedIn));

      return {
        ok: true,
        ticket: `#${ticket.number}`,
        message: signedIn
          ? 'A person on the team has it and the conversation is attached. Give the client the ticket number and tell them it is visible in their portal.'
          : 'A person on the team has it and the conversation is attached. Give the visitor the ticket number and tell them a reply will come by email.',
      };
    },
  },

  {
    name: 'create_ticket',
    description:
      "Raise a support ticket for the signed-in client's organisation. Summarise subject, description and priority back to the client and call this only after they confirm. Only for signed-in clients.",
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Short subject line, under 12 words.' },
        description: { type: 'string', description: 'The problem in the client\'s words, plus anything you already checked.' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        category: { type: 'string', enum: ['question', 'bug', 'change', 'access', 'billing', 'other'] },
      },
      required: ['subject', 'description'],
    },
    authOnly: true,
    requires: ['portal.tickets.write'],
    async handler(args, ctx) {
      const accountId = await clientAccountIdFor(ctx.auth?.userId);
      if (!accountId) {
        return { ok: false, error: 'This account is not linked to a client organisation.', instruction: 'Offer request_human instead.' };
      }
      const parsed = ticketCreateSchema.safeParse({
        subject: args.subject,
        body: args.description,
        priority: args.priority,
        category: args.category,
      });
      if (!parsed.success) {
        return {
          ok: false,
          error: 'Not enough detail for a ticket yet.',
          problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          instruction: 'Ask the client for the missing detail.',
        };
      }

      const duplicate = await prisma.ticket.findFirst({
        where: { conversationId: ctx.conversationId, clientAccountId: accountId, status: { in: ['open', 'pending'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate && duplicate.subject.toLowerCase() === parsed.data.subject.toLowerCase()) {
        ctx.tickets?.push(ticketCard(duplicate, true));
        return { ok: true, alreadyRaised: true, ticket: `#${duplicate.number}`, instruction: 'Use add_ticket_message to add detail to it.' };
      }

      const ticket = await createTicket({
        clientAccountId: accountId,
        raisedById: ctx.auth.userId,
        ...parsed.data,
        source: 'sakha',
        conversationId: ctx.conversationId ?? null,
      });
      ctx.tickets?.push(ticketCard(ticket, true));
      return { ok: true, ticket: `#${ticket.number}`, status: ticket.status, message: 'Raised. The team is notified by email; the client can follow it in their portal.' };
    },
  },

  {
    name: 'get_my_tickets',
    description:
      "List the signed-in client's organisation's support tickets with status and the latest reply from the team. Only for signed-in clients.",
    parameters: {
      type: 'object',
      properties: {
        includeClosed: { type: 'boolean', description: 'Include resolved and closed tickets. Default false.' },
      },
      required: [],
    },
    authOnly: true,
    requires: ['portal.access'],
    async handler(args, ctx) {
      const accountId = await clientAccountIdFor(ctx.auth?.userId);
      if (!accountId) return { tickets: [], note: 'This account is not linked to a client organisation.' };

      const tickets = await prisma.ticket.findMany({
        where: {
          clientAccountId: accountId,
          ...(args.includeClosed ? {} : { status: { in: ['open', 'pending'] } }),
        },
        orderBy: { lastActivityAt: 'desc' },
        take: 15,
        select: {
          number: true,
          subject: true,
          status: true,
          priority: true,
          createdAt: true,
          lastActivityAt: true,
          // Never internal notes.
          messages: {
            where: { internal: false, authorType: 'staff' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true },
          },
        },
      });

      return {
        tickets: tickets.map((t) => ({
          ticket: `#${t.number}`,
          subject: t.subject,
          status: t.status === 'pending' ? 'waiting on the client' : t.status,
          priority: t.priority,
          opened: t.createdAt.toISOString(),
          lastActivity: t.lastActivityAt.toISOString(),
          latestTeamReply: t.messages[0]?.body.slice(0, 600) ?? null,
        })),
      };
    },
  },

  {
    name: 'add_ticket_message',
    description:
      "Add a message to one of the signed-in client's own open tickets, e.g. new detail or an answer to the team's question. Only for signed-in clients.",
    parameters: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'The ticket number, e.g. "#1042" or "1042".' },
        message: { type: 'string', description: "What to add, in the client's words." },
      },
      required: ['ticket', 'message'],
    },
    authOnly: true,
    requires: ['portal.tickets.write'],
    async handler(args, ctx) {
      const accountId = await clientAccountIdFor(ctx.auth?.userId);
      const number = Number.parseInt(String(args.ticket ?? '').replace(/\D/g, ''), 10);
      const body = String(args.message ?? '').trim();
      if (!accountId || !Number.isFinite(number)) return { ok: false, error: 'No such ticket on this account.' };
      if (body.length < 2) return { ok: false, error: 'The message is empty.' };

      const ticket = await prisma.ticket.findFirst({ where: { number, clientAccountId: accountId } });
      if (!ticket) return { ok: false, error: 'No such ticket on this account.' };
      if (ticket.status === 'closed') {
        return { ok: false, error: 'That ticket is closed.', instruction: 'Offer to raise a new ticket that mentions the old number.' };
      }

      await addTicketMessage({ ticketId: ticket.id, authorType: 'client', authorId: ctx.auth.userId, body: body.slice(0, 8000) });
      ctx.tickets?.push(ticketCard({ ...ticket, status: 'open' }, true));
      return { ok: true, ticket: `#${ticket.number}`, message: 'Added. The team is notified.' };
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
