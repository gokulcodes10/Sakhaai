/**
 * Central configuration. Every process.env read in the codebase happens here,
 * so a missing variable fails loudly at boot instead of quietly at 3am.
 */

import { z } from 'zod';

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const int = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int());

const list = (def = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? def
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
    );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: int(4000),
  PUBLIC_SITE_URL: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: list(['http://localhost:5173']),
  TRUST_PROXY: bool(false),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_PREFIX: z.string().default('sakha'),
  CACHE_TTL_SECONDS: int(300),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_DOMAIN: z.string().optional().default(''),
  ARGON_MEMORY_COST: int(19456),
  ARGON_TIME_COST: int(2),
  ARGON_PARALLELISM: int(1),

  RATE_LIMIT_GLOBAL_MAX: int(300),
  RATE_LIMIT_GLOBAL_WINDOW: int(60),
  RATE_LIMIT_AUTH_MAX: int(8),
  RATE_LIMIT_AUTH_WINDOW: int(300),
  RATE_LIMIT_SAKHA_ANON_MAX: int(15),
  RATE_LIMIT_SAKHA_ANON_WINDOW: int(3600),
  RATE_LIMIT_SAKHA_USER_MAX: int(120),
  RATE_LIMIT_SAKHA_USER_WINDOW: int(3600),
  RATE_LIMIT_LEAD_MAX: int(5),
  RATE_LIMIT_LEAD_WINDOW: int(3600),

  GROQ_API_KEY: z.string().optional().default(''),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  GROQ_MODEL_FAST: z.string().default('openai/gpt-oss-20b'),
  GROQ_MAX_TOKENS: int(1400),
  GROQ_TEMPERATURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 0.25 : Number.parseFloat(v))),
  SAKHA_MAX_TOOL_STEPS: int(5),
  SAKHA_HISTORY_TURNS: int(12),

  KNOWLEDGE_REFRESH_HOURS: int(10),
  KNOWLEDGE_CRAWL_URLS: list([]),
  KNOWLEDGE_CRAWL_MAX_PAGES: int(40),
  KNOWLEDGE_CRAWL_TIMEOUT_MS: int(15000),
  KNOWLEDGE_CRAWL_USER_AGENT: z.string().default('SakhaBot/1.0 (+https://sakhaai.com/bot)'),
  KNOWLEDGE_DOCS_DIR: z.string().default('content/knowledge'),
  KNOWLEDGE_CHUNK_TOKENS: int(350),
  KNOWLEDGE_CHUNK_OVERLAP: int(60),
  KNOWLEDGE_TOP_K: int(8),

  EMBEDDING_PROVIDER: z.enum(['none', 'openai']).default('none'),
  EMBEDDING_DIMENSIONS: int(1536),
  OPENAI_API_KEY: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: int(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_SECURE: bool(false),
  MAIL_FROM: z.string().default('Sakha AI <hello@sakhaai.com>'),
  LEADS_NOTIFY_TO: z.string().optional().default(''),

  UPLOAD_DIR: z.string().default('apps/api/uploads'),
  UPLOAD_MAX_BYTES: int(8388608),

  LOG_LEVEL: z.string().default('info'),
  LOG_PRETTY: bool(true),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
    .join('\n');

  console.error(`\n✗ Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

const env = parsed.data;
const isProd = env.NODE_ENV === 'production';

// Fail fast on defaults that are catastrophic in production.
if (isProd) {
  const weak = [];
  if (env.JWT_ACCESS_SECRET.includes('replace_me')) weak.push('JWT_ACCESS_SECRET');
  if (env.JWT_REFRESH_SECRET.includes('replace_me')) weak.push('JWT_REFRESH_SECRET');
  if (env.DATABASE_URL.includes('change_me')) weak.push('DATABASE_URL password');
  if (weak.length) {

    console.error(`\n✗ Refusing to start in production with placeholder secrets: ${weak.join(', ')}\n`);
    process.exit(1);
  }
}

export const config = {
  env: env.NODE_ENV,
  isProd,
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  port: env.API_PORT,
  siteUrl: env.PUBLIC_SITE_URL,
  apiUrl: env.PUBLIC_API_URL,
  corsOrigins: env.CORS_ORIGINS,
  trustProxy: env.TRUST_PROXY,

  db: { url: env.DATABASE_URL },

  redis: {
    url: env.REDIS_URL,
    prefix: env.REDIS_PREFIX,
    cacheTtl: env.CACHE_TTL_SECONDS,
  },

  auth: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    argon: {
      memoryCost: env.ARGON_MEMORY_COST,
      timeCost: env.ARGON_TIME_COST,
      parallelism: env.ARGON_PARALLELISM,
    },
  },

  rateLimit: {
    global: { max: env.RATE_LIMIT_GLOBAL_MAX, window: env.RATE_LIMIT_GLOBAL_WINDOW },
    auth: { max: env.RATE_LIMIT_AUTH_MAX, window: env.RATE_LIMIT_AUTH_WINDOW },
    sakhaAnon: { max: env.RATE_LIMIT_SAKHA_ANON_MAX, window: env.RATE_LIMIT_SAKHA_ANON_WINDOW },
    sakhaUser: { max: env.RATE_LIMIT_SAKHA_USER_MAX, window: env.RATE_LIMIT_SAKHA_USER_WINDOW },
    lead: { max: env.RATE_LIMIT_LEAD_MAX, window: env.RATE_LIMIT_LEAD_WINDOW },
  },

  groq: {
    apiKey: env.GROQ_API_KEY,
    baseUrl: env.GROQ_BASE_URL,
    model: env.GROQ_MODEL,
    fastModel: env.GROQ_MODEL_FAST,
    maxTokens: env.GROQ_MAX_TOKENS,
    temperature: env.GROQ_TEMPERATURE,
    /** True when a real key is present — the UI degrades gracefully when not. */
    get configured() {
      return Boolean(this.apiKey) && !this.apiKey.includes('REPLACE_ME');
    },
  },

  sakha: {
    maxToolSteps: env.SAKHA_MAX_TOOL_STEPS,
    historyTurns: env.SAKHA_HISTORY_TURNS,
  },

  knowledge: {
    refreshHours: env.KNOWLEDGE_REFRESH_HOURS,
    crawlUrls: env.KNOWLEDGE_CRAWL_URLS,
    crawlMaxPages: env.KNOWLEDGE_CRAWL_MAX_PAGES,
    crawlTimeoutMs: env.KNOWLEDGE_CRAWL_TIMEOUT_MS,
    crawlUserAgent: env.KNOWLEDGE_CRAWL_USER_AGENT,
    docsDir: env.KNOWLEDGE_DOCS_DIR,
    chunkTokens: env.KNOWLEDGE_CHUNK_TOKENS,
    chunkOverlap: env.KNOWLEDGE_CHUNK_OVERLAP,
    topK: env.KNOWLEDGE_TOP_K,
  },

  embedding: {
    provider: env.EMBEDDING_PROVIDER,
    dimensions: env.EMBEDDING_DIMENSIONS,
    openaiKey: env.OPENAI_API_KEY,
    get enabled() {
      return this.provider !== 'none' && Boolean(this.openaiKey);
    },
  },

  mail: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    secure: env.SMTP_SECURE,
    from: env.MAIL_FROM,
    leadsNotifyTo: env.LEADS_NOTIFY_TO,
    get enabled() {
      return Boolean(this.host && this.user);
    },
  },

  uploads: { dir: env.UPLOAD_DIR, maxBytes: env.UPLOAD_MAX_BYTES },

  log: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY && env.NODE_ENV !== 'production' },
};

export default config;
