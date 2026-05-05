# Family Budget App

Self-hosted Hebrew family-budget app for Israeli households. Replaces a Hebrew Excel ledger with:

- Auto bank/CC ingestion via [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers)
- Smart categorization (user rules + Claude Haiku LLM fallback)
- Installment auto-projection (no more re-entering iPhone payments every month)
- Recurring/anomaly detection
- A Hebrew Claude Sonnet 4.6 chat assistant with read-only DB tools
- Day-by-day × category grid that mirrors the source Excel layout

Architecture in one line: **single Hetzner CX32 VPS** runs Caddy + Next.js + Fastify worker + Postgres in Docker Compose.

## Repository layout

| Path | What lives here |
|------|------|
| `apps/web` | Next.js 15 frontend, Auth.js, chat drawer, dashboards |
| `apps/worker` | Fastify service: scrapers, categorizer pipeline, chatbot agent endpoint, cron |
| `packages/db` | Drizzle schema, encryption helpers, billing-month logic, merchant normalization |
| `packages/shared` | Zod schemas, Hebrew/English i18n, ILS formatters |
| `packages/categorizer` | Rules engine + Claude Haiku client for category fallback |
| `packages/chatbot` | Claude Sonnet agent + read-only DB tools |
| `infra` | `docker-compose.yml`, Caddyfile, Dockerfiles, `backup.sh`, `RESTORE.md` |

## Local development

```bash
# Prereqs: Node 22+, pnpm 9+, Docker Desktop
pnpm install

# Spin up Postgres only (everything else runs locally):
docker run -d --name budget-pg -p 5432:5432 \
    -e POSTGRES_DB=budget \
    -e POSTGRES_USER=budget \
    -e POSTGRES_PASSWORD=devpass \
    postgres:16-alpine

cp .env.example .env
# Fill in MASTER_KEY, AUTH_SECRET, ANTHROPIC_API_KEY, WORKER_INTERNAL_TOKEN
# Generate keys:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Migrate + seed default categories
pnpm db:generate    # only if you changed schema
pnpm db:migrate
pnpm db:seed

# Run frontend + worker side-by-side
pnpm dev
# web -> http://localhost:3000
# worker -> http://localhost:8080
```

## Production: Hetzner VPS setup runbook

Step-by-step from a fresh Hetzner CX32 (€8.50/mo, 4 vCPU / 8 GB RAM / 80 GB SSD, Falkenstein).

### 1. Provision the box

```bash
# In the Hetzner console:
#   Image: Debian 12
#   Type: CX32
#   Location: Falkenstein (FSN1) or Helsinki (HEL1)
#   SSH key: paste your public key — DO NOT use password auth
#   Cloud config: optional — see below
```

Optional `cloud-init` for first-boot hardening:

```yaml
#cloud-config
package_update: true
package_upgrade: true
packages:
  - ufw
  - fail2ban
  - unattended-upgrades
  - docker.io
  - docker-compose-v2
runcmd:
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable
  - systemctl enable --now fail2ban
  - dpkg-reconfigure -f noninteractive unattended-upgrades
```

### 2. Optional: encrypt the disk at rest

For maximum at-rest privacy, reinstall Debian onto a LUKS-encrypted root and add `dropbear-initramfs` so you can unlock by SSHing on boot. Hetzner's "Rescue System" walkthrough covers this. Skip if you're OK with provider-level encryption only.

### 3. Get a domain pointing at the box

Set an `A` record `budget.yourdomain.com` → VPS IP. Update `infra/Caddyfile` with your domain and email.

### 4. Clone + configure

```bash
ssh root@<VPS_IP>
adduser deploy --shell /bin/bash
usermod -aG docker deploy
su - deploy

git clone <YOUR_GIT_REMOTE> family-budget-app
cd family-budget-app

cp .env.example .env
nano .env   # fill in all values

# Secrets directory (gitignored, lives only on the VPS):
mkdir -p infra/secrets
echo "$(openssl rand -base64 32)" > infra/secrets/postgres_password
gpg --gen-key                                  # if you don't already have one
gpg --armor --export you@example.com > infra/secrets/gpg_pubkey.asc
```

### 5. Build + launch

```bash
cd infra
docker compose up -d --build
```

First boot triggers Caddy to obtain a Let's Encrypt cert. Watch logs:

```bash
docker compose logs -f caddy
```

### 6. Migrate + seed

```bash
docker compose exec worker pnpm db:migrate
docker compose exec worker pnpm db:seed   # default Hebrew categories
```

### 7. Create your admin users

The seed only creates the household + categories. Add your admin accounts via a one-shot script:

```bash
docker compose exec worker node -e '
  const { hash } = require("@node-rs/argon2");
  const { getDb, schema } = require("@fba/db");
  (async () => {
    const db = getDb(process.env.DATABASE_URL);
    const [hh] = await db.select().from(schema.households).limit(1);
    const passwordHash = await hash(process.argv[1], { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await db.insert(schema.users).values({
      householdId: hh.id,
      email: process.argv[2],
      passwordHash,
      role: "admin",
      displayName: process.argv[3],
    });
    console.log("user created");
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });
' '<YOUR_PASSWORD>' you@example.com 'Your Name'
```

(A real admin signup form ships in Phase 1.)

### 8. Visit the app

`https://budget.yourdomain.com` → sign in → enable 2FA → done.

## Phase 1 acceptance checklist

- [ ] Sign in with email + password + TOTP works
- [ ] Spouse account also works
- [ ] Default Hebrew categories appear in the admin
- [ ] Manual transaction CRUD writes audit-log entries
- [ ] Excel CSV import populates the last 3 months
- [ ] Day-by-day grid totals match the Excel exactly (0 ₪ tolerance)
- [ ] Chat drawer opens with ⌘K
- [ ] Asking "כמה הוצאנו על מכולת בחודש שעבר?" returns the right number
- [ ] `chat_tool_call_log` records exactly what the LLM saw
- [ ] B2 backup ran nightly, and a restore drill succeeds (see `infra/RESTORE.md`)

## Useful commands

```bash
pnpm typecheck                 # all packages
pnpm --filter @fba/web build
pnpm --filter @fba/worker dev
pnpm db:studio                 # Drizzle Studio in the browser

# Production:
docker compose logs -f web worker
docker compose exec postgres psql -U budget -d budget
docker compose pull && docker compose up -d --build  # update
```

## Troubleshooting

- **Caddy can't get a cert** — DNS hasn't propagated yet, or port 80 is firewalled. `dig budget.yourdomain.com` should return your VPS IP.
- **Worker can't connect to Postgres** — `docker compose logs postgres` for the actual error; `pg_isready -h postgres -U budget` from inside the worker container is a quick smoke test.
- **Chat returns 401** — `WORKER_INTERNAL_TOKEN` isn't shared between web and worker; both must read the same value from `.env`.
- **Scraper fails with auth_failed** — bank/CC password changed, or the bank rotated the captcha. Update credentials in `/admin/accounts` and re-trigger.

## License

Private — single-household use only. Do not redistribute.
