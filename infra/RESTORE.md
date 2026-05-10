# Backup restore drill

The worker writes a nightly Postgres dump (`budget_YYYY-MM-DD_HHMM.sql.gz`)
to Backblaze B2 at 03:00 Asia/Jerusalem. Manual triggers + history at
`/admin/backups` in the web app.

**Run this drill at least quarterly** to confirm the backup → restore chain
works end-to-end. A backup you've never restored is wishful thinking.

## What you need

- B2 credentials (`B2_KEY_ID`, `B2_APP_KEY`) — the same values in the
  worker's `.env`. Store a copy in a password manager so you can restore
  even if the server is gone.
- A scratch Postgres instance (any laptop with Docker is fine).
- ~10 min of focus.

## Procedure

### 1. Pick a backup to restore

Open `https://YOUR_DOMAIN_OR_IP/admin/backups` in the web app. Note the
filename of the backup you want to test (default: latest one).

Or via Backblaze console: `https://secure.backblaze.com/b2_buckets.htm` →
your bucket → list of `budget_*.sql.gz` files.

### 2. Download the backup file

**From the B2 web UI** (easiest):
Click the file → "Download" button. Save locally.

**Or via CLI** (if you have the B2 CLI installed):
```bash
b2 file download \
  b2://family-budget-backups/budget_2026-05-09_2357.sql.gz \
  ./restore-test.sql.gz
```

### 3. Decompress

```bash
gunzip restore-test.sql.gz
# Now have: restore-test.sql (plain text SQL)
```

(On Windows: 7-Zip can extract `.sql.gz` files.)

### 4. Spin up a scratch Postgres

On any machine with Docker:

```bash
docker run -d --name budget-restore-test \
  -e POSTGRES_DB=budget \
  -e POSTGRES_USER=budget \
  -e POSTGRES_PASSWORD=test \
  -p 15432:5432 \
  postgres:16-alpine

# Wait ~5 sec for it to boot
sleep 5
```

### 5. Restore

```bash
docker exec -i budget-restore-test \
  psql -U budget -d budget < restore-test.sql
```

The dump uses `DROP TABLE IF EXISTS` before each `CREATE TABLE` so it's
self-contained — works on a fresh DB OR on top of an existing one.

### 6. Verify

```bash
docker exec budget-restore-test \
  psql -U budget -d budget -c "
    SELECT
      (SELECT count(*) FROM transaction)             AS transactions,
      (SELECT count(*) FROM recurring_pattern)        AS recurring,
      (SELECT count(*) FROM notification_task)        AS notifications,
      (SELECT max(transaction_date) FROM transaction) AS latest_txn;
  "
```

If the counts and latest_txn date match what you'd expect (compare to the
production `/admin/backups` page or just the dashboard), restore worked.

### 7. Tear down

```bash
docker rm -f budget-restore-test
rm restore-test.sql
```

## Production restore (real disaster)

If your prod server is destroyed and you need to bring everything back up
on a fresh VPS:

1. Provision new server (15 min — see infra/README.md "First deploy")
2. Get a `.env` with the same `MASTER_KEY` and `B2_*` credentials as before
   (from your password manager)
3. Bring up the stack with `docker compose up -d`
4. Once Postgres is healthy, restore the latest B2 backup to it:
   ```bash
   # On the new server, after `docker compose up -d`
   docker compose exec -T postgres psql -U budget -d budget \
     < <(gunzip -c <(curl -fsSL "https://b2-download-url-from-console"))
   ```
5. Verify via web app (`/admin/backups`, dashboard data)
6. Re-attach DNS / IP if applicable

Total RTO (Recovery Time Objective): ~30-60 min from "server gone" to
"app live again with yesterday's data".
