/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Seed / reconcile.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Idempotent by design — safe to run on every deploy. It reconciles the
 *  permission catalogue and the system roles from @sakha/shared into the
 *  database, then ensures the founding accounts exist.
 *
 *  It never overwrites a permission grant an admin has made through the CMS.
 *  New permissions introduced by a release are added; existing role grants are
 *  only seeded when a role has none, so a super admin's decision to give
 *  Malarvizhi CMS access survives the next deploy.
 */

import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOGUE,
  SYSTEM_ROLES,
  ROLE_RANK,
} from '@sakha/shared';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = (...args) => console.log('  ', ...args);

async function seedPermissions() {
  const rows = PERMISSION_CATALOGUE.flatMap((group) =>
    group.permissions.map((p) => ({
      key: p.key,
      domain: group.domain,
      label: p.label,
      description: p.description ?? null,
    }))
  );

  for (const row of rows) {
    await prisma.permission.upsert({
      where: { key: row.key },
      create: row,
      update: { domain: row.domain, label: row.label, description: row.description },
    });
  }
  log(`permissions reconciled: ${rows.length}`);
  return rows;
}

async function seedRoles() {
  const definitions = [
    {
      key: SYSTEM_ROLES.SUPER_ADMIN,
      name: 'Super Admin',
      description: 'Full control, including granting permissions and creating new roles.',
      rank: ROLE_RANK[SYSTEM_ROLES.SUPER_ADMIN],
    },
    {
      key: SYSTEM_ROLES.ADMIN,
      name: 'Admin',
      description:
        'Runs day-to-day operations. CMS access is NOT included by default — the super admin grants it deliberately.',
      rank: ROLE_RANK[SYSTEM_ROLES.ADMIN],
    },
    {
      key: SYSTEM_ROLES.EMPLOYEE,
      name: 'Employee',
      description: 'Internal read access to leads, projects and the knowledge base.',
      rank: ROLE_RANK[SYSTEM_ROLES.EMPLOYEE],
    },
    {
      key: SYSTEM_ROLES.CLIENT,
      name: 'Client',
      description: 'Signed-in customer. Sees only their own organisation.',
      rank: ROLE_RANK[SYSTEM_ROLES.CLIENT],
    },
  ];

  const roles = {};

  for (const def of definitions) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      create: { ...def, isSystem: true },
      update: { name: def.name, description: def.description, rank: def.rank, isSystem: true },
    });
    roles[def.key] = role;

    const existingGrants = await prisma.rolePermission.count({ where: { roleId: role.id } });

    // Only seed grants for a role that has none. Never stomp on a decision the
    // super admin made in the CMS.
    if (existingGrants === 0) {
      const wanted = DEFAULT_ROLE_PERMISSIONS[def.key] ?? [];
      const keys = wanted.includes('*')
        ? (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key)
        : wanted;

      const permissions = await prisma.permission.findMany({ where: { key: { in: keys } } });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
      log(`${def.key}: granted ${permissions.length} permissions (first seed)`);
    } else {
      // A new release may add permissions. The super admin role always gets
      // them; every other role waits for a human decision.
      if (def.key === SYSTEM_ROLES.SUPER_ADMIN) {
        const all = await prisma.permission.findMany({ select: { id: true } });
        await prisma.rolePermission.createMany({
          data: all.map((p) => ({ roleId: role.id, permissionId: p.id })),
          skipDuplicates: true,
        });
      }
      log(`${def.key}: ${existingGrants} existing grants preserved`);
    }
  }

  return roles;
}

async function ensureUser({ email, password, name, title, roleKey, roles }) {
  if (!email) return null;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    log(`user exists, left untouched: ${email}`);
    return existing;
  }

  if (!password) {
    log(`SKIPPED ${email} — no password in .env`);
    return null;
  }

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      title,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      status: 'active',
      emailVerifiedAt: new Date(),
      roles: { create: [{ roleId: roles[roleKey].id }] },
    },
  });
  log(`created ${roleKey}: ${email}`);
  return user;
}

