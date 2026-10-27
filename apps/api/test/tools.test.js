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

test('get_team_member returns the whole published record, never editorial notes or photos', async () => {
  const { readFile } = await import('node:fs/promises');
  const { findTeamMembers } = await import('../src/sakha/tools.js');
  const content = JSON.parse(await readFile(new URL('../../../content/site-content.json', import.meta.url), 'utf8'));

  const { people, note } = findTeamMembers(content, 'Gokul');
  assert.equal(people.length, 1);
  const gokul = people[0];
  assert.ok(gokul.record.lifecycle.length > 0 && gokul.record.timeline.length > 0 && gokul.record.reference.quotes.length > 0);
  assert.ok(gokul.record.timeline.every((t) => t.period), 'every timeline entry carries its dates');
  assert.match(note, /Never turn them into a number of years/);
  assert.ok(!JSON.stringify(people).includes('"_'), 'editorial _ keys leaked');
  assert.equal(gokul.photo, undefined);

  assert.equal(findTeamMembers(content, 'technical lead').people[0]?.slug, 'gokul-madhesh');
  assert.equal(findTeamMembers(content, 'CEO').people[0]?.slug, 'malarvizhi');

  const unknown = findTeamMembers(content, 'Sai');
  assert.equal(unknown.people.length, 0);
  assert.equal(unknown.team.length, content.about.team.length, 'an unknown name lists the team instead');
});

test('optional tool parameters accept null, required ones do not', async () => {
  const { nullableOptionals } = await import('../src/sakha/tools.js');
  const schema = nullableOptionals({
    type: 'object',
    properties: { query: { type: 'string' }, industry: { type: 'string' }, tier: { type: 'string', enum: ['a', 'b'] } },
    required: ['query'],
  });
  assert.equal(schema.properties.query.type, 'string');
  assert.deepEqual(schema.properties.industry.type, ['string', 'null']);
  assert.deepEqual(schema.properties.tier.enum, ['a', 'b', null]);

  const odd = nullableOptionals({
    type: 'object',
    properties: { many: { type: ['string', 'integer'] }, already: { type: ['string', 'null'], enum: ['x', null] }, anything: {} },
  });
  assert.deepEqual(odd.properties.many.type, ['string', 'integer', 'null']);
  assert.deepEqual(odd.properties.already.type, ['string', 'null']);
  assert.deepEqual(odd.properties.already.enum, ['x', null]);
  assert.deepEqual(odd.properties.anything, {}, 'an untyped property already accepts null');

  // Every advertised tool gets the treatment.
  for (const t of toolsForContext(anonymous)) {
    const { properties = {}, required = [] } = t.function.parameters;
    for (const [key, prop] of Object.entries(properties)) {
      if (!required.includes(key)) assert.ok([].concat(prop.type).includes('null'), `${t.function.name}.${key} is not nullable`);
    }
  }
});

test('email addresses in answers become links labelled "email"', async () => {
  const { linkEmails } = await import('@asphalix/shared');
  assert.equal(linkEmails('Write to a.b+c@gmail.com.'), 'Write to [email](mailto:a.b+c@gmail.com).');
  assert.equal(
    linkEmails('Use [gokul@asphalix.com](mailto:gokul@asphalix.com) or [email Malarvizhi](mailto:m@asphalix.com)'),
    'Use [email](mailto:gokul@asphalix.com) or [email Malarvizhi](mailto:m@asphalix.com)'
  );
  assert.equal(linkEmails('[email us](mailto:x@y.com)'), '[email us](mailto:x@y.com)', 'an existing word label stays');
  assert.equal(linkEmails('No address here.'), 'No address here.');
});

test('phone numbers in answers become WhatsApp links', async () => {
  const { linkPhones, linkContacts } = await import('@asphalix/shared');
  assert.equal(linkPhones('Call +91 63742 48957.'), 'Call [WhatsApp us](https://wa.me/916374248957).');
  assert.equal(linkPhones('or 6374248957 now'), 'or [WhatsApp us](https://wa.me/916374248957) now');
  assert.equal(linkPhones('[+91 63742 48957](https://wa.me/916374248957)'), '[WhatsApp us](https://wa.me/916374248957)');
  for (const unchanged of ['[WhatsApp us](https://wa.me/916374248957)', 'Ticket #1042, opened 2026-10-27', 'https://wa.me/916374248957']) {
    assert.equal(linkPhones(unchanged), unchanged);
  }
  assert.equal(linkContacts('x@y.com or 6374248957'), '[email](mailto:x@y.com) or [WhatsApp us](https://wa.me/916374248957)');
});
