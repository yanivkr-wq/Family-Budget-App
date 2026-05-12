#!/usr/bin/env bash
# ============================================================================
# Family Budget App — auto-deploy poller (smoke-tested 2026-05-12)
# ============================================================================
# Runs from cron every couple of minutes. Checks if origin/main has new
# commits beyond what HEAD points at; if so, runs update-prod.sh to deploy.
# Otherwise exits silently — keeps the cron log clean.
#
# Concurrency: a flock guard prevents two deploys from running at once
# (e.g., back-to-back commits within the cron window).
#
# Logging: this script writes ONLY when something happened (deploy started
# or failed). The cron line redirects all output to /var/log/auto-deploy.log
# with timestamps prefixed by `ts` (or by `date` if `ts` isn't installed).
#
# Exit codes:
#   0 — nothing to deploy (silent), or deploy succeeded
#   1 — fatal error (logged)
# ============================================================================

set -euo pipefail

REPO="/opt/family-budget"
LOCK="/var/lock/family-budget-auto-deploy.lock"

# flock guard: if another instance is mid-deploy, exit immediately.
# -n = non-blocking; 200 = file descriptor for the lock file.
exec 200>"$LOCK"
flock -n 200 || exit 0

cd "$REPO"

# Discard any local mode/whitespace edits to the deploy scripts so `git pull`
# never fails on its own. update-prod.sh does the same; doing it here makes
# the local-vs-remote diff check below accurate.
git checkout -- infra/deploy-prod.sh infra/update-prod.sh infra/auto-deploy.sh 2>/dev/null || true

# Quiet fetch — pulls refs from origin without writing to working tree.
git fetch origin main --quiet 2>&1 || {
  echo "[$(date -Iseconds)] auto-deploy: git fetch failed" >&2
  exit 1
}

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  # Up to date — silent exit. Cron log stays clean.
  exit 0
fi

# We have new commits. Trigger the regular deploy path.
echo "[$(date -Iseconds)] auto-deploy: new commit detected ($LOCAL → $REMOTE), running update-prod.sh"
chmod +x infra/update-prod.sh 2>/dev/null || true
if ./infra/update-prod.sh; then
  echo "[$(date -Iseconds)] auto-deploy: update-prod.sh succeeded"
else
  echo "[$(date -Iseconds)] auto-deploy: update-prod.sh FAILED with exit $?" >&2
  exit 1
fi
