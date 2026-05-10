/**
 * Server wrapper around <NotificationsBell>. Fetches the initial event list
 * server-side so the unread badge is correct on the very first paint, then
 * passes a server-action fetcher down to the client island for polling.
 */

import { getRecentInAppEvents } from '@/app/(app)/notifications/actions';
import { NotificationsBell, type BellEvent } from './notifications-bell';

export async function NotificationsBellServer() {
  const initial = await fetchEvents();

  // Server-action fetcher passed to the client. Marked 'use server' so it can
  // be invoked from the client island without exposing a REST route.
  async function poll(): Promise<BellEvent[]> {
    'use server';
    return fetchEvents();
  }

  return <NotificationsBell initial={initial} fetcher={poll} />;
}

async function fetchEvents(): Promise<BellEvent[]> {
  const rows = await getRecentInAppEvents(30);
  return rows.map((r) => ({
    id:     r.id,
    taskId: r.taskId,
    title:  r.title,
    body:   r.body,
    fireAt: r.fireAt instanceof Date ? r.fireAt.toISOString() : String(r.fireAt),
    state:  r.state as BellEvent['state'],
  }));
}
