#!/usr/bin/env bash
# ============================================================================
# Family Budget App — routine update script
# ============================================================================
# Run on the server when you've pushed code changes from your laptop and want
# to deploy them to prod. Handles:
#   - Discarding the chmod local change so `git pull` never conflicts
#   - Pulling latest from GitHub
#   - Detecting if there are new database migrations and applying them
#   - Rebuilding web + worker images (cached layers reused — fast)
#   - Recreating those containers (downtime: ~10 seconds)
#   - Showing post-deploy status
#
# Usage:
#   cd /opt/family-budget
#   ./infra/update-prod.sh
#
# This script does NOT touch:
#   - Your .env file (no risk of regenerating secrets)
#   - The postgres container (no DB downtime)
#   - The caddy container (TLS state preserved)
#   - The postgres volume (your data stays put)
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f infra/docker-compose.yml"

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (or with sudo)"
[[ -f infra/docker-compose.yml ]] || die "infra/docker-compose.yml missing — wrong directory?"
[[ -f .env ]] || die ".env missing — run ./infra/deploy-prod.sh first (this is for routine updates)"

# ---------- pull latest code ----------
say "Pulling latest from GitHub"
# These files commonly get local mode/whitespace changes on the server that
# block a fast-forward pull. Discard before pulling.
git checkout -- infra/deploy-prod.sh infra/update-prod.sh 2>/dev/null || true

# Capture the list of migration files BEFORE pull, so we can diff after.
mig_before="$(ls packages/db/drizzle/*.sql 2>/dev/null | sort)"
old_head="$(git rev-parse HEAD)"

git pull
chmod +x infra/deploy-prod.sh infra/update-prod.sh 2>/dev/null || true

new_head="$(git rev-parse HEAD)"
if [[ "$old_head" == "$new_head" ]]; then
  ok "already up to date — nothing to deploy"
  exit 0
fi
ok "pulled $(git rev-list --count "$old_head..$new_head") commit(s)"

# ---------- detect new migrations ----------
mig_after="$(ls packages/db/drizzle/*.sql 2>/dev/null | sort)"
new_migrations="$(comm -13 <(echo "$mig_before") <(echo "$mig_after"))"

# ---------- rebuild + restart web + worker ----------
say "Rebuilding web + worker images (cached layers reused)"
$COMPOSE build web worker
ok "build complete"

say "Recreating web + worker containers (~10 sec downtime)"
$COMPOSE up -d web worker
ok "containers recreated"

# ---------- apply new migrations, if any ----------
if [[ -n "$new_migrations" ]]; then
  say "Applying $(echo "$new_migrations" | wc -l) new migration(s) via psql"
  while IFS= read -r f; do
    fname="$(basename "$f")"
    printf '    applying %s ... ' "$fname"
    if $COMPOSE exec -T postgres \
         psql -U budget -d budget -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>&1; then
      printf '✓\n'
    else
      printf '✗\n'
      $COMPOSE exec -T postgres \
        psql -U budget -d budget -v ON_ERROR_STOP=1 < "$f" 2>&1 | tail -10
      die "migration $fname failed — see error above"
    fi
  done <<< "$new_migrations"
  ok "migrations applied"
else
  ok "no new migrations to apply"
fi

# ---------- show status ----------
say "Post-deploy status"
$COMPOSE ps
echo
ok "update complete — visit http://$(grep '^APP_URL=' .env | cut -d/ -f3)/ to verify"
