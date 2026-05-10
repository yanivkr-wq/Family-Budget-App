'use server';

/**
 * Server actions for /admin/backups. Both proxy to the worker over the
 * shared internal token — backups themselves run inside the worker process
 * (it's the one with pg_dump access via Docker).
 */

import { auth } from '@/lib/auth';

interface BackupItem {
  filename: string;
  size:     number;
  uploaded: string;
}

interface BackupResult {
  ok:        boolean;
  skipped?:  boolean;
  reason?:   string;
  filename?: string;
  bytes?:    number;
  duration?: number;
  pruned?:   number;
  error?:    string;
}

async function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  const url   = process.env.WORKER_INTERNAL_URL ?? 'http://localhost:8080';
  const token = process.env.WORKER_INTERNAL_TOKEN;
  if (!token) throw new Error('WORKER_INTERNAL_TOKEN not set');
  // Don't send Content-Type when there's no body — Fastify rejects empty
  // application/json POSTs with HTTP 400 ("Bad Request"). Headers are
  // built minimally and the caller's init can add more if needed.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (init?.body) headers['Content-Type'] = 'application/json';
  return fetch(`${url}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
    cache: 'no-store',
  });
}

/** Manual "run backup now" — UI calls this from the button. Returns the
 *  worker's full result so the UI can display sent/skipped/failed details. */
export async function runBackupNow(): Promise<BackupResult> {
  try {
    const res = await workerFetch('/backups/run-now', { method: 'POST' });
    return await res.json() as BackupResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

/** Server-side helper for the page — fetches the recent backup list. */
export async function getRecentBackups(): Promise<BackupItem[]> {
  try {
    const res = await workerFetch('/backups/list', { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json() as { items?: BackupItem[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}
