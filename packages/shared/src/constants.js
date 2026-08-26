/**
 * Company-wide constants. Single source of truth shared by api + web.
 */

export const COMPANY = {
  legalName: 'Sakha InfoTech',
  brandName: 'Sakha AI',
  domain: 'sakhaai.com',
  tagline: 'Trust. Grit. Agents that ship.',
  originLine: 'Made possible by three friends, with trust and grit.',
  assistantName: 'Sakha',
  assistantMeaning: 'friend',
};

/** Roles that ship with the system and cannot be deleted. */
export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
  CLIENT: 'client',
};

/** Ordering used for "can this role manage that role" checks. Higher wins. */
export const ROLE_RANK = {
  [SYSTEM_ROLES.SUPER_ADMIN]: 100,
  [SYSTEM_ROLES.ADMIN]: 70,
  [SYSTEM_ROLES.EMPLOYEE]: 40,
  [SYSTEM_ROLES.CLIENT]: 10,
};

export const USER_STATUS = {
  ACTIVE: 'active',
  INVITED: 'invited',
  SUSPENDED: 'suspended',
};

export const CONTENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

export const KNOWLEDGE_SOURCE = {
  CMS: 'cms',
  DOC: 'doc',
  CRAWL: 'crawl',
  DB: 'db',
  MANUAL: 'manual',
};

export const LEAD_STAGE = {
  NEW: 'new',
  QUALIFIED: 'qualified',
  MEMO_SENT: 'memo_sent',
  WON: 'won',
  LOST: 'lost',
};
