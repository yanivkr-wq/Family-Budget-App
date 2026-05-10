# Production deploy runbook

Step-by-step commands for the first deploy and subsequent updates of the
Family Budget App to a Hetzner VPS (or any Ubuntu 22.04+ box with Docker).

---

## Fast path (recommended): `infra/deploy-prod.sh`

After Docker is installed and the repo is cloned, the entire deploy is a
single script:

```bash
# On the server, after `apt install docker-ce` + `git clone ...`:
cd /opt/family-budget
chmod +x infra/deploy-prod.sh
./infra/deploy-prod.sh
```

It prompts for the IP, your Anthropic key, Gmail app password, B2
credentials, and admin email/password — then generates secrets, writes
`.env`, builds images, brings the stack up, runs migrations, seeds the
household + categories, and creates the admin user. Idempotent: safe to
re-run if any step fails.

The manual step-by-step below is the same flow broken into individual
commands, useful for debugging or one-off operations.

---

## First deploy (one-time, ~30-45 min total)

### Step 1 — SSH into the server

From your laptop's PowerShell:

```powershell
ssh -i $env:USERPROFILE\.ssh\hetzner_budget root@178.105.83.23
```

(Replace IP if yours differs. First connect prompts for fingerprint
acceptance — type `yes`.)

You should see a root shell prompt: `root@budget-prod:~#`.

All steps below run on the server unless noted otherwise.

### Step 2 — Install Docker + Compose plugin (~3 min)

```bash
# Update apt + install Docker via the official one-liner
curl -fsSL https://get.docker.com | sh

# Verify installed
docker --version
docker compose version
```

Expected: `Docker version 27.x` and `Docker Compose version v2.x`.

### Step 3 — Clone the repo

If your repo is on GitHub:

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/Family_Budget_App.git family-budget
cd family-budget
```

If the repo is private, you'll need either:
- A deploy key (recommended) — generate one with `ssh-keygen -t ed25519
  -f ~/.ssh/github_deploy -N ""`, paste `cat ~/.ssh/github_deploy.pub`
  into GitHub repo Settings → Deploy keys
- Or a Personal Access Token in the URL: `git clone
  https://USER:TOKEN@github.com/...`

If your repo isn't on GitHub yet: copy the project folder via `scp -r`
from your laptop.

### Step 4 — Generate production secrets

```bash
cd /opt/family-budget

# 32 random bytes, base64 — used in 3 places below
echo "MASTER_KEY=$(openssl rand -base64 32)"
echo "AUTH_SECRET=$(openssl rand -base64 32)"
echo "WORKER_INTERNAL_TOKEN=$(openssl rand -base64 32)"
```

Copy each value. **Save them in your password manager NOW** — they're
stored on the server but losing the server = losing them.

Generate the Postgres password too (the file already exists with a value
from dev — replace it on prod):

```bash
openssl rand -base64 24 > infra/secrets/postgres_password
chmod 600 infra/secrets/postgres_password
cat infra/secrets/postgres_password   # save this too — needed in .env DATABASE_URL
```

### Step 5 — Create the `.env` file

```bash
cp infra/env.production.template .env
nano .env
```

In nano, replace:
- `REPLACE_WITH_PG_PASSWORD` (in `DATABASE_URL` and `DATABASE_URL_DIRECT`)
  → the Postgres password you just generated
- `MASTER_KEY=GENERATE_ME_ON_SERVER` → the 32-byte random value
- `AUTH_SECRET=GENERATE_ME_ON_SERVER` → another 32-byte random value
- `WORKER_INTERNAL_TOKEN=GENERATE_ME_ON_SERVER` → another 32-byte random value
- `ANTHROPIC_API_KEY=sk-ant-REPLACE_ME` → your real key
- `SMTP_PASS=YOUR_GMAIL_APP_PASSWORD` → your Gmail app password
- `B2_KEY_ID=YOUR_B2_KEY_ID` + `B2_APP_KEY=YOUR_B2_APP_KEY` → your B2 creds
- (Optionally fill `TWILIO_*` if you want WhatsApp)

Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

