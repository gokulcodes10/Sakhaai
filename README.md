# Sakha AI

The website, CMS and intelligence engine for **sakhaai.com** — built by **Sakha InfoTech**.

> **Trust. Grit. Agents that ship.**

A Node.js monorepo: a public marketing site, a client portal, a role-based CMS,
and **Sakha** — an agentic assistant that holds the company's knowledge, refreshes
itself on a schedule, and re-reads the site the moment anything is published.

---

## What is here

| Piece | What it does |
|---|---|
| `apps/web` | React 19 + Vite + Redux Toolkit. Marketing site, client portal, CMS admin. |
| `apps/api` | Express + Prisma + Postgres + Redis + BullMQ. |
| `packages/shared` | Zod schemas and the RBAC permission catalogue, shared by both. |
| `content/` | `site-content.json` — every word on the public site. `knowledge/` — markdown Sakha reads. |
| `infra/` | Nginx reverse proxy, Dockerfiles, dev TLS certificates. |

---

## Getting it running

**Needs:** Node 20.11+, Docker, and about five minutes.

```bash
cp .env.example .env          # then generate real secrets — see below
npm install
npm run infra:up              # postgres + redis in Docker
npm run db:deploy             # apply migrations
npm run db:seed               # roles, permissions, the three founder accounts
npm run dev                   # api on :4000, web on :5173
```

Open <http://localhost:5173>.

### Generate real secrets

```bash
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
```

The API **refuses to start in production** with placeholder secrets. That is deliberate.

### Turn Sakha on

Sakha needs a Groq key. Everything else works without one — the site, the CMS,
the portal, the knowledge base. Only the assistant goes quiet.

1. Get a key at <https://console.groq.com/keys>
2. Put it in `.env` as `GROQ_API_KEY=gsk_…`
3. Restart the API

---

## The accounts

`npm run db:seed` creates three, using the `SEED_*` values in `.env`:

| Person | Role | Starts with |
|---|---|---|
| Gokul Madhesh | `super_admin` | Everything |
| Malarvizhi | `admin` | Leads, clients, projects — **no CMS** |
| Sai | `admin` | Leads, clients, projects — **no CMS** |

**The admins having no CMS access is intentional.** The super admin grants it
deliberately, from **Admin → People & access**: pick the person, tick the
Content Management boxes, Save. It takes effect on their next request — no
sign-out, no deploy.

> Change the seeded passwords before this touches the internet.

---

## How the CMS works

`content/site-content.json` is the source of truth for every word on the site.
The CMS reads and writes that shape.

```
   site-content.json  ──seed──▶  ContentRevision (v1, published)
                                        │
                         editor edits ──▶ ContentDraft (working copy)
                                        │
                                   Publish
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
          ContentRevision (v2)   cache invalidated    Sakha re-indexes
```

- Nothing is public until someone presses **Publish**.
- Every publish writes an immutable revision — reverting republishes an old one
  as a *new* revision, so history is never rewritten.
- Publishing invalidates the response cache and enqueues a knowledge rebuild.
  Measured end to end: **under 30 seconds** from publish to Sakha answering with
  the new value.
- The editor walks the JSON and renders a field per leaf, so **adding a key to
  the JSON makes it editable with no code change**.
- Keys starting with `_` are editorial notes to whoever is editing — shown as
  guidance, never rendered on the site.

Industry pages, extra case studies and posts live in the `Page` table instead
(**Admin → Pages**), so a new vertical page takes about five minutes and appears
in the navigation automatically.

---

## How Sakha works

Not a chatbot. A bounded tool-calling loop over the company's own knowledge.

```
  visitor question
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │  system prompt (editable in the CMS)         │
  │  + page context + who is asking              │
  │  + a cheap pre-fetch on the first turn       │
  └─────────────────────────────────────────────┘
        │
        ▼
  Groq (gpt-oss-120b) ──▶ decides which tools to call
        │                        │
        │                        ├─ search_knowledge      hybrid retrieval
        │                        ├─ get_pricing           live from the CMS
        │                        ├─ list_services
        │                        ├─ list_case_studies
        │                        ├─ get_engagement_process
        │                        ├─ get_company_facts     live DB counts
        │                        ├─ capture_lead          creates a real Lead
        │                        └─ get_my_projects       signed-in clients only
        │
        ▼  (up to SAKHA_MAX_TOOL_STEPS rounds; tools withdrawn on the last)
   answer + citations
```

