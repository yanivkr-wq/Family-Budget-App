'use client';

/**
 * Insight — Expiring subscriptions.
 *
 * Surfaces recurring patterns whose subscription_end_date (or its cancellation
 * deadline = end_date − notice_days) lands within the next ~30 days. Each row
 * has TWO action buttons:
 *
 *   • "חדש" — push end_date forward by one frequency cycle, force auto_renew=true
 *   • "סיים" — set status='ended', auto_renew=false, end_date=today
 *
 * Both call server actions in /recurring/actions.ts; on success the row swaps
 * to a confirmation pill and Next revalidates /insights so the next render
 * drops it from the list.
 *
 * Empty state encourages the user to add end dates to their recurring patterns
 * — without that data this card stays quiet, which is fine.
 */

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { formatIls } from '@fba/shared';
import { CalendarClock, Check, Loader2, RefreshCw, Square, ChevronLeft } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { ExpiringSubscriptionFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';
import { renewRecurringPattern, endRecurringPattern } from '@/app/(app)/recurring/actions';

interface Props {
  windowLabel: string;
  findings: ExpiringSubscriptionFinding[];
}

export function CardExpiringSubscriptions({ windowLabel, findings }: Props) {
  if (findings.length === 0) {
    return (
      <InsightCard
        id="expiring-subscriptions"
        title="מנויים שמסתיימים בקרוב"
        subtitle={windowLabel}
        icon={<CalendarClock className="size-4 shrink-0" aria-hidden />}
        tone="success"
        info={INSIGHT_EXPLANATIONS['expiring-subscriptions']}
      >
        <div className="flex h-full flex-col items-center justify-center gap-1.5 py-6 text-center">
          <span className="pill bg-success-soft text-success">✓ אין החלטות דחופות</span>
          <p className="text-xs text-muted-foreground">
            אין מנויים שמסתיימים ב-30 הימים הקרובים
          </p>
          <p className="text-2xs text-muted-foreground/80 max-w-[260px]">
            הגדירי תאריך סיום להוצאות קבועות ב{' '}
            <Link href="/recurring" className="text-accent hover:underline">
              /recurring
            </Link>{' '}
            כדי לקבל התרעות לפני חיוב חידוש אוטומטי
          </p>
        </div>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      id="expiring-subscriptions"
      title="מנויים שמסתיימים בקרוב"
      subtitle={windowLabel}
      icon={<CalendarClock className="size-4 shrink-0" aria-hidden />}
      tone="warning"
      info={INSIGHT_EXPLANATIONS['expiring-subscriptions']}
    >
      <ul className="divide-y text-sm">
        {findings.slice(0, 5).map((f) => (
          <ExpiringRow key={f.patternId} finding={f} />
        ))}
      </ul>
    </InsightCard>
  );
}

function ExpiringRow({ finding: f }: { finding: ExpiringSubscriptionFinding }) {
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState<{ ok: boolean; verb: 'renew' | 'end'; message: string } | null>(null);

  function handleRenew() {
    startTransition(async () => {
      const r = await renewRecurringPattern(f.patternId);
      setResolved({
        ok: r.ok,
        verb: 'renew',
        message: r.ok
          ? `חודש עד ${r.nextEndDate ?? ''}`
          : (r.error ?? 'שגיאה בחידוש'),
      });
    });
  }

  function handleEnd() {
    startTransition(async () => {
      const r = await endRecurringPattern(f.patternId);
      setResolved({
        ok: r.ok,
        verb: 'end',
        message: r.ok ? 'סומן כהסתיים' : (r.error ?? 'שגיאה בסיום'),
      });
    });
  }

  // Urgency: which deadline is closer — end-date or cancel-date? The smaller
  // one drives the headline color and the relative-time string.
  const urgentDays = Math.min(f.daysUntilEnd, f.daysUntilCancel);
  const isCancelUrgent = f.daysUntilCancel < f.daysUntilEnd;
  const tone =
    urgentDays < 0      ? 'text-destructive'
    : urgentDays <= 3   ? 'text-destructive'
    : urgentDays <= 14  ? 'text-warning'
    :                     'text-muted-foreground';

  // Hebrew relative time. "בעוד N ימים" / "מחר" / "היום" / "לפני N ימים"
  const relTime =
    urgentDays === 0       ? 'היום'
    : urgentDays === 1     ? 'מחר'
    : urgentDays === -1    ? 'אתמול'
    : urgentDays > 0       ? `בעוד ${urgentDays} ימים`
    :                        `לפני ${Math.abs(urgentDays)} ימים`;

  return (
    <li className="space-y-1.5 py-2.5">
      {/* Row 1: merchant + monthly cost */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-xs" title={f.merchant}>
            {f.description ?? f.merchant}
          </p>
          <p className="text-2xs text-muted-foreground">
            סיום: {f.endDate}
            {!f.autoRenew && ' · ללא חידוש אוטומטי'}
            {f.autoRenew && f.cancelNoticeDays > 0 && ` · ${f.cancelNoticeDays} ימי הודעה`}
          </p>
        </div>
        <p className="shrink-0 text-end font-semibold tabular-nums text-xs">
          {formatIls(Math.abs(f.monthlyIls), { decimals: false })}
          <span className="ms-0.5 text-2xs text-muted-foreground font-normal">/חודש</span>
        </p>
      </div>

      {/* Row 2: urgency line — when does the user need to act? */}
      <p className={`text-2xs font-medium ${tone}`}>
        {isCancelUrgent && f.autoRenew ? 'מועד אחרון לביטול: ' : 'מסתיים: '}
        {relTime}
      </p>

      {/* Row 3: actions OR resolved status */}
      {resolved ? (
        <p
          className={`flex items-center gap-1 text-2xs font-medium ${
            resolved.ok ? 'text-success' : 'text-destructive'
          }`}
        >
          {resolved.ok ? <Check className="size-3" aria-hidden /> : null}
          {resolved.message}
        </p>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleRenew}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success-soft px-2 py-1 text-2xs font-medium text-success hover:bg-success/15 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3" aria-hidden />
            )}
            חדש
          </button>
          <button
            type="button"
            onClick={handleEnd}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-2xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <Square className="size-3" aria-hidden />
            )}
            סיים
          </button>
          <Link
            href={`/transactions?text=${encodeURIComponent(f.merchant)}&flag=recurring`}
            className="inline-flex items-center gap-0.5 rounded-md border bg-card px-2 py-1 text-2xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            בדוק
            <ChevronLeft className="size-3 rtl-flip" aria-hidden />
          </Link>
        </div>
      )}
    </li>
  );
}
