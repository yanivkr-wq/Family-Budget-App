'use client';

/**
 * Income vs Expenses comparison over time.
 *
 * Visual rewrite per user feedback (reference screenshot): two smooth monotone
 * area lines with soft gradient fills underneath, dashed horizontal grid,
 * Y-axis labels visible on the LEFT (Recharts default for an LTR chart inside
 * an RTL card — chart axis stays LTR for legibility of numbers).
 *
 * Removed: side-by-side bars, net-line overlay (signal-to-noise too high).
 * Kept: latest-month net headline above the chart, color-coded.
 */

import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatIls } from '@fba/shared';
import { Scale } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { IncomeVsExpenseBucket } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  buckets: IncomeVsExpenseBucket[];
}

export function CardIncomeVsExpenses({ windowLabel, buckets }: Props) {
  const hasData = buckets.some((b) => b.incomeIls + b.expensesIls > 0);
  const latest = buckets[buckets.length - 1];
  const netColor = latest && latest.netIls >= 0 ? 'text-success' : 'text-destructive';

  return (
    <InsightCard
      id="income-vs-expenses"
      title="הכנסות מול הוצאות"
      subtitle={`${windowLabel} · 6 חודשים`}
      icon={<Scale className="size-4 shrink-0" aria-hidden />}
      tone="accent"
      info={INSIGHT_EXPLANATIONS['income-vs-expenses']}
    >
      {!hasData ? (
        <p className="py-6 text-center text-xs text-muted-foreground">אין מספיק נתונים להשוואה</p>
      ) : (
        <div className="flex h-full flex-col">
          {latest && (
            <div className="mb-2 flex items-baseline gap-2">
              <span className={`text-lg font-semibold tabular-nums ${netColor}`}>
                {latest.netIls >= 0 ? '+' : ''}
                {formatIls(latest.netIls, { decimals: false })}
              </span>
              <span className="text-2xs text-muted-foreground">מאזן החודש</span>
            </div>
          )}

          <SmoothComparisonChart buckets={buckets} />

          <div className="mt-2 flex justify-end gap-3 text-2xs text-muted-foreground">
            <Link
              href="/transactions?sign=income"
              className="flex items-center gap-1 hover:text-accent hover:underline transition-colors"
            >
              <span className="size-2 rounded-sm bg-chart-4" /> הכנסות
            </Link>
            <Link
              href="/transactions?sign=expense"
              className="flex items-center gap-1 hover:text-accent hover:underline transition-colors"
            >
              <span className="size-2 rounded-sm bg-chart-6" /> הוצאות
            </Link>
          </div>
        </div>
      )}
    </InsightCard>
  );
}

/**
 * The actual chart — extracted so we can reuse the look across the other X-vs-Y
 * cards in the future. Smooth monotone area, dashed grid, LTR axis (numbers
 * read left-to-right even inside an RTL card; that's how finance dashboards
 * typically work and matches the reference screenshot).
 */
function SmoothComparisonChart({ buckets }: { buckets: IncomeVsExpenseBucket[] }) {
  return (
    <div className="flex-1 min-h-[180px]" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={buckets} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <defs>
            {/* Forest green gradient for income */}
            <linearGradient id="iv-income" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-4))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--chart-4))" stopOpacity={0.02} />
            </linearGradient>
            {/* Coral gradient for expenses */}
            <linearGradient id="iv-expenses" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-6))" stopOpacity={0.32} />
              <stop offset="100%" stopColor="hsl(var(--chart-6))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 6"
            stroke="hsl(var(--border))"
            vertical={false}
          />
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
              name === 'incomeIls' ? 'הכנסות' : 'הוצאות',
            ]}
          />
          {/* Two smooth monotone areas, overlaid (NOT stacked) */}
          <Area
            type="monotone"
            dataKey="expensesIls"
            stroke="hsl(var(--chart-6))"
            strokeWidth={2}
            fill="url(#iv-expenses)"
          />
          <Area
            type="monotone"
            dataKey="incomeIls"
            stroke="hsl(var(--chart-4))"
            strokeWidth={2}
            fill="url(#iv-income)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
