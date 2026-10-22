import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROLE_PERMISSIONS, ANONYMOUS_PERMISSIONS, SYSTEM_ROLES } from '@asphalix/shared';
import { TOOL_NAMES, executeTool, toolsForContext } from '../src/sakha/tools.js';
import { DEFAULT_SYSTEM_PROMPT } from '../src/sakha/prompt.js';

const names = (ctx) => toolsForContext(ctx).map((t) => t.function.name);

const anonymous = { auth: { isAuthenticated: false, permissions: ANONYMOUS_PERMISSIONS } };
const client = {
  auth: { isAuthenticated: true, userId: 'u1', permissions: DEFAULT_ROLE_PERMISSIONS[SYSTEM_ROLES.CLIENT] },
};

test('Sakha has no pricing tool any more', () => {
  assert.ok(!TOOL_NAMES.includes('get_pricing'));
});

test('anyone can ask for a human; only clients can work tickets', () => {
  const anon = names(anonymous);
  assert.ok(anon.includes('request_human'));
  assert.ok(anon.includes('capture_lead'));
  for (const t of ['create_ticket', 'get_my_tickets', 'add_ticket_message', 'get_my_projects']) {
    assert.ok(!anon.includes(t), `${t} was offered to an anonymous visitor`);
  }

  const mine = names(client);
  for (const t of ['request_human', 'create_ticket', 'get_my_tickets', 'add_ticket_message']) {
    assert.ok(mine.includes(t), `${t} was not offered to a signed-in client`);
  }
});

test('a hallucinated client tool call is refused for an anonymous visitor', async () => {
  const result = await executeTool('create_ticket', '{"subject":"x","description":"y"}', anonymous);
  assert.ok(result.error, 'an anonymous visitor reached create_ticket');
});

test('an anonymous handoff without contact details asks for them instead of creating a ticket', async () => {
  const result = await executeTool(
    'request_human',
    JSON.stringify({ summary: 'Agent replying wrongly', details: 'The WhatsApp agent quoted the wrong order status.' }),
    { ...anonymous, conversationId: null, tickets: [] }
  );
  assert.equal(result.ok, false);
  assert.match(result.instruction, /name and email/i);
});

test('the prompt forbids prices and describes support', () => {
  assert.match(DEFAULT_SYSTEM_PROMPT, /Never state, estimate/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /request_human/);
  assert.ok(!DEFAULT_SYSTEM_PROMPT.includes('published price tiers'));
});
