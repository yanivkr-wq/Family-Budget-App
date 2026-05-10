/**
 * /admin/notifications — diagnostic log of recent notification events.
 *
 * Lists the last 200 events with channel, recipient, state, error, fire/sent
 * times, and the originating task title. Filters by state and channel via
 * URL params so deep-links from "show me failures only" buttons work.
 *
 * Why this page exists: previously the only way to see what fired (or
 * failed) was to tail the worker terminal log. That's painful when
 * debugging a "my wife says she didn't get the WhatsApp" situation. Now
 * you can answer those questions from the UI.
 *
 * Read-only (no actions) for v1 — adding a "retry failed" button is the
 * obvious next step but isn't required to ship this.
 */

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { and, eq, desc, sql } from 'drizzle-orm';
import { Activity, Mail, MessageCircle, Smartphone, Filter, X } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    state?:   string;
    channel?: string;
  }>;
}

const STATE_LABEL: Record<string, string> = {
  pending: 'בהמתנה',
  sent:    'נשלח',
  failed:  'נכשל',
  skipped: 'דולג',
  read:    'נקרא',
};

const STATE_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  sent:    'bg-success/10 text-success',
  failed:  'bg-destructive/10 text-destructive',
  skipped: 'bg-warning/10 text-warning',
  read:    'bg-accent/10 text-accent',
};

const CHANNEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  in_app:   Smartphone,
  email:    Mail,
  whatsapp: MessageCircle,
};

const CHANNEL_LABEL: Record<string, string> = {
  in_app:   'פעמון',
  email:    'דוא"ל',
  whatsapp: 'WhatsApp',
};

