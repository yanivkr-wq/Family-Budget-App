/**
 * Always-on data-quality strip at the top of /insights.
 *
 * Phase A: clicking the strip scrolls to the Data Integrity section
 *          (#data-integrity anchor in page.tsx).
 *
 * Tone:
 *   • clean (no issues)  → success-soft background, ✓ icon
 *   • issues found       → warning-soft background, ⚠ icon, count badges
 *
 * Server component — pure render based on the summary it's handed.
 */

import Link from 'next/link';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { DataQualitySummary } from '@/app/(app)/insights/queries';

interface Props {
  summary: DataQualitySummary;
}

export function DataQualityStrip({ summary }: Props) {
  if (!summary.hasIssues) {
    return (
      <div
        className="flex items-center gap-3 rounded-md border border-success/30 bg-success-soft px-4 py-2.5 text-sm"
        dir="rtl"
        role="status"
      >
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        <span className="text-success">הנתונים שלך תקינים — אין נושאים שדורשים תשומת לב</span>
      </div>
    );
  }

  const items: Array<{ label: string; count: number }> = [];
  if (summary.untaggedCount > 0)
    items.push({ label: 'תנועות ללא קטגוריה', count: summary.untaggedCount });
  if (summary.lowConfidenceCount > 0)
    items.push({ label: 'סיווג בביטחון נמוך', count: summary.lowConfidenceCount });
  if (summary.suspiciousInstallmentsCount > 0)
    items.push({ label: 'תשלומים חשודים', count: summary.suspiciousInstallmentsCount });
  if (summary.unpairedTransferCandidates > 0)
    items.push({ label: 'מועמדים להעברות', count: summary.unpairedTransferCandidates });
  if (summary.badPatternsCount > 0)
    items.push({ label: 'תבניות חוזרות חשודות', count: summary.badPatternsCount });
  if ((summary.worstStaleDays ?? 0) > 14)
    items.push({
      label: `יבוא ישן: ${summary.staleAccountName ?? ''} (${summary.worstStaleDays} ימים)`,
      count: 1,
    });

  return (
    <Link
      href="#data-integrity"
      scroll={true}
      className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm transition-colors hover:bg-warning/10"
      dir="rtl"
    >
      <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="text-warning-foreground">נמצאו נושאים שדורשים תשומת לב:</span>
      <div className="flex flex-wrap items-center gap-2">
        {items.map((it) => (
          <span
            key={it.label}
            className="pill bg-card text-warning-foreground"
            title={it.label}
          >
            {it.count.toLocaleString('he-IL')} {it.label}
          </span>
        ))}
      </div>
      <span className="ms-auto text-xs text-muted-foreground">לחץ לפרטים ↓</span>
    </Link>
  );
}
