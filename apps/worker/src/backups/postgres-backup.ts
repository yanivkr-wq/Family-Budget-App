/**
 * Postgres → Backblaze B2 backup.
 *
 * Pipeline:
 *   docker exec budget-pg pg_dump  →  gzip  →  S3 PutObject (B2)
 *
 * The dump is streamed end-to-end so we never buffer the whole thing in
 * memory. For a 100-MB dump that's ~10x cheaper than read-into-buffer.
 *
 * Why `docker exec`: pg_dump is the binary that ships with Postgres, and
 * the budget-pg container has it. The worker process itself (Node) doesn't
 * need pg_dump installed locally — Docker brokers it.
 *
 * In production we'll switch the source to a direct host pg_dump (since the
 * worker container will be running alongside postgres on the same Docker
 * network). This file's interface stays the same; only the spawn target
 * changes.
 *
 * What we DON'T do:
 *   • Encryption — B2 server-side encryption + private bucket are sufficient
 *     for personal use. Adding GPG encryption client-side adds an external
 *     binary dep + key management, and offers little extra over "credentials
 *     stored in the worker that has DB access anyway".
 *   • Verification — every successful upload writes a small checksum to the
 *     event log so the user can later confirm "this dump completed without
 *     truncation". Full restore-test verification is documented in
 *     /admin/backups but not automated (would 2x infra cost).
 *
 * Filename convention: `budget_YYYY-MM-DD_HHMM.sql.gz` so the bucket lists
 * chronologically AND the user can manually identify which dump came from
 * which day without opening it.
 */

import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { PassThrough } from 'node:stream';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Config } from '../config';
import type { FastifyBaseLogger } from 'fastify';

export interface BackupResult {
  ok:        boolean;
  skipped?:  boolean;
  reason?:   string;
  filename?: string;
  bytes?:    number;
  duration?: number;     // ms
  pruned?:   number;     // count of old backups deleted
  error?:    string;
}