Verify the file is readable only by root:
```bash
chmod 600 .env
ls -l .env   # should show -rw------- 1 root root
```

### Step 6 — Build the images

```bash
cd /opt/family-budget
docker compose -f infra/docker-compose.yml build
```

First build takes 5-10 min (downloads base images, installs all deps,
runs `pnpm build` for both web + worker). Subsequent builds are faster
thanks to Docker layer cache.

If the build fails, check:
- `pnpm-lock.yaml` is committed (frozen-lockfile=false handles this even
  if it's stale)
- The error message points to a missing dep or syntax error → fix locally
  and `git pull` again

### Step 7 — Start the stack

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
```

You should see 4 containers running:
- `infra-postgres-1` — healthy
- `infra-worker-1` — running
- `infra-web-1` — running
- `infra-caddy-1` — running

If any are restarting, check logs: `docker compose -f infra/docker-compose.yml logs <service>`.

### Step 8 — Run database migrations

The worker container has the source files + tsx (devDep of @fba/db).
Invoke it via the package-local bin path:

```bash
docker compose -f infra/docker-compose.yml exec worker \
  /app/packages/db/node_modules/.bin/tsx /app/packages/db/src/migrate.ts
```

If that fails, you can apply migrations manually via psql:

```bash
for f in /opt/family-budget/packages/db/drizzle/*.sql; do
  echo "Applying $f"
  docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U budget -d budget < "$f"
done
```

### Step 9 — Seed household + categories, then bootstrap admin user

`create-admin` requires a household to exist, which `seed` creates:

```bash
# 9a — household + default Hebrew categories (idempotent)
docker compose -f infra/docker-compose.yml exec worker \
  /app/packages/db/node_modules/.bin/tsx /app/packages/db/src/seed.ts

# 9b — admin user (substitute your real email + strong password)
docker compose -f infra/docker-compose.yml exec worker \
  /app/packages/db/node_modules/.bin/tsx /app/packages/db/src/create-admin.ts \
  --email=you@email.com --password='StrongPassword123!'
```

### Step 10 — Verify

From your laptop:

```powershell
# Test web app
curl -ksI http://178.105.83.23/

# Should return: HTTP/1.1 302 Found, Location: /sign-in
```

In a browser: visit `http://178.105.83.23/`. You'll see Chrome's
"Not secure" warning (expected without a domain). Click through, log in
with the admin credentials. The app should work normally.

### Step 11 — Trigger first manual backup

In the web app, navigate to `/admin/backups` → click **"גבה עכשיו"**.
Wait ~10 seconds. A new file should appear in the table AND in your B2
bucket. Confirms the prod backup pipeline works.

### Step 12 — Save key info

In your password manager, save:
- Server IP + SSH command
- Admin login email + password
- All 3 generated secrets (MASTER_KEY, AUTH_SECRET, WORKER_INTERNAL_TOKEN)
- Postgres password
- Anthropic + Gmail + Twilio + B2 credentials

You're done. Total time: ~30-45 min.

---

## Routine deploys (each app update, ~3 min)

When you've made code changes locally and want to push them to prod:

### Fastest path: `infra/update-prod.sh`

```bash
# On the server
cd /opt/family-budget && ./infra/update-prod.sh
```

This script:
- Discards local mode/whitespace changes that block `git pull`
- Pulls latest from GitHub
- Detects + applies new database migrations
- Rebuilds web + worker images (cached layers reused — usually 30-90 sec)
- Recreates those containers (~10 sec downtime)
- Leaves Postgres + Caddy untouched
- Prints status

If `git pull` shows nothing to update, the script exits early without touching anything.

### Option A — Manual via SSH

```powershell
# From your laptop
ssh -i $env:USERPROFILE\.ssh\hetzner_budget root@178.105.83.23
```

```bash
# On the server
cd /opt/family-budget
git pull
docker compose -f infra/docker-compose.yml build web worker
docker compose -f infra/docker-compose.yml up -d web worker
docker compose -f infra/docker-compose.yml exec worker \
  /app/packages/db/node_modules/.bin/tsx /app/packages/db/src/migrate.ts   # only if migrations changed
docker compose -f infra/docker-compose.yml ps   # verify still running
```

Total downtime per deploy: ~10 sec while web + worker re-create.

### Option B — One-liner from your laptop

```powershell
ssh -i $env:USERPROFILE\.ssh\hetzner_budget root@178.105.83.23 'cd /opt/family-budget && git pull && docker compose -f infra/docker-compose.yml build web worker && docker compose -f infra/docker-compose.yml up -d'
```

---

## Common operations

### View logs
```bash
docker compose -f infra/docker-compose.yml logs -f web         # web app
docker compose -f infra/docker-compose.yml logs -f worker      # worker (cron, scrapers, backups, notifications)
docker compose -f infra/docker-compose.yml logs -f postgres    # database
docker compose -f infra/docker-compose.yml logs -f caddy       # reverse proxy / TLS
```

### Restart a single service
```bash
docker compose -f infra/docker-compose.yml restart web
```

### Apply a new migration (after `git pull`)
```bash
docker compose -f infra/docker-compose.yml exec worker \
  /app/packages/db/node_modules/.bin/tsx /app/packages/db/src/migrate.ts
```

### Rotate the admin password
```bash
docker compose -f infra/docker-compose.yml exec worker \
  /app/packages/db/node_modules/.bin/tsx /app/packages/db/src/reset-password.ts \
  --email=you@email.com --password='NewStrongPassword456!'
```

### Stop everything (e.g. before a long maintenance)
```bash
docker compose -f infra/docker-compose.yml down
```

### Bring it back up
```bash
docker compose -f infra/docker-compose.yml up -d
```

---

## Switching from IP-only to a real domain

When you register a domain (e.g. `budget.yanivkr.com`):

1. Point the domain's A record at your server IP (`178.105.83.23`) in
   the DNS provider's UI. Wait ~5 min for propagation.

2. Edit `infra/Caddyfile`:
   - Replace `email admin@example.com` → your real email
   - Replace `:80 {` → `budget.yanivkr.com {`
   - At the bottom, add:
     ```
     :80 {
         redir https://budget.yanivkr.com{uri}
     }
     ```
   - Optionally re-enable HSTS by uncommenting that header

3. Edit `.env`:
   - Replace `APP_URL=http://178.105.83.23` → `https://budget.yanivkr.com`
   - Replace `AUTH_URL=http://178.105.83.23` → `https://budget.yanivkr.com`

4. Restart Caddy + web:
   ```bash
   docker compose -f infra/docker-compose.yml restart caddy web
   ```

5. Caddy auto-fetches a real Let's Encrypt cert within 30 sec.

6. Visit `https://budget.yanivkr.com/` — green padlock, no warnings.

---

## Troubleshooting

### Web app returns 502 Bad Gateway
Caddy can't reach the web container. Check: `docker compose ps`. If web
isn't running, look at `docker compose logs web`.

### Worker isn't running cron jobs
- Check container is up: `docker compose ps`
- Check logs for cron registration: should see "Cron registered: ..." 3 times at startup
- Check env: `docker compose exec worker env | grep CRON`

### Postgres won't start
- Check disk space: `df -h` (Postgres needs >100 MB free)
- Check logs: `docker compose logs postgres`
- Check the password secret file: `ls -l infra/secrets/postgres_password`
  (must be readable by root, contain a single line)

### "Permission denied" SSHing in
- Verify the key is in your laptop's `~/.ssh/`: `ls $env:USERPROFILE\.ssh\hetzner_budget`
- Verify the public key is registered on the server: in Hetzner UI →
  server → SSH keys

### Backups failing
- Check `/admin/backups` in the web app for the error message
- Check worker logs: `docker compose logs worker | grep -i backup`
- Verify B2 creds: `docker compose exec worker env | grep B2_`

### Need to nuke and start over (DANGEROUS — deletes all data)
```bash
docker compose -f infra/docker-compose.yml down -v   # -v removes volumes
docker compose -f infra/docker-compose.yml up -d
# Re-run migrations + create-admin
```
