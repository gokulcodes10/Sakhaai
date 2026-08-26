# ═════════════════════════════════════════════════════════════════════════════
#  Sakha API
#
#  Three stages so the runtime image carries neither the Prisma CLI (~65 MB)
#  nor its dev-only transitive dependencies (`effect`, `fast-check`, ~40 MB).
#  Migrations run from the `migrate` target instead — see docker-compose.yml.
# ═════════════════════════════════════════════════════════════════════════════

# ── Stage 1: full install, used only to generate the Prisma client ───────────
FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Every workspace manifest must be present for npm ci to resolve the lockfile,
# even though only the API tree is installed.
RUN npm ci --workspace @sakha/api --workspace @sakha/shared --include-workspace-root

COPY apps/api/prisma ./apps/api/prisma
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

# ── Stage 2: production dependencies only ────────────────────────────────────
FROM node:22-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci --omit=dev --workspace @sakha/api --workspace @sakha/shared --include-workspace-root \
 && npm cache clean --force

# The generated client and its query engine come from the build stage; the CLI
# that produced them does not.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

# @prisma/client declares the `prisma` CLI as a PEER dependency, so npm installs
# it even under --omit=dev — dragging in ~100 MB of tooling (the CLI itself,
# @prisma/config, effect, fast-check) that a running server never touches. The
# generated client and its query engine are already copied above and are all the
# runtime needs; migrations run from the `migrate` stage. The compose smoke test
# and `/api/ready` both exercise a real query against this pruned tree.
RUN rm -rf \
      node_modules/prisma \
      node_modules/@prisma/config \
      node_modules/@prisma/dev \
      node_modules/effect \
      node_modules/fast-check \
      node_modules/@effect \
      node_modules/.bin/prisma

# ── Stage 3: migrations (kept separate; carries the CLI) ─────────────────────
FROM build AS migrate
WORKDIR /app
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
CMD ["npx", "prisma", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"]

# ── Stage 4: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl tini \
 && addgroup -g 1001 sakha \
 && adduser -D -u 1001 -G sakha sakha

ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY content ./content

RUN mkdir -p apps/api/uploads && chown -R sakha:sakha /app
USER sakha

EXPOSE 4000

# tini reaps zombies and forwards SIGTERM, so graceful shutdown actually works.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/src/server.js"]
