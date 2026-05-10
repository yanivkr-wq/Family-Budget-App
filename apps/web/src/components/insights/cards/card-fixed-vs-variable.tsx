'use client';

/**
 * Insight #7 — Fixed vs Variable cost ratio (last 6 months).
 *
 * Same visual family as the Income vs Expenses card: two smooth monotone area
 * lines with soft gradients, dashed grid, LTR axis. Two series overlaid (NOT
 * stacked) so they're directly comparable.
 */

import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatIls } from '@fba/shared';
import { Layers } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { FixedVsVariableMonthlyBucket } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  buckets: FixedVsVariableMonthlyBucket[];
}

export function CardFixedVsVariable({ windowLabel, buckets }: Props) {
  const hasData = buckets.some((b) => b.fixedIls + b.variableIls > 0);
  const latest = buckets[buckets.length - 1];

  return (
    <InsightCard
      id="fixed-vs-variable"
      title="קבוע מול משתנה"
      subtitle={`${windowLabel} · 6 חודשים`}
      icon={<Layers className="size-4 shrink-0" aria-hidden />}
      tone="accent"
      info={INSIGHT_EXPLANATIONS['fixed-vs-variable']}
    >
      {!hasData ? (
        <p className="py-6 text-center text-xs text-muted-foreground">אין מספיק נתונים לחישוב היחס</p>
      ) : (
        <div className="flex h-full flex-col">
          {latest && (
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums">{latest.fixedPct.toFixed(0)}%</span>
              <span className="text-2xs text-muted-foreground">קבוע מסך ההוצאות החודש</span>
            </div>
          )}

          <div className="flex-1 min-h-[180px]" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={buckets} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="fv-fixed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fv-variable" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-3))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={(m: string) => m.slice(5)}
                  padding={{ left: 12, right: 12 }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`
                  }
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 'var(--radius)',
                    fontSize: '12px',
                    padding: '8px 10px',
                    direction: 'rtl',
                  }}
                  formatter={(value: number, name: string) => [
                    formatIls(value, { decimals: false }),
                    name === 'fixedIls' ? 'קבוע' : 'משתנה',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="variableIls"
                  stroke="hsl(var(--chart-3))"
                  strokeWidth={2}
                  fill="url(#fv-variable)"
                />
                <Area
                  type="monotone"
                  dataKey="fixedIls"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  fill="url(#fv-fixed)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex justify-end gap-3 text-2xs text-muted-foreground">
            <Link
              href="/transactions?flag=recurring&sign=expense"
              className="flex items-center gap-1 hover:text-accent hover:underline transition-colors"
            >
              <span className="size-2 rounded-sm bg-chart-1" /> קבוע
            </Link>
            <Link
              href="/transactions?flag=one-off&sign=expense"
              className="flex items-center gap-1 hover:text-accent hover:underline transition-colors"
            >
              <span className="size-2 rounded-sm bg-chart-3" /> משתנה
            </Link>
          </div>
        </div>
      )}
    </InsightCard>
  );
}
