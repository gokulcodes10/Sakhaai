/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  The Sakha engine — the agent loop.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Not a chatbot: a bounded tool-calling loop. Each turn the model may call
 *  tools, read their results, and call more, until it has what it needs or hits
 *  the step ceiling. On the final step tools are withdrawn so it is forced to
 *  answer with what it has rather than looping forever.
 *
 *  One deliberate design note: retrieval is NOT done automatically before the
 *  model runs. The model decides what to search for, which lets it issue
 *  several targeted searches for a compound question instead of one blurry one.
 *  A cheap first-turn pre-fetch is still done for the very first user message,
 *  because that is where latency is most visible.
 */

import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import config from '../config/index.js';
import { chatCompletion, quickCompletion } from './groq.js';
import { buildSystemMessage, DEFAULT_SYSTEM_PROMPT } from './prompt.js';
import { executeTool, toolsForContext } from './tools.js';
import { retrieve, formatContext, toCitations, visibilityFor } from '../knowledge/retriever.js';
import { getSetting } from '../modules/ops/settings.js';

/**
 * Run one turn of conversation.
 *
 * @param {{
 *   conversationId?: string|null,
 *   message: string,
 *   auth: object,
 *   visitorId?: string,
 *   pageContext?: {path?:string, title?:string},
 *   ip?: string,
 *   userAgent?: string,
 * }} input
 */
export async function runTurn(input) {
  const startedAt = Date.now();

  const conversation = await resolveConversation(input);

  const [systemPrompt, enabledTools, lastIndex] = await Promise.all([
    getSetting('sakha.systemPrompt', DEFAULT_SYSTEM_PROMPT),
    getSetting('sakha.enabledTools', null),
    prisma.indexRun.findFirst({
      where: { status: { in: ['ok', 'partial'] } },
      orderBy: { startedAt: 'desc' },
      select: { finishedAt: true },
    }),
  ]);

  /** Shared across every tool call in this turn. Tools push citations onto it. */
  const ctx = {
    auth: input.auth,
    conversationId: conversation.id,
    ip: input.ip,
    userAgent: input.userAgent,
    citations: [],
  };

  const history = await loadHistory(conversation.id);

  const messages = [
    buildSystemMessage({
      systemPrompt,
      pageContext: input.pageContext,
      viewer: {
        isAuthenticated: input.auth?.isAuthenticated,
        name: input.auth?.name,
        roles: input.auth?.roles,
      },
      knowledgeUpdatedAt: lastIndex?.finishedAt?.toISOString() ?? null,
    }),
    ...history,
  ];

  // First message in a thread: pre-fetch context so the very first answer does
  // not pay for an extra round trip before it can say anything useful.
  if (history.length === 0) {
    const seed = await retrieve(input.message, {
      topK: 5,
      visibility: visibilityFor(input.auth),
    });
    if (seed.length) {
      ctx.citations.push(...toCitations(seed));
      messages.push({
        role: 'system',
        content: `Possibly relevant context, retrieved before the visitor's question was read. Search again if it does not cover what they asked.\n\n${formatContext(seed)}`,
      });
    }
  }

  messages.push({ role: 'user', content: input.message });

  const userMessage = await prisma.message.create({
    data: { conversationId: conversation.id, role: 'user', content: input.message },
  });

  const tools = toolsForContext(ctx, { enabled: enabledTools });
  const maxSteps = config.sakha.maxToolSteps;
  const toolTrace = [];
  let usage = { prompt: 0, completion: 0 };
  let finalContent = null;
  let modelUsed = config.groq.model;

  for (let step = 0; step < maxSteps; step += 1) {
    const isLastStep = step === maxSteps - 1;

    const { message, usage: turnUsage, model } = await chatCompletion({
      messages,
      // On the final step withhold tools entirely: the model must answer.
      tools: isLastStep ? undefined : tools,
    });

    modelUsed = model ?? modelUsed;
    usage = {
      prompt: usage.prompt + (turnUsage?.prompt_tokens ?? 0),
      completion: usage.completion + (turnUsage?.completion_tokens ?? 0),
    };

    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      finalContent = message.content?.trim() ?? '';
      break;
    }

    // Push the assistant's tool-call message before the results, or the
    // provider rejects the next request as malformed.
    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls,
    });

    // Tools within one step are independent — run them together.
    const results = await Promise.all(
      toolCalls.map(async (call) => {
        const name = call.function?.name;
        const result = await executeTool(name, call.function?.arguments, ctx);
        toolTrace.push({ name, args: safeParse(call.function?.arguments), ok: !result?.error });
        return { call, result };
      })
    );

    for (const { call, result } of results) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function?.name,
        content: JSON.stringify(result).slice(0, 12_000),
      });
    }
  }

  if (!finalContent) {
    finalContent =
      "I could not get to a confident answer on that one. A founder can — email hello@sakhaai.com and you'll hear back within 24 hours.";
  }

  const citations = dedupeCitations(ctx.citations);
  const latencyMs = Date.now() - startedAt;

  const assistantMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: finalContent,
      citations: citations.length ? citations : undefined,
      toolCalls: toolTrace.length ? toolTrace : undefined,
      model: modelUsed,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      latencyMs,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  // Name the thread from the first exchange, in the background.
  if (!conversation.title) {
    titleConversation(conversation.id, input.message).catch(() => {});
  }

  logger.info(
    { conversationId: conversation.id, steps: toolTrace.length, latencyMs, ...usage },
    'sakha turn complete'
  );

  return {
    conversationId: conversation.id,
    userMessageId: userMessage.id,
    message: {
      id: assistantMessage.id,
      role: 'assistant',
      content: finalContent,
      citations,
      createdAt: assistantMessage.createdAt,
    },
    usage,
    latencyMs,
    toolsUsed: toolTrace.map((t) => t.name),
  };
}

