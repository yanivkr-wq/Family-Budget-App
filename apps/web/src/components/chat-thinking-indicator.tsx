'use client';

/**
 * Friendly multi-stage loading indicator for the chat drawer.
 *
 * Replaces the tiny "thinking..." spinner that flashed for 10-25 seconds while
 * Claude worked. Now shows:
 *   - A bold "העוזר עובד" header with a spinner
 *   - The current tool being run, in Hebrew (e.g., "סורק את התנועות שלך")
 *   - Completed tool steps with a green checkmark + duration
 *   - A rotating "encouragement" line for long waits
 *
 * Renders nothing once the assistant has produced its first text.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

interface ToolCall {
  name: string;
  status: 'running' | 'done' | 'error';
  durationMs?: number;
}

// Map raw tool names → user-friendly Hebrew labels. Add new tools here as the
// agent grows. If a name isn't mapped, the raw name is shown as a fallback.
const TOOL_LABELS: Record<string, string> = {
  query_transactions:           'סורק את התנועות שלך',
  get_category_summary:         'מסכם הוצאות לפי קטגוריות',
  compare_months:               'משווה בין חודשים',
  get_recurring_patterns:       'מאתר הוצאות קבועות',
  get_installment_plans:        'בודק תוכניות תשלומים',
  get_anomalies:                'מחפש חריגות חריגות בהוצאות',
  get_predicted_balance:        'חוזה את היתרה לסוף החודש',
  find_subscription_candidates: 'מאתר מנויים אפשריים',
  search_merchants:             'מחפש בתי עסק',
};

// Friendly messages that rotate while the user waits. Calibrated for 5–25
// second waits. Order is the rotation order; first one shows immediately,
// next one appears after ENCOURAGEMENT_INTERVAL_MS, and we wrap around.
const ENCOURAGEMENTS = [
  'אנחנו עובדים על זה בשבילך…',
  'מעבד את הנתונים שלך — זה לוקח כמה שניות',
  'כדי לתת תשובה מדויקת, צריך לסקור את כל התנועות',
  'כמעט שם — מנסח את התשובה',
];
const ENCOURAGEMENT_INTERVAL_MS = 6000;

export function ChatThinkingIndicator({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [encIdx, setEncIdx] = useState(0);

  // Rotate the encouragement message every 6s.
  useEffect(() => {
    const t = setInterval(() => {
      setEncIdx((i) => (i + 1) % ENCOURAGEMENTS.length);
    }, ENCOURAGEMENT_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  const running = toolCalls.find((c) => c.status === 'running');
  const completed = toolCalls.filter((c) => c.status === 'done');

  // Headline: the running tool's friendly label, or a default while we're
  // still waiting for Claude to pick a tool / write a reply.
  const headline = running
    ? (TOOL_LABELS[running.name] ?? running.name)
    : completed.length > 0
      ? 'מנתח את התוצאות ומנסח תשובה…'
      : 'מתחיל לעבוד על השאלה שלך…';

  return (
    <div
      dir="rtl"
      className="space-y-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs"
    >
      {/* Headline row */}
      <div className="flex items-center gap-2 text-accent">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        <span className="text-sm font-semibold">{headline}</span>
      </div>

      {/* Completed steps (timeline) */}
      {completed.length > 0 && (
        <ul className="space-y-1 ps-1">
          {completed.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="size-3 shrink-0 text-success" />
              <span>{TOOL_LABELS[c.name] ?? c.name}</span>
              {c.durationMs !== undefined && (
                <span className="ms-auto text-[10px] tabular-nums opacity-70">
                  {(c.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Rotating encouragement line — different message every 6s so the user
          knows the UI is alive even on long waits. */}
      <p className="text-[11px] italic text-muted-foreground/80">
        {ENCOURAGEMENTS[encIdx]}
      </p>
    </div>
  );
}
