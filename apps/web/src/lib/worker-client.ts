// Server-side helper for the web app to talk to the worker over the internal docker network.

const WORKER_URL = process.env.WORKER_INTERNAL_URL ?? 'http://worker:8080';
const WORKER_TOKEN = process.env.WORKER_INTERNAL_TOKEN ?? '';

if (!WORKER_TOKEN) {
  // We don't crash on import; instead we throw at first use so build-time prerendering doesn't fail.
}

export function workerHeaders(extra?: HeadersInit): HeadersInit {
  if (!WORKER_TOKEN) throw new Error('WORKER_INTERNAL_TOKEN is not set');
  return {
    Authorization: `Bearer ${WORKER_TOKEN}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function workerUrl(path: string): string {
  return `${WORKER_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
