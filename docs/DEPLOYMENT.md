# Deploying Sakha AI

Everything you need to get sakhaai.com onto a server, in the order it needs doing.

---

## 0. Before anything else

**The domain is not yours yet.** At the time this was built, `sakhaai.com`
resolved to a Spaceship.com parking page offering it for sale. Register it
first — the crawler, the canonical URLs, the cookie domain and the TLS
certificates all assume you own it.

Once registered, point an A record at your server's IP:

```
A     sakhaai.com       -> <server ip>
A     www.sakhaai.com   -> <server ip>
```

---

## 1. The server

A small VPS is plenty to start: **2 vCPU, 4 GB RAM, 40 GB disk**. Postgres,
Redis, the API, the worker and Nginx all fit comfortably, with room for the
knowledge base to grow.

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out and back in

git clone <your repo> /opt/sakha
cd /opt/sakha
```

---

## 2. Configuration

```bash
cp .env.example .env
```

Then work through it. The ones that matter:

```bash
NODE_ENV=production
PUBLIC_SITE_URL=https://sakhaai.com
PUBLIC_API_URL=https://sakhaai.com
CORS_ORIGINS=https://sakhaai.com,https://www.sakhaai.com
TRUST_PROXY=true
COOKIE_DOMAIN=.sakhaai.com

POSTGRES_PASSWORD=<something long and random>
DATABASE_URL="postgresql://sakha:<that password>@postgres:5432/sakha?schema=public"
REDIS_URL=redis://redis:6379

JWT_ACCESS_SECRET=<48 random bytes>
JWT_REFRESH_SECRET=<48 random bytes, different>

GROQ_API_KEY=gsk_<your key>
LOG_PRETTY=false
```

Generate the secrets properly:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**The API refuses to boot in production if any secret still contains
`replace_me`, or if the database password still contains `change_me`.** That is
a deliberate guard, not an inconvenience to work around.

Lock the file down:

```bash
chmod 600 .env
```

---

## 3. TLS

### Let's Encrypt (what you want)

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d sakhaai.com -d www.sakhaai.com

sudo mkdir -p /opt/sakha/infra/nginx/certs
sudo cp /etc/letsencrypt/live/sakhaai.com/fullchain.pem /opt/sakha/infra/nginx/certs/
sudo cp /etc/letsencrypt/live/sakhaai.com/privkey.pem  /opt/sakha/infra/nginx/certs/
```

Renewal, copying the new certs in and reloading Nginx:

```bash
sudo crontab -e
```

```cron
0 3 * * 1 certbot renew --quiet --pre-hook "docker stop sakha-nginx" --post-hook "cp /etc/letsencrypt/live/sakhaai.com/*.pem /opt/sakha/infra/nginx/certs/ && docker start sakha-nginx"
```

### Self-signed (local testing only)

```bash
./infra/nginx/make-dev-certs.sh
```

---

## 4. Start it

```bash
npm run stack:up        # docker compose --profile full up -d --build
```

That builds and starts `postgres`, `redis`, `migrate`, `api`, `worker`, `web`
and `nginx`.

**Migrations run automatically.** The `migrate` service applies them and exits;
`api` and `worker` both wait on `service_completed_successfully`, so neither can
ever start against an old schema. It carries the Prisma CLI so the runtime image
does not have to.

Then seed, once per deploy:

```bash
docker compose exec api node apps/api/prisma/seed.js
```

The seed is **idempotent** — safe to run every time. It reconciles the
permission catalogue and adds any new permissions a release introduced. It never
overwrites a grant an admin made through the CMS.

---

## 5. Check it

```bash
curl -sk https://sakhaai.com/api/health          # {"status":"ok",...}
curl -sk https://sakhaai.com/api/ready           # database + redis + llm
curl -sk https://sakhaai.com/api/sakha/status    # is the assistant connected
docker compose logs -f api worker
```

Then, in a browser:

1. Sign in as the super admin.
2. **Admin → Knowledge** — confirm the document count is non-zero and the last
   rebuild is recent.
