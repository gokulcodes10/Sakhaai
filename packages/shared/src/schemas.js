/**
 * Zod schemas shared by the API (request validation) and the web app
 * (client-side form validation). One definition, two consumers — a field can
 * never drift between the form and the endpoint.
 */

import { z } from 'zod';
import { CONTENT_STATUS, LEAD_STAGE, USER_STATUS } from './constants.js';

// ── Primitives ────────────────────────────────────────────────────────────────

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email is required')
  .max(254)
  .email('That does not look like a valid email address');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long')
  .refine((v) => /[a-z]/.test(v), 'Include a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Include an uppercase letter')
  .refine((v) => /[0-9]/.test(v), 'Include a number');

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only');

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(24)
  .regex(/^[+()\d\s-]+$/, 'That does not look like a phone number');

export const cuidLike = z.string().trim().min(8).max(64);

// ── Auth ──────────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name').max(120),
  email: emailSchema,
  password: passwordSchema,
  company: z.string().trim().max(160).optional().or(z.literal('')),
  phone: phoneSchema.optional().or(z.literal('')),
  // Honeypot. Deliberately accepts any value: rejecting it here would return a
  // 400 naming the field, which tells a bot exactly which input is the trap.
  // The route accepts the request, discards it, and returns a normal success.
  website: z.string().max(300).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
  remember: z.boolean().optional().default(true),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(400),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

// ── Leads / contact ───────────────────────────────────────────────────────────

export const leadSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name').max(120),
  email: emailSchema,
  company: z.string().trim().max(160).optional().or(z.literal('')),
  phone: phoneSchema.optional().or(z.literal('')),
  // The one question that actually qualifies a lead, per the blueprint:
  // what workflow hurts, not "how can we help".
  workflow: z.string().trim().min(10, 'Describe the workflow in a sentence or two').max(2000),
  budgetTier: z.enum(['pilot', 'single', 'multi', 'unsure']).optional(),
  source: z.string().trim().max(120).optional(),
  // Honeypot — see registerSchema. Accepted, then silently discarded.
  website: z.string().max(300).optional(),
});

export const leadUpdateSchema = z.object({
  stage: z.nativeEnum(LEAD_STAGE).optional(),
  ownerId: cuidLike.nullable().optional(),
  notes: z.string().max(8000).optional(),
});

// ── Sakha ─────────────────────────────────────────────────────────────────────

export const sakhaMessageSchema = z.object({
  conversationId: cuidLike.optional().nullable(),
  message: z.string().trim().min(1, 'Ask Sakha something').max(4000),
  // Lets the assistant answer "what does this page say?" without re-retrieving.
  pageContext: z
    .object({
      path: z.string().max(300).optional(),
      title: z.string().max(300).optional(),
    })
    .optional(),
});

export const sakhaFeedbackSchema = z.object({
  messageId: cuidLike,
  rating: z.enum(['up', 'down']),
  comment: z.string().max(1000).optional(),
});

// ── CMS ───────────────────────────────────────────────────────────────────────

export const contentBlockSchema = z.object({
  path: z.string().trim().min(1).max(300), // dot path into site-content.json
  value: z.any(),
});

export const contentPatchSchema = z.object({
  changes: z.array(contentBlockSchema).min(1).max(200),
  message: z.string().trim().max(300).optional(),
});

export const publishSchema = z.object({
  message: z.string().trim().max(300).optional(),
});

export const pageSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(2).max(200),
  kind: z.enum(['page', 'industry', 'service', 'case_study', 'post']).default('page'),
  status: z.nativeEnum(CONTENT_STATUS).default(CONTENT_STATUS.DRAFT),
  summary: z.string().trim().max(600).optional(),
  body: z.string().max(200000).optional(),
  data: z.record(z.any()).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(400).optional(),
  ogImage: z.string().trim().max(600).optional(),
  order: z.number().int().min(0).max(9999).optional(),
});

// ── Knowledge base ────────────────────────────────────────────────────────────

export const knowledgeDocSchema = z.object({
  title: z.string().trim().min(2).max(300),
  body: z.string().min(1).max(500000),
  sourceUrl: z.string().url().max(1000).optional().or(z.literal('')),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  visibility: z.enum(['public', 'client', 'internal']).default('public'),
});

export const crawlSourceSchema = z.object({
  url: z.string().url().max(1000),
  label: z.string().trim().max(160).optional(),
  enabled: z.boolean().default(true),
  maxPages: z.number().int().min(1).max(200).default(20),
});

export const knowledgeSettingsSchema = z.object({
  refreshHours: z.number().int().min(1).max(168),
  topK: z.number().int().min(2).max(20).optional(),
  chunkTokens: z.number().int().min(120).max(1200).optional(),
});

// ── IAM ───────────────────────────────────────────────────────────────────────

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  key: slugSchema.optional(),
  description: z.string().trim().max(400).optional(),
  rank: z.number().int().min(1).max(99).default(30),
  permissions: z.array(z.string().max(80)).max(200).default([]),
});

export const roleGrantSchema = z.object({
  permissions: z.array(z.string().max(80)).max(200),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema.optional(),
  title: z.string().trim().max(120).optional(),
  roleKeys: z.array(slugSchema).min(1).max(10),
  status: z.nativeEnum(USER_STATUS).default(USER_STATUS.INVITED),
});

export const userUpdateSchema = userCreateSchema.partial().omit({ password: true });

export const userRolesSchema = z.object({
  roleKeys: z.array(slugSchema).min(1).max(10),
});

// ── Query helpers ─────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(60).optional(),
});
