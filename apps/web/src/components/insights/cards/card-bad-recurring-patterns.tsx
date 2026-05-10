/**
 * Insight #8e — Bad recurring patterns (≥2 of last 6 charges blew through tolerancePct).
 * Shows pattern + tiny sparkline of last 6 actuals + violation count.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Repeat2 } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { BadPatternFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

const INFO = INSIGHT_EXPLANATIONS['bad-recurring-patterns'];

interface Props {
  windowLabel: string;
  findings: BadPatternFinding[];
}

export function CardBadRecurringPatterns({ windowLabel, findings }: Props) {
  if (findings.length === 0) {
    return (
      <InsightCard
        id="bad-recurring-patterns"
        title="תבניות חוזרות חשודות"
        subtitle={windowLabel}
        icon={<Repeat2 className="size-4 shrink-0" aria-hidden />}
        tone="success"
        info={INFO}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <span className="pill bg-success-soft text-success">✓ תקין</span>
          <p className="text-xs text-muted-foreground">כל התבניות החוזרות תקינות</p>
        </div>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      id="bad-recurring-patterns"
      title="תבניות חוזרות חשודות"
      subtitle={windowLabel}
      icon={<Repeat2 className="size-4 shrink-0" aria-hidden />}
      tone="warning"
      info={INFO}
    >
      <div className="flex h-full flex-col">
        <p className="text-xs text-muted-foreground mb-2">
          תבניות שהחיובים האחרונים שלהן חרגו מהטווח המקובל
        </p>
        <ul className="divide-y text-sm">
          {findings.slice(0, 3).map((f) => (
            <li key={f.patternId}>
              <Link
                href={`/transactions?text=${encodeURIComponent(f.merchant)}&flag=recurring`}
                className="group block space-y-1 -mx-1 rounded-md px-1 py-2 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium group-hover:text-accent transition-colors" title={f.merchant}>
                    {f.description ?? f.merchant}
                  </span>
                  <span className="shrink-0 text-2xs text-warning">
                    {f.violations}/6 חריגות
                  </span>
                </div>
                <p className="text-2xs text-muted-foreground">
                  צפוי: {formatIls(f.expectedIls, { decimals: false })} ± {f.tolerancePct}%
                </p>
                <Sparkline values={f.recentCharges} expected={f.expectedIls} tolerancePct={f.tolerancePct} />
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/recurring" className="btn-secondary mt-auto pt-3 text-xs">
          סקור תבניות
        </Link>
      </div>
    </InsightCard>
  );
}

/**
 * Tiny inline SVG sparkline showing the 6 actual charges as bars, with bars
 * outside the tolerance band painted in destructive red. No Recharts overhead
 * for this little widget.
 */
function Sparkline({
  values,
  expected,
  tolerancePct,
}: {
  values: number[];
  expected: number;
  tolerancePct: number;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, expected) * 1.1;
  const tol = (tolerancePct / 100) * expected;
  const width = 120;
  const height = 24;
  const barW = width / values.length - 2;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
      {/* Tolerance band */}
      <rect
        x={0}
        y={((max - (expected + tol)) / max) * height}
        width={width}
        height={Math.max(1, ((expected + tol - Math.max(0, expected - tol)) / max) * height)}
        fill="hsl(var(--success-soft))"
      />
      {values.map((v, i) => {
        const h = (v / max) * height;
        const x = i * (barW + 2);
        const y = height - h;
        const isOut = Math.abs(v - expected) > tol;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={Math.max(1, h)}
            fill={isOut ? 'hsl(var(--destructive))' : 'hsl(var(--chart-1))'}
            opacity={isOut ? 0.9 : 0.6}
          />
        );
      })}
    </svg>
  );
}
