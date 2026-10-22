/**
 * Overwrite the stored system prompt (Setting `sakha.systemPrompt`) with the
 * current DEFAULT_SYSTEM_PROMPT.
 *
 * The seed never overwrites an existing prompt, because admins tune it in the
 * CMS. Run this when a release changes the prompt on purpose — e.g. the
 * Asphalix rebrand, which removed prices and added the support rules:
 *
 *   npm run sakha:reset-prompt --workspace @asphalix/api
 */
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { DEFAULT_SYSTEM_PROMPT } from '../sakha/prompt.js';

const existing = await prisma.setting.findUnique({ where: { key: 'sakha.systemPrompt' } });
await prisma.setting.upsert({
  where: { key: 'sakha.systemPrompt' },
  create: { key: 'sakha.systemPrompt', value: DEFAULT_SYSTEM_PROMPT, category: 'sakha' },
  update: { value: DEFAULT_SYSTEM_PROMPT },
});

// A stored tool allowlist written before this release cannot name the new
// support tools, and may still name the removed get_pricing tool. Clear it so
// every current tool is enabled; admins can narrow it again under Tuning.
const tools = await prisma.setting.findUnique({ where: { key: 'sakha.enabledTools' } });
if (Array.isArray(tools?.value)) {
  await prisma.setting.update({ where: { key: 'sakha.enabledTools' }, data: { value: Prisma.JsonNull } });
  console.log('  sakha.enabledTools reset to all tools (was an explicit list).');
}

console.log(`  sakha.systemPrompt ${existing ? 'replaced' : 'created'} (${DEFAULT_SYSTEM_PROMPT.length} chars).`);
await prisma.$disconnect();
