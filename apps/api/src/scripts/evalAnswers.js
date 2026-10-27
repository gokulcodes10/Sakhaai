/**
 * Check Sakha's answers against test/fixtures/answer-checks.json.
 *
 *   npm run sakha:eval-answers --workspace @asphalix/api
 *   npm run sakha:eval-answers --workspace @asphalix/api -- --only colleges
 *
 * Runs each case through the real engine and model, so it spends tokens: on
 * Groq's free tier it pauses between cases and retries once when busy. Run it
 * after changing the prompt, the tools or retrieval. The conversations it
 * creates belong to the visitor id "sakha-eval" and are deleted at the end.
 */
import { readFile } from 'node:fs/promises';
import prisma from '../lib/prisma.js';
import { runTurn } from '../sakha/engine.js';
import { ANONYMOUS_PERMISSIONS } from '@asphalix/shared';

const PAUSE_MS = Number(process.env.EVAL_PAUSE_MS ?? 25_000);
const ALWAYS_NOT = [
  ['a price', /₹|rs\.?\s?\d|\d\s?(lakh|crore)/i],
  ['a citation marker', /【|\[\d+\]/],
  ['the old domain', /sakhaai\.com/i],
];

const all = JSON.parse(await readFile(new URL('../../test/fixtures/answer-checks.json', import.meta.url), 'utf8')).cases;
// --only <text>: just the cases whose questions contain that text.
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]?.toLowerCase() : null;
const cases = only ? all.filter((c) => c.turns.join(' ').toLowerCase().includes(only)) : all;

// The model writes "five days" with a narrow no-break space and "real‑time"
// with a non-breaking hyphen. Visitors cannot tell; regular expressions can.
const plain = (text) => text.replace(/[\u00a0\u2007\u2009\u202f]/g, ' ').replace(/[\u2010-\u2015]/g, '-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = { isAuthenticated: false, permissions: ANONYMOUS_PERMISSIONS };
const created = new Set();

async function turn(message, conversationId) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const r = await runTurn({ conversationId, message, auth, visitorId: 'sakha-eval', pageContext: { path: '/' } });
      created.add(r.conversationId);
      return r;
    } catch (err) {
      if (err.status !== 503 || attempt > 0) throw err;
      await sleep(60_000);
    }
  }
}

let passed = 0;
for (const [i, c] of cases.entries()) {
  if (i) await sleep(PAUSE_MS);
  const label = c.turns.join(' → ');
  let result;
  try {
    let conversationId = null;
    for (const [t, message] of c.turns.entries()) {
      if (t) await sleep(PAUSE_MS);
      result = await turn(message, conversationId);
      conversationId = result.conversationId;
    }
  } catch (err) {
    console.log(`  ERROR ${label}: ${err.message}`);
    continue;
  }

  const answer = plain(result.message.content);
  const failures = [
    ...(c.must ?? []).filter((p) => !new RegExp(p, 'im').test(answer)).map((p) => `missing /${p}/`),
    ...(c.mustNot ?? []).filter((p) => new RegExp(p, 'im').test(answer)).map((p) => `contains /${p}/`),
    ...ALWAYS_NOT.filter(([, re]) => re.test(answer)).map(([what]) => `contains ${what}`),
  ];
  const titles = result.message.citations.map((s) => s.title);
  if (c.sources && !titles.some((t) => c.sources.includes(t))) failures.push(`sources were [${titles.join(' | ')}]`);

  if (failures.length) {
    console.log(`  FAIL  ${label}\n        ${failures.join('; ')}\n        answer: ${answer.slice(0, 300).replace(/\n/g, ' ')}`);
  } else {
    passed += 1;
    console.log(`  pass  ${label}`);
  }
}

console.log(`\n  ${passed}/${cases.length} passed`);
// Sakha titles a new conversation in the background after answering; let that
// land before deleting the conversation out from under it.
await sleep(5_000);
await prisma.message.deleteMany({ where: { conversationId: { in: [...created] } } });
await prisma.conversation.deleteMany({ where: { id: { in: [...created] }, visitorId: 'sakha-eval' } });
await prisma.$disconnect();