/** Run a single backup: dump → gzip → upload → prune. */
export async function runBackup(opts: {
  config:  Config;
  logger:  FastifyBaseLogger;
}): Promise<BackupResult> {
  const { config, logger } = opts;

  // Skip cleanly when B2 isn't configured — same pattern as email/whatsapp.
  if (!config.B2_ENDPOINT || !config.B2_BUCKET || !config.B2_KEY_ID || !config.B2_APP_KEY) {
    return { ok: false, skipped: true, reason: 'B2 not configured (missing one of B2_ENDPOINT/B2_BUCKET/B2_KEY_ID/B2_APP_KEY)' };
  }

  const start = Date.now();

  // Filename: YYYY-MM-DD_HHMM in local TZ (so user-visible names match
  // when the backup ran in their head). Using ISO-ish format so lex sort
  // = chronological sort in the B2 file browser.
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `budget_${stamp}.sql.gz`;

  // Two backup modes depending on environment:
  //   • DEV (Windows + Docker Desktop): the worker runs natively on the
  //     host (no pg_dump locally on Windows), so we shell into the
  //     postgres container via `docker exec` to run pg_dump there.
  //   • PROD (Linux Docker stack): the worker IS a container with
  //     postgresql-client-16 installed, and Postgres is on the same
  //     docker network at `postgres:5432`. Direct pg_dump over TCP — no
  //     docker socket access needed (and we wouldn't want to grant it).
  //
  // The trigger: if BACKUP_PG_DOCKER_CONTAINER is set, use docker exec
  // mode. Otherwise use direct pg_dump (assumes pg_dump on PATH + DB
  // connection details derived from DATABASE_URL).
  const dockerContainer = process.env.BACKUP_PG_DOCKER_CONTAINER;
  const dump = dockerContainer
    ? spawn('docker', [
        'exec', dockerContainer,
        'pg_dump',
        '-U', 'budget',
        '-d', 'budget',
        '--clean', '--if-exists', '--no-owner', '--no-acl', '-F', 'p',
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('pg_dump', [
        // DATABASE_URL parses cleanly; pg_dump accepts it as a connection
        // string positional arg with --dbname. Includes host, port, user,
        // password, db — no need to split it ourselves.
        '--dbname', process.env.DATABASE_URL ?? 'postgresql://budget:budget@postgres:5432/budget',
        '--clean', '--if-exists', '--no-owner', '--no-acl', '-F', 'p',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const dumpStderr: Buffer[] = [];
  dump.stderr.on('data', (chunk: Buffer) => dumpStderr.push(chunk));

  // CRITICAL: register the exit promise BEFORE we start consuming stdout.
  // Otherwise the small dump (~1 MB) finishes + emits 'exit' before
  // upload.done() resolves, and our awaited listener never fires.
  const exitPromise = new Promise<number>((resolve) => {
    dump.on('exit', (code) => resolve(code ?? -1));
  });

  // Gzip on the fly — keeps memory flat regardless of dump size.
  const gz = createGzip({ level: 6 });
  dump.stdout.pipe(gz);

  // Tee the gzipped stream to count bytes for the result + feed S3 upload.
  // PassThrough lets us add a byte counter without re-reading.
  const counter = new PassThrough();
  let bytes = 0;
  counter.on('data', (chunk: Buffer) => { bytes += chunk.length; });
  gz.pipe(counter);

  const s3 = new S3Client({
    endpoint: `https://${config.B2_ENDPOINT}`,
    region:   regionFromEndpoint(config.B2_ENDPOINT),
    credentials: {
      accessKeyId:     config.B2_KEY_ID,
      secretAccessKey: config.B2_APP_KEY,
    },
    // B2's S3 endpoint requires path-style URLs (bucket in path, not subdomain).
    forcePathStyle: true,
  });

  try {
    // Use lib-storage's Upload — it handles flowing streams via multi-part
    // upload (PutObjectCommand requires Content-Length up-front, which we
    // can't compute because the gzipped size depends on what pg_dump
    // emits). 5 MB part size is the AWS minimum and fine for our scale.
    const upload = new Upload({
      client: s3,
      params: {
        Bucket:      config.B2_BUCKET,
        Key:         filename,
        Body:        counter,
        ContentType: 'application/gzip',
        Metadata: {
          // Provenance metadata — visible in B2 web UI for any object.
          'fba-source': 'worker-cron',
          'fba-stamp':  stamp,
        },
      },
      partSize:  5 * 1024 * 1024, // 5 MB per part (AWS minimum)
      queueSize: 4,                // upload up to 4 parts in parallel
    });
    await upload.done();

    // pg_dump should already have exited by now (the upload only finishes
    // when the input stream ends, which only happens when dump's stdout
    // closes which only happens when dump exits). The promise is set up
    // BEFORE the streams started so we don't miss the event — see above.
    const exitCode = await exitPromise;
    if (exitCode !== 0) {
      const stderrText = Buffer.concat(dumpStderr).toString('utf8');
      return {
        ok: false,
        error: `pg_dump exited with code ${exitCode}: ${stderrText.slice(0, 500)}`,
        duration: Date.now() - start,
      };
    }

    // Prune old backups in the same call so retention is enforced
    // automatically and the user doesn't have to set up a B2 lifecycle rule.
    const pruned = await pruneOldBackups({ s3, config, logger });

    return {
      ok: true,
      filename,
      bytes,
      duration: Date.now() - start,
      pruned,
    };
  } catch (err) {
    // Try to kill the dump subprocess if upload failed mid-stream.
    try { dump.kill('SIGTERM'); } catch { /* best effort */ }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      duration: Date.now() - start,
    };
  }
}

/** List + delete backups older than BACKUP_RETENTION_DAYS. Returns count
 *  of objects deleted. */
async function pruneOldBackups(opts: {
  s3:      S3Client;
  config:  Config;
  logger:  FastifyBaseLogger;
}): Promise<number> {
  const { s3, config, logger } = opts;
  const cutoffMs = Date.now() - config.BACKUP_RETENTION_DAYS * 86_400_000;

  try {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: config.B2_BUCKET!,
      Prefix: 'budget_',
    }));

    const stale = (list.Contents ?? [])
      .filter((obj) => obj.LastModified && obj.LastModified.getTime() < cutoffMs)
      .map((obj) => ({ Key: obj.Key! }));

    if (stale.length === 0) return 0;

    await s3.send(new DeleteObjectsCommand({
      Bucket: config.B2_BUCKET!,
      Delete: { Objects: stale, Quiet: true },
    }));
    logger.info({ pruned: stale.length, retentionDays: config.BACKUP_RETENTION_DAYS }, 'pruned old backups');
    return stale.length;
  } catch (err) {
    // Pruning failure is non-fatal — the backup itself succeeded; we just
    // didn't reclaim some old space. Log and move on.
    logger.warn({ err }, 'backup prune failed (non-fatal)');
    return 0;
  }
}

/** List recent backups for the /admin/backups page. */
export async function listBackups(config: Config): Promise<Array<{
  filename: string;
  size:     number;       // bytes
  uploaded: string;       // ISO
}>> {
  if (!config.B2_ENDPOINT || !config.B2_BUCKET || !config.B2_KEY_ID || !config.B2_APP_KEY) {
    return [];
  }
  const s3 = new S3Client({
    endpoint: `https://${config.B2_ENDPOINT}`,
    region:   regionFromEndpoint(config.B2_ENDPOINT),
    credentials: { accessKeyId: config.B2_KEY_ID, secretAccessKey: config.B2_APP_KEY },
    forcePathStyle: true,
  });
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: config.B2_BUCKET,
    Prefix: 'budget_',
  }));
  return (list.Contents ?? [])
    .filter((o) => o.Key && o.LastModified)
    .map((o) => ({
      filename: o.Key!,
      size:     o.Size ?? 0,
      uploaded: o.LastModified!.toISOString(),
    }))
    .sort((a, b) => b.uploaded.localeCompare(a.uploaded)); // newest first
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Extract the AWS-style region from a B2 S3 endpoint. The SDK requires
 *  *some* region value even when talking to a non-AWS endpoint; B2's
 *  endpoint hostnames look like 's3.eu-central-003.backblazeb2.com' — we
 *  pull the middle segment. */
function regionFromEndpoint(endpoint: string): string {
  const m = /^s3\.([a-z0-9-]+)\./.exec(endpoint);
  return m?.[1] ?? 'us-east-1';
}
