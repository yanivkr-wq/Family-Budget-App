/**
 * Insight #8c — Suspicious installments (counter overflow / missing cycle / amount drift).
 */

import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { SuspiciousInstallmentFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

const INFO = INSIGHT_EXPLANATIONS['suspicious-installments'];

const REASON_LABEL: Record<SuspiciousInstallmentFinding['reason'], string> = {
  overflow: 'מספר תשלום מעל הסך הצפוי',
  missing_cycle: 'אין חיוב בחודש הנוכחי',
  amount_drift: 'סכום בפועל שונה מהמוצהר',
};

interface Props {
  windowLabel: string;
  findings: SuspiciousInstallmentFinding[];
}

export function CardSuspiciousInstallments({ windowLabel, findings }: Props) {
  if (findings.length === 0) {
    return (
      <InsightCard
        id="suspicious-installments"
        title="תשלומים חשודים"
        subtitle={windowLabel}
        icon={<CalendarClock className="size-4 shrink-0" aria-hidden />}
        tone="success"
        info={INFO}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <span className="pill bg-success-soft text-success">✓ תקין</span>
          <p className="text-xs text-muted-foreground">כל תוכניות התשלומים נראות תקינות</p>
        </div>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      id="suspicious-installments"
      title="תשלומים חשודים"
      subtitle={windowLabel}
      icon={<CalendarClock className="size-4 shrink-0" aria-hidden />}
      tone="warning"
      info={INFO}
    >
      <div className="flex h-full flex-col">
        <ul className="divide-y text-sm">
          {findings.slice(0, 4).map((f) => (
            <li key={f.planId}>
              <Link
                href={`/transactions?text=${encodeURIComponent(f.merchant)}&flag=installment`}
                className="group block space-y-0.5 -mx-1 rounded-md px-1 py-2 transition-colors hover:bg-muted/40"
              >
                <p className="truncate font-medium text-xs group-hover:text-accent transition-colors" title={f.merchant}>
                  {f.description ?? f.merchant}
                </p>
                <p className="text-2xs text-warning">{REASON_LABEL[f.reason]}</p>
                <p className="text-2xs text-muted-foreground">{f.detail}</p>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/installments" className="btn-secondary mt-auto pt-3 text-xs">
          בדוק תשלומים
        </Link>
      </div>
    </InsightCard>
  );
}