**Tools are role-scoped twice.** A tool the caller may not use is never
advertised to the model, *and* the handler re-checks on execution — so a
hallucinated tool name cannot reach data.

### Where her knowledge comes from

| Source | Refresh |
|---|---|
| `cms` — the live content tree and published pages | **Instantly, on every publish** |
| `doc` — markdown in `content/knowledge/` and CMS-written documents | Every 15 minutes |
| `db` — live counts and facts | Every 15 minutes |
| `crawl` — an allowlist of public URLs (robots.txt honoured) | Every `KNOWLEDGE_REFRESH_HOURS` (default 10; set to 1 for hourly) |

Every document carries a content checksum. **Unchanged documents are skipped
entirely** — no re-chunking, no re-embedding, no writes — which is what makes an
hourly refresh affordable rather than theoretical.

### Retrieval

Hybrid lexical search over Postgres: a weighted `tsvector` (headings outrank
body) queried with an OR-expansion of the question's content words plus domain
synonyms, an AND query as a precision bonus, and trigram similarity for typos.

Dense vectors are **optional** — set `EMBEDDING_PROVIDER=openai` and the indexer
backfills them on its next run. For a knowledge base of a few hundred chunks
about one company, good lexical search is competitive, costs nothing, needs no
extra key, and cannot silently go stale.

---

## Roles and permissions

Permissions are flat dotted strings (`cms.content.publish`). Grants come from
two places, unioned:

- **Roles** — a named bundle. Change it and every holder updates at once.
- **Direct user grants** — given to one person on top of their role. This is how
  the super admin hands the CMS to Malarvizhi *specifically*, without promoting
  every admin in the system.

Two invariants, enforced on every IAM endpoint:

1. **Rank.** You may only administer roles and users strictly below your own.
   An admin cannot edit another admin or touch a super admin.
2. **No escalation.** You may only grant permissions you personally hold.
   Without this, `iam.grant` alone would be equivalent to `*`.

Both are covered by tests. So is "the last super admin cannot demote themselves".

Changes take effect **immediately**: a permission change bumps the user's token
version in Redis, invalidating every access token minted before that moment.

---

## Commands

```bash
npm run dev              # api + web together
npm run dev:api          # api only
npm run dev:web          # web only
npm run worker           # background jobs (indexing, crawling, email)

npm run db:migrate       # create a migration from schema changes
npm run db:deploy        # apply migrations (production)
npm run db:seed          # reconcile roles/permissions, create founders
npm run db:studio        # browse the database
npm run db:reset         # wipe and start over (destructive)

npm run knowledge:reindex            # rebuild everything except the crawl
npm run knowledge:reindex -- crawl   # include the public-web crawl

npm test                             # unit tests
npm run test:integration --workspace @sakha/api   # against a real DB
npm run lint

npm run infra:up         # postgres + redis
npm run stack:up         # the whole thing behind nginx
```

---

## Production

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full walk-through.
The short version:

```bash
./infra/nginx/make-dev-certs.sh   # or drop real certs in infra/nginx/certs/
npm run stack:up
```

That builds and starts Postgres, Redis, the API, the worker, the web build and
Nginx. The API and the worker run as **separate containers** so a fifteen-minute
crawl can never add latency to a visitor's request.

---

## Things worth knowing

- **Redis is `noeviction`, on purpose.** Under `allkeys-lru` Redis will happily
  evict a queued BullMQ job and the work silently disappears. Every key this app
  writes carries a TTL, so memory stays bounded anyway.
- **BullMQ job ids cannot contain `:`.** It is the internal key separator, and
  a colon makes `add()` throw.
- **Rate limiting fails *closed* on auth and Sakha, *open* everywhere else.**
  A cache outage should slow the site, not take it down; an unmetered login
  endpoint is a credential-stuffing invitation and an unmetered LLM endpoint is
  somebody else's bill.
- **The contact form's honeypot returns a success.** Rejecting a filled honeypot
  with a validation error would name the field and tell the bot exactly where
  the trap is.
- **Crawl sources ship disabled.** Crawling a domain you have not launched yet
  indexes the registrar's parking page. (Ask how we know.)

---

## What is next

Phase 2 is the ERP. The groundwork is already here: the RBAC engine takes
arbitrary new permission domains, the audit log is append-only, and
`ClientAccount` / `Project` / `Document` / `Ticket` are the beginnings of the
schema it will grow into.