// ── Conversation plumbing ─────────────────────────────────────────────────────

async function resolveConversation({ conversationId, auth, visitorId, pageContext, ip, userAgent }) {
  if (conversationId) {
    const existing = await prisma.conversation.findUnique({ where: { id: conversationId } });
    // Only the owner may continue a thread. A guessed id must not leak history.
    if (existing) {
      const ownedByUser = auth?.userId && existing.userId === auth.userId;
      const ownedByVisitor = !existing.userId && visitorId && existing.visitorId === visitorId;
      if (ownedByUser || ownedByVisitor) return existing;
      logger.warn({ conversationId }, 'conversation ownership mismatch — starting a new thread');
    }
  }

  return prisma.conversation.create({
    data: {
      userId: auth?.userId ?? null,
      visitorId: auth?.userId ? null : (visitorId ?? null),
      pagePath: pageContext?.path ?? null,
      ip: ip?.slice(0, 60) ?? null,
      userAgent: userAgent?.slice(0, 400) ?? null,
    },
  });
}

/** Recent turns, oldest first, trimmed to the configured window. */
async function loadHistory(conversationId) {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'desc' },
    take: config.sakha.historyTurns * 2,
    select: { role: true, content: true },
  });
  return rows.reverse().map((m) => ({ role: m.role, content: m.content }));
}

async function titleConversation(conversationId, firstMessage) {
  const title = await quickCompletion(
    `Summarise this website visitor's question as a title of at most six words. Reply with the title only, no quotes, no full stop.\n\nQuestion: ${firstMessage}`,
    { maxTokens: 24 }
  );
  if (title) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { title: title.slice(0, 120) },
    });
  }
}

function dedupeCitations(citations) {
  const seen = new Set();
  const out = [];
  for (const c of citations) {
    const key = `${c.url ?? ''}|${c.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.slice(0, 6);
}

const safeParse = (raw) => {
  try {
    return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {});
  } catch {
    return {};
  }
};
