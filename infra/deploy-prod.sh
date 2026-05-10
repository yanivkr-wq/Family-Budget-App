#!/usr/bin/env bash
# ============================================================================
# Family Budget App — one-shot production deploy script
# ============================================================================
# Run on a fresh Hetzner (or any Ubuntu 22.04+) box AFTER:
#   1. Docker is installed (docker --version + docker compose version both work)
#   2. This repo is cloned to /opt/family-budget
#   3. You're root (or sudo) inside /opt/family-budget
#
# What it does (idempotent — safe to re-run if a step fails):
#   - Generates production secrets if missing
#   - Builds the .env file from infra/env.production.template
#   - Builds Docker images
#   - Brings the stack up
#   - Waits for Postgres to be healthy
#   - Runs database migrations
#   - Optionally bootstraps an admin user
#
# Required env vars (will prompt if missing):
#   - SERVER_IP        — public IP of this box (used in APP_URL/AUTH_URL)
#   - ANTHROPIC_API_KEY — your Claude API key (sk-ant-...)
#   - SMTP_PASS        — Gmail app password (or set to "" to skip email)
#   - B2_KEY_ID        — Backblaze B2 Application Key ID
#   - B2_APP_KEY       — Backblaze B2 Application Key
#   - ADMIN_EMAIL      — for the bootstrap admin user
#   - ADMIN_PASSWORD   — for the bootstrap admin user
#
# Usage:
#   cd /opt/family-budget
#   chmod +x infra/deploy-prod.sh
#   ./infra/deploy-prod.sh
#
# Or non-interactive:
#   SERVER_IP=178.105.83.23 ANTHROPIC_API_KEY=sk-ant-... \
#     SMTP_PASS=xxxx B2_KEY_ID=... B2_APP_KEY=... \
#     ADMIN_EMAIL=you@email.com ADMIN_PASSWORD='Strong!' \
#     ./infra/deploy-prod.sh
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------- helpers ----------
say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

prompt_if_unset() {
  local var="$1" desc="$2" hidden="${3:-}" val
  if [[ -z "${!var:-}" ]]; then
    if [[ "$hidden" == "hidden" ]]; then
      IFS= read -srp "    $desc: " val; echo
    else
      IFS= read -rp "    $desc: " val
    fi
    # SMTP_PASS is the only one that may legitimately be empty (skip email)
    if [[ -z "$val" && "$var" != "SMTP_PASS" ]]; then
      die "$var is required"
    fi
    # nameref avoids eval — safe for values containing $, `, etc.
    declare -gn _ref="$var"
    _ref="$val"
    unset -n _ref
  fi
}

# ---------- preflight ----------
say "Preflight checks"
[[ $EUID -eq 0 ]] || die "Run as root (or with sudo)"
command -v docker >/dev/null || die "docker not installed — run: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || die "docker compose plugin not available"
[[ -f infra/docker-compose.yml ]] || die "infra/docker-compose.yml missing — wrong directory?"
[[ -f infra/env.production.template ]] || die "infra/env.production.template missing"
ok "docker $(docker --version | awk '{print $3}' | tr -d ',') + compose $(docker compose version --short)"
ok "running as root in $REPO_ROOT"

# ---------- collect required values ----------
say "Collecting deployment config (Ctrl+C to abort)"
prompt_if_unset SERVER_IP        "Public IP of this server (e.g. 178.105.83.23)"
prompt_if_unset ANTHROPIC_API_KEY "Anthropic API key (sk-ant-...)" hidden
prompt_if_unset SMTP_PASS        "Gmail app password (Enter to skip email channel)" hidden
prompt_if_unset B2_KEY_ID        "Backblaze B2 Key ID"
prompt_if_unset B2_APP_KEY       "Backblaze B2 App Key" hidden
prompt_if_unset ADMIN_EMAIL      "Admin email (for first login)"
prompt_if_unset ADMIN_PASSWORD   "Admin password (will be hashed)" hidden

# ---------- generate / load secrets ----------
say "Generating secrets (preserving any existing values)"
mkdir -p infra/secrets

# Postgres password — file-based secret (mounted into postgres container)
if [[ ! -s infra/secrets/postgres_password ]]; then
  openssl rand -base64 24 | tr -d '\n' > infra/secrets/postgres_password
  ok "generated infra/secrets/postgres_password"
else
  ok "infra/secrets/postgres_password already exists — keeping"
fi
chmod 600 infra/secrets/postgres_password
PG_PASS="$(cat infra/secrets/postgres_password)"

# .env-level secrets — only generate if .env doesn't already have a real value
existing_env_val() {
  # Read VAR=value from .env, return value (or empty if missing or placeholder).
  # Must always return 0 — `set -e` aborts on a failing command substitution
  # in an assignment, so a non-zero return here would silently kill the script
  # on first run (when .env doesn't exist yet).
  if [[ ! -f .env ]]; then
    echo ""
    return 0
  fi
  local v
  v="$(grep -E "^$1=" .env | head -1 | cut -d= -f2- || true)"
  case "$v" in
    ""|GENERATE_ME_ON_SERVER|REPLACE_*|YOUR_*) echo "" ;;
    *) echo "$v" ;;
  esac
  return 0
}

MASTER_KEY="$(existing_env_val MASTER_KEY)"
[[ -z "$MASTER_KEY" ]] && MASTER_KEY="$(openssl rand -base64 32)" && ok "generated MASTER_KEY"

AUTH_SECRET="$(existing_env_val AUTH_SECRET)"
[[ -z "$AUTH_SECRET" ]] && AUTH_SECRET="$(openssl rand -base64 32)" && ok "generated AUTH_SECRET"

