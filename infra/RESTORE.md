# Backup restore drill

The backup pipeline writes a nightly encrypted dump (`budget-YYYYMMDD-HHMMSS.sql.gz.gpg`) to Backblaze B2 and keeps the last 7 days locally on the VPS at `/state/`.

Run this drill **at least quarterly** to confirm the chain works end-to-end. A backup you've never restored is wishful thinking, not a backup.

## What you need

- The GPG **private** key whose fingerprint matches `$GPG_RECIPIENT`. (Do NOT keep this on the VPS — store it on a hardware key or an offline machine.)
- B2 access keys (`B2_ACCOUNT_ID`, `B2_APPLICATION_KEY`).
- A scratch Postgres instance (any laptop with `postgres:16` in Docker is fine).

## Procedure

```bash
# 1. Pick a backup file
ls /state/ | grep budget-                    # on the VPS
# or pull from B2:
rclone copy b2:family-budget-backups/budget-20260501-030000.sql.gz.gpg ./

# 2. Decrypt (off the VPS, on your trusted machine)
gpg --decrypt budget-20260501-030000.sql.gz.gpg > budget.sql.gz
gunzip budget.sql.gz

# 3. Spin up a scratch Postgres
docker run --rm -d --name pg-restore \
    -e POSTGRES_PASSWORD=test \
    -e POSTGRES_USER=budget \
    -e POSTGRES_DB=budget \
    -p 55432:5432 \
    postgres:16-alpine

# 4. Restore
PGPASSWORD=test psql -h localhost -p 55432 -U budget -d budget < budget.sql

# 5. Verify
PGPASSWORD=test psql -h localhost -p 55432 -U budget -d budget -c "
    SELECT
        (SELECT count(*) FROM transaction WHERE deleted_at IS NULL) AS txns,
        (SELECT count(*) FROM category) AS cats,
        (SELECT count(*) FROM account) AS accts;
"
# Compare counts against the production /admin page.

# 6. Clean up
docker stop pg-restore
rm budget.sql
```

## What "verified" means

After restore, confirm:

1. `count(*) FROM transaction WHERE deleted_at IS NULL` matches production.
2. The most recent month's `total_spent` (sum of negative amounts) matches the dashboard.
3. `count(*) FROM chat_message` matches — this catches encryption-key drift since chat content is column-encrypted.
4. Pick one bank credential (`encrypted_credentials` from `account`) and confirm decrypting it with `MASTER_KEY` returns the expected JSON.

If step 4 fails, your master key is not synchronized with what was used at write time — you cannot scrape until you fix this.
