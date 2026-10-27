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
import { estimateTokens, trimHistory } from './budget.js';

// Room left at the start of a turn for tool results to come back into.
const TOOL_RESULT_HEADROOM = 1_500;
// A single tool result is cut to this many characters (about 1,500 tokens).
const TOOL_RESULT_CHARS = 6_000;
// Tools that change something outside the conversation. Once one has run, a
// turn that fails afterwards is kept, so the visitor learns what was done.
const ACTION_TOOLS = new Set(['capture_lead', 'request_human', 'create_ticket', 'add_ticket_message']);

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

  const { conversation, created } = await resolveConversation(input);

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
    // Tickets a tool raised or touched this turn; the panel renders them as cards.
    tickets: [],
  };

  const rawHistory = await loadHistory(conversation.id);

  const systemMessage = buildSystemMessage({
    systemPrompt,
    pageContext: input.pageContext,
    viewer: {
      isAuthenticated: input.auth?.isAuthenticated,
      name: input.auth?.name,
      roles: input.auth?.roles,
    },
    knowledgeUpdatedAt: lastIndex?.finishedAt?.toISOString() ?? null,
  });

  // First message in a thread: pre-fetch context so the very first answer does
  // not pay for an extra round trip before it can say anything useful.
  let seedMessage = null;
  if (rawHistory.length === 0) {
    const seed = await retrieve(input.message, {
      topK: 5,
      visibility: visibilityFor(input.auth),
    });
    if (seed.length) {
      ctx.citations.push(...toCitations(seed));
      seedMessage = {
        role: 'system',
        content: `Possibly relevant context, retrieved before the visitor's question was read. Search again if it does not cover what they asked.\n\n${formatContext(seed)}`,
      };
    }
  }

  const userTurn = { role: 'user', content: input.message };
  const tools = toolsForContext(ctx, { enabled: enabledTools });
  const toolTokens = estimateTokens(tools);
  const budget = config.sakha.promptTokenBudget;

  // Every request counts against the provider's per-minute allowance, so old
  // turns go first when a long conversation would not otherwise fit.
  const history = trimHistory(
    rawHistory,
    estimateTokens([systemMessage, seedMessage, userTurn]) + toolTokens + TOOL_RESULT_HEADROOM,
    budget
  );
  const messages = [systemMessage, ...history, ...(seedMessage ? [seedMessage] : []), userTurn];

  const maxSteps = config.sakha.maxToolSteps;
  const toolTrace = [];
  let usage = { prompt: 0, completion: 0 };
  let finalContent = null;
  let modelUsed = config.groq.model;

  for (let step = 0; step < maxSteps; step += 1) {
    // On the final step, or once tool results have filled the budget, withhold
    // tools entirely: the model must answer with what it has. Dropping the
    // schemas also makes that last request smaller.
    const mustAnswer = step === maxSteps - 1 || estimateTokens(messages) + toolTokens > budget;

    let completion;
    try {
      completion = await chatCompletion({ messages, tools: mustAnswer ? undefined : tools });
    } catch (err) {
      // Nothing has changed yet (at most a search ran): fail the turn and save
      // nothing, so the visitor can resend and the question does not sit
      // unanswered in the thread, to be answered out of order next time.
      if (!toolTrace.some((t) => ACTION_TOOLS.has(t.name) && t.ok)) {
        logger.warn({ conversationId: conversation.id, step, chars: input.message.length }, 'sakha turn failed, question not saved');
        // A thread opened for this question alone would otherwise stay behind empty.
        if (created) await prisma.conversation.delete({ where: { id: conversation.id } }).catch(() => {});
        throw err;
      }
      // A ticket or lead now exists, so keep the turn; the cards show what was done.
      logger.warn({ conversationId: conversation.id, step }, 'sakha turn failed after an action');
      break;
    }
    const { message, usage: turnUsage, model } = completion;

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
        content: JSON.stringify(result).slice(0, TOOL_RESULT_CHARS),
      });
    }
  }

  if (!finalContent) {
    finalContent =
      'I could not get to a confident answer on that one. A founder can — use the contact page and a person will reply.';
  }

  // Saved only now, with its answer, so a failed turn leaves no orphan behind.
  const userMessage = await prisma.message.create({
    data: { conversationId: conversation.id, role: 'user', content: input.message },
  });

  const citations = dedupeCitations(ctx.citations);
  const tickets = [...new Map(ctx.tickets.map((t) => [t.id, t])).values()];
  if (tickets.length) toolTrace.push({ name: 'tickets', tickets });
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
      tickets,
      createdAt: assistantMessage.createdAt,
    },
    usage,
    latencyMs,
    toolsUsed: toolTrace.filter((t) => t.name !== 'tickets').map((t) => t.name),
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
      if (ownedByUser || ownedByVisitor) return { conversation: existing, created: false };
      logger.warn({ conversationId }, 'conversation ownership mismatch — starting a new thread');
    }
  }

  const conversation = await prisma.conversation.create({
    data: {
      userId: auth?.userId ?? null,
      visitorId: auth?.userId ? null : (visitorId ?? null),
      pagePath: pageContext?.path ?? null,
      ip: ip?.slice(0, 60) ?? null,
      userAgent: userAgent?.slice(0, 400) ?? null,
    },
  });
  return { conversation, created: true };
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