WORKER_INTERNAL_TOKEN="$(existing_env_val WORKER_INTERNAL_TOKEN)"
[[ -z "$WORKER_INTERNAL_TOKEN" ]] && WORKER_INTERNAL_TOKEN="$(openssl rand -base64 32)" && ok "generated WORKER_INTERNAL_TOKEN"

# ---------- write .env ----------
say "Writing .env"
# Backup any existing .env (one rotation)
[[ -f .env ]] && cp .env .env.bak && ok "backed up existing .env to .env.bak"

# URL-encode PG password for DATABASE_URL (handles +/= chars safely)
PG_PASS_ENC="$(printf '%s' "$PG_PASS" | sed -e 's/+/%2B/g' -e 's|/|%2F|g' -e 's/=/%3D/g')"

cat > .env <<EOF
# Generated by infra/deploy-prod.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
APP_URL=http://${SERVER_IP}
WORKER_INTERNAL_URL=http://worker:8080
DATABASE_URL=postgresql://budget:${PG_PASS_ENC}@postgres:5432/budget
DATABASE_URL_DIRECT=postgresql://budget:${PG_PASS_ENC}@postgres:5432/budget
MASTER_KEY=${MASTER_KEY}
AUTH_SECRET=${AUTH_SECRET}
AUTH_URL=http://${SERVER_IP}
AUTH_TRUST_HOST=true
WORKER_INTERNAL_TOKEN=${WORKER_INTERNAL_TOKEN}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ANTHROPIC_MODEL_CATEGORIZER=claude-haiku-4-5-20251001
ANTHROPIC_MODEL_CHATBOT=claude-sonnet-4-6
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yanivkr@gmail.com
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=Family Budget App <yanivkr@gmail.com>
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
B2_ENDPOINT=s3.eu-central-003.backblazeb2.com
B2_BUCKET=family-budget-backups
B2_KEY_ID=${B2_KEY_ID}
B2_APP_KEY=${B2_APP_KEY}
BACKUP_CRON=0 3 * * *
BACKUP_RETENTION_DAYS=30
TZ=Asia/Jerusalem
DEFAULT_CUTOFF_DAY=10
SCRAPE_CRON=0 6 * * *
REMINDER_CRON=*/5 * * * *
LOG_LEVEL=info
NODE_ENV=production
EOF
chmod 600 .env
ok ".env written ($(wc -l < .env) lines, mode 600)"

# ---------- build images ----------
say "Building Docker images (5-10 min on first run)"
docker compose -f infra/docker-compose.yml build
ok "images built"

# ---------- start stack ----------
say "Starting stack"
docker compose -f infra/docker-compose.yml up -d
ok "stack started"

# ---------- wait for postgres ----------
say "Waiting for Postgres to accept connections (up to 60s)"
for i in $(seq 1 30); do
  if docker compose -f infra/docker-compose.yml exec -T postgres \
       pg_isready -U budget -d budget >/dev/null 2>&1; then
    ok "postgres is accepting connections"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    docker compose -f infra/docker-compose.yml logs postgres | tail -30
    die "postgres did not become ready in 60s — see logs above"
  fi
done

# ---------- run migrations ----------
# Worker image doesn't ship pnpm-workspace.yaml in the runtime stage, so we
# invoke tsx via its package-local path rather than `pnpm --filter`.
TSX=/app/packages/db/node_modules/.bin/tsx
DB_DIR=/app/packages/db

say "Running database migrations"
docker compose -f infra/docker-compose.yml exec -T worker \
  "$TSX" "$DB_DIR/src/migrate.ts"
ok "migrations applied"

# ---------- seed household + categories ----------
# create-admin requires a household to already exist; seed creates one + the
# default Hebrew categories. Idempotent — safe to re-run.
say "Seeding household + default categories"
docker compose -f infra/docker-compose.yml exec -T worker \
  "$TSX" "$DB_DIR/src/seed.ts"
ok "seed complete"

# ---------- bootstrap admin user ----------
say "Bootstrapping admin user: $ADMIN_EMAIL"
if docker compose -f infra/docker-compose.yml exec -T worker \
     "$TSX" "$DB_DIR/src/create-admin.ts" --email="$ADMIN_EMAIL" --password="$ADMIN_PASSWORD" 2>&1 | tee /tmp/admin-bootstrap.log; then
  ok "admin user ready"
else
  if grep -qi "already exists\|duplicate" /tmp/admin-bootstrap.log; then
    warn "admin user already exists — skipping (use reset-password if you forgot the password)"
  else
    die "create-admin failed — see output above"
  fi
fi

# ---------- final summary ----------
say "Deploy complete"
docker compose -f infra/docker-compose.yml ps

cat <<EOF

============================================================================
  SAVE THESE TO YOUR PASSWORD MANAGER NOW (they won't be shown again):
============================================================================
  Server URL:     http://${SERVER_IP}/
  Admin email:    ${ADMIN_EMAIL}
  Admin password: (the one you just entered)

  MASTER_KEY:            ${MASTER_KEY}
  AUTH_SECRET:           ${AUTH_SECRET}
  WORKER_INTERNAL_TOKEN: ${WORKER_INTERNAL_TOKEN}
  Postgres password:     ${PG_PASS}

  All of the above also live in /opt/family-budget/.env (mode 600, root only).
  Losing this VPS = losing these. Back them up off-server.
============================================================================

Next:
  1. Open http://${SERVER_IP}/ in a browser, sign in.
  2. Visit /admin/backups → click "גבה עכשיו" to test the backup pipeline end-to-end.
  3. Save the credentials above to a password manager.

EOF
