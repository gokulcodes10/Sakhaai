# Architecture

Why the system is shaped the way it is. The README says what it does; this says
what the alternatives were and why they were not taken.

---

## The stack

```
                         ┌──────────────┐
     visitor ──HTTPS──▶  │    Nginx     │  TLS, gzip, coarse rate limits,
                         │              │  static assets, security headers
                         └──────┬───────┘
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ┌───────────────┐       ┌───────────────┐
            │   web (SPA)   │       │   api (Node)  │
            │ React + Redux │       │    Express    │
            └───────────────┘       └───────┬───────┘
                                            │
                        ┌───────────────────┼───────────────────┐
                        ▼                   ▼                   ▼
                 ┌────────────┐     ┌────────────┐     ┌────────────┐
                 │  Postgres  │     │   Redis    │     │    Groq    │
                 │ data + FTS │     │ cache,     │     │  the LLM   │
                 │            │     │ limits,    │     │            │
                 │            │     │ queues     │     │            │
                 └────────────┘     └─────┬──────┘     └────────────┘
                                          │
                                    ┌─────▼──────┐
                                    │   worker   │  indexing, crawling, email
                                    └────────────┘
```

The worker is a **separate process and a separate container**. A knowledge
rebuild that crawls forty pages takes minutes; sharing an event loop with
request handling would make every visitor pay for it.

---

## Decisions worth defending

### JavaScript, not TypeScript

Zod validates at every boundary — request bodies, environment configuration,
LLM tool arguments — which is where type errors actually reach production. The
build step TypeScript would add is one more thing that can fail between a
working commit and a running server, and the safety it buys inside a module is
largely duplicated by the validation already at the edges.

The shared package exports Zod schemas rather than types, so the frontend form
and the backend endpoint validate against **one definition**. A field cannot
drift between them.

If the team grows past three, revisit this. The migration is mechanical.

### Lexical retrieval by default, embeddings optional

Groq does not serve an embeddings endpoint, so dense vectors would mean a second
paid provider on day one for a knowledge base of roughly thirty documents about
one company.

Instead: Postgres `tsvector` with weighted headings, queried with an
OR-expansion of the question's content words plus a small domain synonym map
(`cost → price, pricing`; `ceo → chief, executive, founder`), an AND query as a
precision bonus, and trigram similarity for typos.

Measured on the real content, this retrieves the correct document for every
question we tried. `EMBEDDING_PROVIDER=openai` turns on dense search and
reciprocal-rank fusion; the indexer backfills vectors on its next run.

### The content tree is a single JSON document

The obvious alternative is a table per content type. That is the right answer at
fifty content types and the wrong one at eight: it means a migration every time
marketing wants a new field.

One JSON document means the CMS can walk it and render a field per leaf, so
**adding a key makes it editable with no code change**. It also means the site
and Sakha read from the same object, so a page and the assistant cannot disagree
about the price.

Where per-row structure genuinely helps — industry pages, case studies, posts,
which need their own URLs, statuses and ordering — there is a `Page` table.

### Draft and published are separate rows, and history is immutable

`ContentDraft` is a single mutable row. `ContentRevision` is append-only.
Publishing snapshots the draft into a new revision. **Reverting republishes an
old revision's data as a new revision** rather than deleting anything, so the
audit trail stays truthful: you can always see that a revert happened, when, and
by whom.

### Permissions are strings, not an enum

A flat dotted string (`cms.content.publish`) with one level of wildcard is
enough for everything the brief describes and everything the ERP will need,
without a schema change per capability. The catalogue lives in
`packages/shared/src/rbac.js` and the seed reconciles it into the database on
every deploy — so a new permission is one array entry, and the grant UI picks it
up automatically.

### Direct user grants exist alongside roles

The brief asks the super admin to grant CMS access to two specific admins. With
roles alone, that means either promoting every admin (wrong) or creating a
role per person (unmanageable).

`UserGrant` gives one person one permission on top of their role. Effective
permissions are the union. It is the difference between "all admins can edit the
site" and "Malarvizhi can edit the site".

### Permission changes take effect immediately

The naive design lets a revoked admin keep their access until their 15-minute
access token expires. That is a real window.

Instead: every access token carries a `ver` claim, and any change to a user's
roles or grants increments their version counter in Redis. The auth middleware
compares them on every request; a mismatch means re-resolving permissions from
the database. **Revocation is effective on the very next request.** There is an
integration test for exactly this.