async function seedSettings() {
  const { DEFAULT_SYSTEM_PROMPT } = await import('../src/sakha/prompt.js');

  const defaults = [
    { key: 'sakha.systemPrompt', value: DEFAULT_SYSTEM_PROMPT, category: 'sakha' },
    { key: 'sakha.enabledTools', value: null, category: 'sakha' },
    {
      key: 'knowledge.refreshHours',
      value: Number.parseInt(process.env.KNOWLEDGE_REFRESH_HOURS ?? '10', 10),
      category: 'knowledge',
    },
    { key: 'site.maintenanceMode', value: false, category: 'general' },
  ];

  for (const d of defaults) {
    const existing = await prisma.setting.findUnique({ where: { key: d.key } });
    if (existing) continue;
    await prisma.setting.create({ data: d });
  }
  log(`settings seeded`);
}

async function seedContent() {
  const existing = await prisma.contentRevision.findFirst({ where: { isPublished: true } });
  if (existing) {
    log(`content revision ${existing.version} already published, left untouched`);
    return;
  }

  const file = path.resolve(__dirname, '../../../content/site-content.json');
  const data = JSON.parse(await readFile(file, 'utf8'));

  const revision = await prisma.contentRevision.create({
    data: { data, message: 'Initial content from content/site-content.json', isPublished: true, publishedAt: new Date() },
  });
  await prisma.contentDraft.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', data },
    update: { data },
  });
  log(`published content revision ${revision.version}`);
}

async function seedCrawlSources() {
  const urls = (process.env.KNOWLEDGE_CRAWL_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const url of urls) {
    await prisma.crawlSource.upsert({
      where: { url },
      // Seeded DISABLED on purpose. Until the domain actually serves your site,
      // crawling it ingests whatever the registrar is parking there — we found
      // a "this domain is for sale" page in the knowledge base doing exactly
      // that. Enable each source from Admin → Knowledge once the site is live.
      create: { url, label: new URL(url).hostname, enabled: false, maxPages: 20 },
      update: {},
    });
  }
  if (urls.length) {
    log(`crawl sources: ${urls.length} (all DISABLED — enable them once the site is live)`);
  }
}

async function main() {
  console.log('\n▸ Seeding Sakha\n');

  await seedPermissions();
  const roles = await seedRoles();

  await ensureUser({
    email: process.env.SEED_SUPERADMIN_EMAIL,
    password: process.env.SEED_SUPERADMIN_PASSWORD,
    name: 'Gokul Madhesh',
    title: 'Chief Executive Officer & Chief Technology Officer',
    roleKey: SYSTEM_ROLES.SUPER_ADMIN,
    roles,
  });

  await ensureUser({
    email: process.env.SEED_ADMIN_BD_EMAIL,
    password: process.env.SEED_ADMIN_BD_PASSWORD,
    name: 'Malarvizhi',
    title: 'Business Development Manager',
    roleKey: SYSTEM_ROLES.ADMIN,
    roles,
  });

  await ensureUser({
    email: process.env.SEED_ADMIN_RESEARCH_EMAIL,
    password: process.env.SEED_ADMIN_RESEARCH_PASSWORD,
    name: 'Sai',
    title: 'Chief Research Officer',
    roleKey: SYSTEM_ROLES.ADMIN,
    roles,
  });

  await seedSettings();
  await seedContent();
  await seedCrawlSources();

  console.log('\n✓ Seed complete.\n');
  console.log('  Sign in at /signin with the SEED_* credentials in your .env.');
  console.log('  Change those passwords before this touches the internet.\n');
  console.log('  Note: the two admins have NO CMS access yet — that is deliberate.');
  console.log('  Grant it from Admin → People & Access as the super admin.\n');
}

main()
  .catch((err) => {
    console.error('\n✗ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
