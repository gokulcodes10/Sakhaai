/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  RBAC: permission catalogue + default role grants.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Permissions are flat, dotted strings: "<domain>.<resource>.<action>".
 *  A wildcard "*" grants everything (super admin only).
 *  A domain wildcard like "cms.*" grants everything under that domain.
 *
 *  These constants define the SHIPPED defaults. At runtime the authoritative
 *  grants live in Postgres (Role / Permission / RolePermission), because the
 *  super admin can create new roles and re-grant permissions without a deploy.
 *  The seed script reconciles this file INTO the database.
 */

import { SYSTEM_ROLES } from './constants.js';

/** Every permission the system understands, grouped for the CMS grant UI. */
export const PERMISSION_CATALOGUE = [
  {
    domain: 'cms',
    label: 'Content Management',
    description: 'Edit the public website without a deploy.',
    permissions: [
      { key: 'cms.access', label: 'Open the CMS', description: 'Base permission — required for every other CMS action.' },
      { key: 'cms.content.read', label: 'View content', description: 'Read every page, section and block.' },
      { key: 'cms.content.write', label: 'Edit content', description: 'Save draft changes to any content block.' },
      { key: 'cms.content.publish', label: 'Publish content', description: 'Push drafts live and trigger a Sakha re-index.' },
      { key: 'cms.content.revert', label: 'Revert content', description: 'Roll the site back to an earlier revision.' },
      { key: 'cms.media.read', label: 'View media library', description: null },
      { key: 'cms.media.write', label: 'Upload / delete media', description: null },
      { key: 'cms.navigation.write', label: 'Edit navigation', description: 'Reorder menus, add industry pages.' },
      { key: 'cms.seo.write', label: 'Edit SEO metadata', description: 'Titles, descriptions, OG images, redirects.' },
    ],
  },
  {
    domain: 'knowledge',
    label: 'Sakha Knowledge Base',
    description: "Control what the assistant knows.",
    permissions: [
      { key: 'knowledge.read', label: 'Browse the knowledge base', description: null },
      { key: 'knowledge.write', label: 'Add / edit knowledge documents', description: null },
      { key: 'knowledge.delete', label: 'Delete knowledge documents', description: null },
      { key: 'knowledge.sources.write', label: 'Manage crawl sources', description: 'Add or remove the public URLs Sakha reads.' },
      { key: 'knowledge.reindex', label: 'Trigger a re-index', description: 'Force an immediate rebuild ahead of schedule.' },
      { key: 'knowledge.settings.write', label: 'Change refresh schedule', description: 'Set the 1h / 10h / custom cadence.' },
    ],
  },
  {
    domain: 'sakha',
    label: 'Assistant',
    description: 'The Sakha intelligence engine itself.',
    permissions: [
      { key: 'sakha.chat', label: 'Talk to Sakha', description: 'Granted to the public too, via the anonymous role.' },
      { key: 'sakha.conversations.read', label: 'Read all conversations', description: 'See what visitors are asking. Powerful — treat as sensitive.' },
      { key: 'sakha.settings.write', label: 'Tune Sakha', description: 'System prompt, model, temperature, tool access.' },
      { key: 'sakha.tools.write', label: 'Enable / disable tools', description: 'Control which live actions Sakha may take.' },
    ],
  },
  {
    domain: 'crm',
    label: 'Leads & Clients',
    description: 'Everything that comes in through the site.',
    permissions: [
      { key: 'crm.leads.read', label: 'View leads', description: null },
      { key: 'crm.leads.write', label: 'Edit / assign leads', description: null },
      { key: 'crm.leads.delete', label: 'Delete leads', description: null },
      { key: 'crm.clients.read', label: 'View client accounts', description: null },
      { key: 'crm.clients.write', label: 'Edit client accounts', description: null },
      { key: 'crm.projects.read', label: 'View projects', description: null },
      { key: 'crm.projects.write', label: 'Edit projects', description: null },
    ],
  },
  {
    domain: 'iam',
    label: 'People & Access',
    description: 'Users, roles and permissions. Super admin territory.',
    permissions: [
      { key: 'iam.users.read', label: 'View users', description: null },
      { key: 'iam.users.write', label: 'Create / edit users', description: null },
      { key: 'iam.users.delete', label: 'Deactivate users', description: null },
      { key: 'iam.roles.read', label: 'View roles', description: null },
      { key: 'iam.roles.write', label: 'Create / edit roles', description: 'Define new roles such as "Content Editor" or "Sales Intern".' },
      { key: 'iam.roles.delete', label: 'Delete custom roles', description: null },
      { key: 'iam.grant', label: 'Grant permissions', description: 'Give another role or user a permission you hold. The keys to the kingdom.' },
    ],
  },
  {
    domain: 'ops',
    label: 'Operations',
    description: 'Audit, jobs and system health.',
    permissions: [
      { key: 'ops.audit.read', label: 'Read the audit log', description: null },
      { key: 'ops.jobs.read', label: 'View background jobs', description: null },
      { key: 'ops.jobs.write', label: 'Retry / cancel jobs', description: null },
      { key: 'ops.cache.purge', label: 'Purge the cache', description: null },
      { key: 'ops.settings.write', label: 'Change system settings', description: null },
    ],
  },
  {
    domain: 'portal',
    label: 'Client Portal',
    description: 'What a signed-in client can do.',
    permissions: [
      { key: 'portal.access', label: 'Access the client portal', description: null },
      { key: 'portal.projects.read', label: 'View own projects', description: null },
      { key: 'portal.documents.read', label: 'View own documents', description: null },
      { key: 'portal.tickets.write', label: 'Raise support requests', description: null },
    ],
  },
];