### Rate limiting fails open in one place and closed in another

If Redis is unavailable:

- **Read traffic fails open.** A cache outage should slow the marketing site,
  not take it offline.
- **Auth and Sakha fail closed.** An unmetered login endpoint is a
  credential-stuffing invitation. An unmetered LLM endpoint is somebody else's
  bill.

This asymmetry is the whole point; a uniform policy gets one of the two wrong.

### Sakha decides what to retrieve

The simpler design retrieves once on the user's raw question and stuffs the
result into the prompt. It fails on compound questions — "what does a pilot cost
and how long does it take" is one query against two documents.

Letting the model call `search_knowledge` as a tool means it can issue several
targeted searches and read the results before answering. The cost is a round
trip, which is why the **first** turn still does a cheap pre-fetch: that is
where latency is most visible, and where the question is most likely to be
simple.

Tools are withdrawn on the final step, so the loop must terminate in an answer.

### Tools are filtered twice

A tool the caller is not allowed to use is never put in the model's tool list,
*and* the handler re-checks authorisation before doing anything. The first is
what keeps the model honest; the second is what keeps a hallucinated tool name
from reaching data.

### Checksums, not timestamps, decide what to re-index

Every knowledge document stores a SHA-256 of its title and body. A rebuild that
finds an unchanged checksum skips chunking, embedding and writing entirely.

This is what makes the refresh cadence a real dial rather than a theoretical
one: an hourly rebuild of thirty documents where two changed costs two document
writes, not thirty.

### Redis runs `noeviction`

BullMQ requires it, and the reason is worth stating plainly: under
`allkeys-lru`, Redis will evict a queued job hash and the work silently
disappears. Every key this application writes carries a TTL — cache entries,
rate-limit windows, locks, revocations — so memory stays bounded without
eviction, and cache writes degrade gracefully if it ever does fill.

---

## Request lifecycles

### A visitor loading the homepage

```
GET /                → Nginx → SPA shell (no-cache on index.html)
GET /api/content     → Nginx → API
                       ├─ anonymous? → Redis cache → HIT, done (~2 ms)
                       └─ MISS → Postgres (published revision + pages)
                                → merge CMS industry pages into the tree
                                → cache under the "content" tag
```

Signed-in requests are **never** served from the shared cache — one leaked
personalised response is a data breach, not a performance bug.

### An editor publishing

```
PATCH /api/content/draft   → validate dot-paths against the live tree
                             → refuse unknown paths (a typo must not
                               silently invent a key and lose the edit)
                             → write ContentDraft
POST  /api/content/publish → transaction:
                               unpublish current revision
                               insert new revision, published
                             → write the tree to Redis
                             → invalidate the "content" and "pages" tags
                             → enqueue a reindex (deduped per minute)
                             → audit log
worker                     → runIndex under a distributed lock
                             → checksum every document, rebuild what changed
```

### A question to Sakha

```
POST /api/sakha/chat  → rate limit (fails closed; anonymous get far less)
                      → resolve or create the conversation, ownership checked
                      → load history (bounded window)
                      → first turn? cheap pre-fetch of context
                      → tool-calling loop, ≤ SAKHA_MAX_TOOL_STEPS
                      → persist both messages with citations, tool trace,
                        token counts and latency
                      → title the thread in the background
```

Every turn is stored with what it retrieved and which tools it called, so a bad
answer can be diagnosed after the fact rather than guessed at.

---

## Where the ERP plugs in

Phase 2 needs very little new foundation:

- **Permissions** — add an `erp` domain to the catalogue. The seed reconciles
  it, the grant UI renders it, the middleware enforces it. No schema change.
- **Roles** — the super admin already creates arbitrary roles with arbitrary
  permission sets, at any rank below their own.
- **Audit** — append-only and already recording every mutation.
- **Data** — `ClientAccount`, `Project`, `ProjectUpdate`, `Document` and
  `Ticket` are the beginnings of the schema.
- **Sakha** — a new tool is one entry in `TOOLS` with a `requires` array. Add
  `get_invoice_status` and she can answer it, scoped to the caller, without any
  other change.

The one thing to decide early: whether the ERP is a module of this application
or a separate service behind the same Nginx. Given three people, the same
database and a shared permission model, **a module** is almost certainly right
until it demonstrably is not.