export default async function AdminNotificationsPage(props: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { householdId } = session.user;
  const db = getDb();

  const sp = await props.searchParams;
  const filterState   = sp.state   && STATE_LABEL[sp.state]   ? sp.state   : null;
  const filterChannel = sp.channel && CHANNEL_LABEL[sp.channel] ? sp.channel : null;

  // Build WHERE — household always; state and channel optional.
  const whereParts = [eq(schema.notificationEvents.householdId, householdId)];
  if (filterState)   whereParts.push(eq(schema.notificationEvents.state,   filterState as 'pending'|'sent'|'failed'|'skipped'|'read'));
  if (filterChannel) whereParts.push(eq(schema.notificationEvents.channel, filterChannel as 'in_app'|'email'|'whatsapp'));

  // Pull events + join task title + contact label in one round trip.
  const eventsRaw = await db.execute<{
    id:             string;
    channel:        string;
    state:          string;
    fire_at:        Date | string;
    sent_at:        Date | string | null;
    error_msg:      string | null;
    title_snapshot: string;
    body_snapshot:  string | null;
    task_id:        string;
    contact_label:  string | null;
    contact_phone:  string | null;
    contact_email:  string | null;
  }>(sql`
    SELECT
      e.id, e.channel, e.state, e.fire_at, e.sent_at, e.error_msg,
      e.title_snapshot, e.body_snapshot, e.task_id,
      c.label    AS contact_label,
      c.phone_e164 AS contact_phone,
      c.email    AS contact_email
    FROM notification_event e
    LEFT JOIN notification_contact c ON c.id = e.contact_id
    WHERE e.household_id = ${householdId}
      ${filterState   ? sql`AND e.state = ${filterState}`     : sql``}
      ${filterChannel ? sql`AND e.channel = ${filterChannel}` : sql``}
    ORDER BY e.fire_at DESC
    LIMIT 200
  `);

  // Stats per state for the filter chips count badges.
  const statsRaw = await db.execute<{ state: string; n: number }>(sql`
    SELECT state, count(*)::int AS n
    FROM notification_event
    WHERE household_id = ${householdId}
      AND fire_at > now() - interval '30 days'
    GROUP BY state
  `);
  const stateCounts: Record<string, number> = {};
  for (const r of statsRaw) stateCounts[r.state] = r.n;

  return (
    <div className="space-y-5" dir="rtl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="size-5 text-accent" aria-hidden />
          יומן התראות
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          רשימת אירועי התראה אחרונים — שולחו, נכשלו, או דולגו. שימושי לאיתור
          בעיות שילוח (לדוגמה Twilio שדוחה את המספר, או SMTP שלא מחובר).
        </p>
      </header>

      {/* State filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-2xs text-muted-foreground">סטטוס:</span>
        <FilterChip
          href="/admin/notifications"
          active={!filterState}
          channelFilter={filterChannel}
          label={`הכל (${Object.values(stateCounts).reduce((s, n) => s + n, 0)})`}
        />
        {(['sent','failed','skipped','read','pending'] as const).map((s) => (
          <FilterChip
            key={s}
            href={`/admin/notifications?state=${s}`}
            channelFilter={filterChannel}
            active={filterState === s}
            label={`${STATE_LABEL[s]} (${stateCounts[s] ?? 0})`}
            tone={STATE_TONE[s]}
          />
        ))}
      </div>

      {/* Channel filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs text-muted-foreground">ערוץ:</span>
        <FilterChip
          href={filterState ? `/admin/notifications?state=${filterState}` : '/admin/notifications'}
          active={!filterChannel}
          label="הכל"
        />
        {(['in_app','email','whatsapp'] as const).map((c) => {
          const params = new URLSearchParams();
          if (filterState) params.set('state', filterState);
          params.set('channel', c);
          return (
            <FilterChip
              key={c}
              href={`/admin/notifications?${params.toString()}`}
              active={filterChannel === c}
              label={CHANNEL_LABEL[c]!}
            />
          );
        })}
      </div>

      {/* Events table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="min-w-full text-sm" dir="rtl">
          <thead className="bg-muted/40 text-right">
            <tr>
              <th className="border-b px-3 py-2 font-medium">זמן</th>
              <th className="border-b px-3 py-2 font-medium">משימה</th>
              <th className="border-b px-3 py-2 font-medium">ערוץ</th>
              <th className="border-b px-3 py-2 font-medium">נמען</th>
              <th className="border-b px-3 py-2 font-medium">סטטוס</th>
              <th className="border-b px-3 py-2 font-medium">פרטים</th>
            </tr>
          </thead>
          <tbody>
            {eventsRaw.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  אין אירועים שתואמים לפילטרים
                </td>
              </tr>
            ) : (
              eventsRaw.map((e) => {
                const ChannelIcon = CHANNEL_ICON[e.channel] ?? Activity;
                const fireAtStr = formatDt(e.fire_at);
                const sentAtStr = e.sent_at ? formatDt(e.sent_at) : null;
                const recipient = e.contact_label
                  ? e.contact_label
                  : (e.contact_email ?? e.contact_phone ?? '—');
                return (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 text-2xs tabular-nums text-muted-foreground" dir="ltr">
                      {fireAtStr}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/notifications`}
                        className="text-xs font-medium hover:text-accent transition-colors line-clamp-1"
                        title={e.title_snapshot}
                      >
                        {e.title_snapshot}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                        <ChannelIcon className="size-3" />
                        {CHANNEL_LABEL[e.channel] ?? e.channel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-2xs">{recipient}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${STATE_TONE[e.state] ?? ''}`}>
                        {STATE_LABEL[e.state] ?? e.state}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-2xs text-muted-foreground">
                      {e.error_msg ? (
                        <span className="text-destructive line-clamp-2" title={e.error_msg}>
                          {e.error_msg}
                        </span>
                      ) : sentAtStr ? (
                        <span className="text-muted-foreground/80" dir="ltr">נשלח: {sentAtStr}</span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-2xs text-muted-foreground text-center">
        מציג עד 200 אירועים אחרונים. ספירות לפי 30 הימים האחרונים.
      </p>
    </div>
  );
}

function FilterChip({ href, active, label, tone, channelFilter }: {
  href: string;
  active: boolean;
  label: string;
  tone?: string;
  channelFilter?: string | null;
}) {
  // Combine state + existing channel filter so chips don't lose context.
  const finalHref = channelFilter && href.includes('state=')
    ? `${href}&channel=${channelFilter}`
    : href;
  return (
    <Link
      href={finalHref}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors ${
        active
          ? (tone ?? 'border-accent bg-accent/15 text-accent')
          : 'border-muted-foreground/20 bg-card text-muted-foreground hover:bg-muted/40'
      }`}
    >
      {label}
      {active && <X className="size-2.5 opacity-50" />}
    </Link>
  );
}

function formatDt(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleString('he-IL', {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
