#!/usr/bin/env node
/**
 * One-command first-run setup.
 *
 *   npm run setup
 *
 * Creates .env with real secrets if it does not exist, starts Postgres and
 * Redis, applies migrations, seeds, and builds the knowledge base. Safe to
 * re-run — it never overwrites an existing .env.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

const step = (n, total, msg) => console.log(`\n${c.bold(`[${n}/${total}]`)} ${msg}`);
const ok = (msg) => console.log(`  ${c.green('✓')} ${msg}`);
const warn = (msg) => console.log(`  ${c.yellow('!')} ${msg}`);

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
}

const secret = () => crypto.randomBytes(48).toString('base64url');

console.log(`\n${c.bold('Sakha AI')} ${c.dim('— first-run setup')}\n`);

const TOTAL = 6;

// ── 1. Environment ────────────────────────────────────────────────────────────
step(1, TOTAL, 'Environment');

if (existsSync(envPath)) {
  ok('.env already exists, leaving it alone');
} else {
  let env = readFileSync(path.join(root, '.env.example'), 'utf8');
  env = env
    .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${secret()}`)
    .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET=${secret()}`);
  writeFileSync(envPath, env, { mode: 0o600 });
  ok('.env created with freshly generated JWT secrets');
  warn('GROQ_API_KEY is still a placeholder — Sakha stays quiet until you set it');
}

// ── 2. Docker ─────────────────────────────────────────────────────────────────
step(2, TOTAL, 'Postgres and Redis');

try {
  run('docker info', { quiet: true });
} catch {
  console.error(`\n${c.red('✗')} Docker is not running. Start Docker Desktop and try again.\n`);
  process.exit(1);
}

run('docker compose up -d postgres redis');

process.stdout.write('  waiting for Postgres to accept connections');
let healthy = false;
for (let i = 0; i < 40; i += 1) {
  try {
    const out = run('docker compose ps --format json postgres', { quiet: true });
    if (out.includes('healthy')) {
      healthy = true;
      break;
    }
  } catch {
    /* container not up yet */
  }
  process.stdout.write('.');
  execSync('sleep 1');
}
console.log('');
if (!healthy) {
  console.error(`${c.red('✗')} Postgres did not become healthy. Try: docker compose logs postgres\n`);
  process.exit(1);
}
ok('Postgres and Redis are up');

// ── 3-6 ───────────────────────────────────────────────────────────────────────
step(3, TOTAL, 'Database schema');
run('npm run db:deploy');
ok('migrations applied');

step(4, TOTAL, 'Roles, permissions and accounts');
run('npm run db:seed');

step(5, TOTAL, "Sakha's knowledge base");
run('npm run knowledge:reindex');
ok('knowledge base built');

step(6, TOTAL, 'Done');

console.log(`
  ${c.bold('Start it:')}  npm run dev
  ${c.bold('Worker:')}    npm run worker      ${c.dim('(a second terminal — needed for scheduled indexing)')}

  ${c.bold('Site:')}      http://localhost:5173
  ${c.bold('Admin:')}     http://localhost:5173/admin

  Sign in with the SEED_* credentials in your .env.
  ${c.yellow('Change those passwords before this touches the internet.')}

  ${c.dim('The two admins have no CMS access yet — that is deliberate.')}
  ${c.dim('Grant it from Admin → People & access as the super admin.')}
`);