/** Flat list of every permission key. */
export const ALL_PERMISSIONS = PERMISSION_CATALOGUE.flatMap((g) =>
  g.permissions.map((p) => p.key)
);

/** Lookup: key -> { ...permission, domain, domainLabel } */
export const PERMISSION_INDEX = Object.fromEntries(
  PERMISSION_CATALOGUE.flatMap((g) =>
    g.permissions.map((p) => [p.key, { ...p, domain: g.domain, domainLabel: g.label }])
  )
);

/**
 * Default grants for the four system roles.
 *
 * Deliberate choice: ADMIN does NOT get `cms.*` by default. The brief is
 * explicit that the super admin grants CMS access to the two admins — so it
 * has to start off, or the grant is meaningless.
 */
export const DEFAULT_ROLE_PERMISSIONS = {
  [SYSTEM_ROLES.SUPER_ADMIN]: ['*'],

  [SYSTEM_ROLES.ADMIN]: [
    'crm.leads.read',
    'crm.leads.write',
    'crm.clients.read',
    'crm.clients.write',
    'crm.projects.read',
    'crm.projects.write',
    'knowledge.read',
    'sakha.chat',
    'sakha.conversations.read',
    'iam.users.read',
    'iam.roles.read',
    'ops.audit.read',
  ],

  [SYSTEM_ROLES.EMPLOYEE]: [
    'crm.leads.read',
    'crm.projects.read',
    'knowledge.read',
    'sakha.chat',
  ],

  [SYSTEM_ROLES.CLIENT]: [
    'portal.access',
    'portal.projects.read',
    'portal.documents.read',
    'portal.tickets.write',
    'sakha.chat',
  ],
};

/** Permissions available to a visitor who is not signed in at all. */
export const ANONYMOUS_PERMISSIONS = ['sakha.chat'];

/**
 * Does `granted` satisfy `required`?
 * Understands "*" and one level of domain wildcard ("cms.*", "cms.content.*").
 *
 * @param {string[]} granted
 * @param {string} required
 * @returns {boolean}
 */
export function permissionSatisfies(granted, required) {
  if (!required) return true;
  if (!Array.isArray(granted) || granted.length === 0) return false;
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;

  const parts = required.split('.');
  // Walk prefixes: "cms.content.publish" -> "cms.*", "cms.content.*"
  for (let i = 1; i < parts.length; i += 1) {
    if (granted.includes(`${parts.slice(0, i).join('.')}.*`)) return true;
  }
  return false;
}

/** True when `granted` satisfies every entry in `required`. */
export function permissionSatisfiesAll(granted, required = []) {
  return required.every((r) => permissionSatisfies(granted, r));
}

/** True when `granted` satisfies at least one entry in `required`. */
export function permissionSatisfiesAny(granted, required = []) {
  if (required.length === 0) return true;
  return required.some((r) => permissionSatisfies(granted, r));
}

/**
 * Expand a wildcard grant list into concrete permission keys — used by the CMS
 * grant UI so a super admin sees ticked checkboxes rather than a bare "*".
 */
export function expandPermissions(granted = []) {
  if (granted.includes('*')) return [...ALL_PERMISSIONS];
  const out = new Set();
  for (const g of granted) {
    if (!g.endsWith('.*')) {
      out.add(g);
      continue;
    }
    const prefix = g.slice(0, -1); // "cms.*" -> "cms."
    ALL_PERMISSIONS.filter((p) => p.startsWith(prefix)).forEach((p) => out.add(p));
  }
  return [...out];
}