3. **Admin → Knowledge → Public sources** — now that the site is actually live,
   enable the crawl sources. They ship disabled on purpose.
4. **Admin → Content** — change something trivial, publish, and watch the
   knowledge base rebuild within about thirty seconds.
5. Ask Sakha about the thing you just changed.

---

## 6. First-day tasks

- [ ] Change all three seeded passwords.
- [ ] Put a real phone number in the content (`company.phone`) — the site
      promises a founder answers, so it has to reach one.
- [ ] Add real founder photos and LinkedIn URLs (**Admin → Content → About**).
- [ ] **Review the pricing.** The numbers in `site-content.json` are considered
      defaults for the Indian SMB market, not a quote from your books.
      Publishing a price you cannot deliver at is worse than publishing nothing.
- [ ] Add the CIN / GSTIN to the footer once registration completes.
- [ ] Configure SMTP, or lead notifications only reach the logs.
- [ ] Grant CMS access to whichever admins should have it.

---

## Backups

Nothing here is worth more than the database. Back it up before you need to.

```bash
# /opt/sakha/backup.sh
#!/usr/bin/env bash
set -euo pipefail
DEST=/var/backups/sakha
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M)

docker compose exec -T postgres pg_dump -U sakha sakha | gzip > "$DEST/db-$STAMP.sql.gz"
tar czf "$DEST/uploads-$STAMP.tar.gz" -C /var/lib/docker/volumes/sakha_uploads/_data .

# Keep 30 days
find "$DEST" -name '*.gz' -mtime +30 -delete
```

```cron
0 2 * * * /opt/sakha/backup.sh >> /var/log/sakha-backup.log 2>&1
```

Restore:

```bash
gunzip -c db-20260826-0200.sql.gz | docker compose exec -T postgres psql -U sakha sakha
```

Redis needs no backup — everything in it is a cache, a rate-limit window, a lock
or a queued job, and all of it rebuilds. Losing Redis costs you a slow first
request, not data.

---

## Updating

```bash
cd /opt/sakha
git pull
npm run stack:up        # rebuilds changed images and runs migrations
docker compose exec api node apps/api/prisma/seed.js
```

Zero-downtime is not configured — a deploy is a few seconds of interruption. At
this stage that is the right trade. When it stops being right, run two API
containers behind the existing Nginx upstream and restart them one at a time;
the app already tolerates it (Redis holds sessions, rate limits, cache and the
index lock, so two instances never fight).

---

## SEO

The site is a client-rendered SPA. Google executes JavaScript and will index it,
but Bing and most social-preview crawlers are less reliable.

When organic search starts mattering:

1. **Prerender the marketing routes.** `vite-plugin-prerender` or a small
   Puppeteer script over the public routes at build time is enough — the
   content all comes from one API call, so there is nothing dynamic to solve.
2. **Serve a sitemap.** Generate it from `site-content.json` plus published
   `Page` rows.
3. **Add JSON-LD.** `seo.organizationSchema` in the content file is already
   shaped for it.

Not doing this yet is a deliberate call: at three case studies and no reviews,
inbound will come from founder-led sales, not from search.

---

## Where to look when something is wrong

| Symptom | Look at |
|---|---|
| Site loads, no content | `docker compose logs api` — Postgres reachable? |
| Sakha says she is not connected | `GROQ_API_KEY` in `.env`, then `/api/sakha/status` |
| Sakha answers with stale facts | **Admin → Knowledge** → last rebuild time; check `docker compose logs worker` |
| Published content not showing | `X-Cache` header on `/api/content`; **Admin → Overview** → revision number |
| Everything is 429 | Redis down → auth and Sakha fail closed by design. `docker compose logs redis` |
| Jobs not running | Is `worker` up? `docker compose ps`. Check `/api/ops/jobs` |
| Nothing works after a deploy | `docker compose logs api | head -50` — the config guard prints exactly what is wrong |
