#!/usr/bin/env bash
# Nightly encrypted backup of Postgres → Backblaze B2.
# Runs inside the `backup` container.
#
# Required env (from ../.env):
#   B2_ACCOUNT_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_ENDPOINT
#   GPG_RECIPIENT
#
# Required secrets (mounted via docker-compose):
#   /run/secrets/postgres_password
#   /run/secrets/gpg_pubkey   (already imported by entrypoint)

set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="/state/budget-${TS}.sql.gz.gpg"
LOG=/state/backup.log

echo "[$(date -Iseconds)] backup starting" >> "$LOG"

PGPASSWORD="$(cat /run/secrets/postgres_password)" \
pg_dump \
    --host=postgres \
    --username=budget \
    --dbname=budget \
    --format=plain \
    --no-owner \
    --no-privileges \
| gzip -9 \
| gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_RECIPIENT" \
    --output "$BACKUP_FILE"

echo "[$(date -Iseconds)] dump+encrypt complete: $(du -h "$BACKUP_FILE" | cut -f1)" >> "$LOG"

# Upload via S3-compatible API (B2 supports S3 protocol).
# Using curl to avoid pulling in the full aws CLI.
BUCKET_URL="${B2_ENDPOINT}/${B2_BUCKET}/budget-${TS}.sql.gz.gpg"
DATE_RFC="$(date -u +%a,\ %d\ %b\ %Y\ %T\ GMT)"

# B2 native auth is simpler than computing S3 sig — use rclone or b2 CLI in a real deploy.
# For this skeleton we shell out to a placeholder; replace with rclone in production.
echo "[$(date -Iseconds)] upload step (placeholder — wire rclone or b2 CLI)" >> "$LOG"

# Local rolling retention: keep last 7 days on the VPS too
find /state -name 'budget-*.sql.gz.gpg' -mtime +7 -delete

echo "[$(date -Iseconds)] backup done" >> "$LOG"
