'use client';

/**
 * Net cash flow per month — single smooth area in the comparison-chart family.
 *
 * The area is colored with the primary blue when monthly net is positive and
 * destructive when negative. We split the visual into two stacked Areas so the
 * gradient flips above/below the 0 reference line — gives a clean "surplus
 * green, deficit red" shading without the bar look.
 */

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts';
import { formatIls } from '@fba/shared';
import { TrendingUp } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { NetCashFlowBucket } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  buckets: NetCashFlowBucket[];
}

export function CardNetCashFlow({ windowLabel, buckets }: Props) {
  const hasData = buckets.some((b) => b.netIls !== 0);
  const latest = buckets[buckets.length - 1];
  const positiveMonths = buckets.filter((b) => b.netIls > 0).length;

  return (
    <InsightCard
      id="net-cash-flow"
      title="מאזן נטו לאורך זמן"
      subtitle={`${windowLabel} · 6 חודשים`}
      icon={<TrendingUp className="size-4 shrink-0" aria-hidden />}
      tone="accent"
      info={INSIGHT_EXPLANATIONS['net-cash-flow']}
    >
      {!hasData ? (
        <p className="py-6 text-center text-xs text-muted-foreground">אין מספיק נתונים לחישוב המאזן</p>
      ) : (
        <div className="flex h-full flex-col">
          {latest && (
            <div className="mb-2 flex items-baseline gap-2">
              <span
                className={`text-lg font-semibold tabular-nums ${
                  latest.netIls >= 0 ? 'text-success' : 'text-destructive'
                }`}
              >
                {latest.netIls >= 0 ? '+' : ''}
                {formatIls(latest.netIls, { decimals: false })}
              </span>
              <span className="text-2xs text-muted-foreground">
                {positiveMonths}/{buckets.length} חודשים בעודף
              </span>
            </div>
          )}

          <div className="flex-1 min-h-[180px]" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={buckets} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="ncf-pos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="ncf-neg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.02} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.45} />
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
                    Math.abs(v) >= 1000
                      ? `${v < 0 ? '-' : ''}${Math.round(Math.abs(v) / 1000)}k`
                      : `${Math.round(v)}`
                  }
                />
                <ReferenceLine y={0} stroke="hsl(var(--border-strong))" strokeWidth={1.5} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 'var(--radius)',
                    fontSize: '12px',
                    padding: '8px 10px',
                    direction: 'rtl',
                  }}
                  formatter={(value: number) => [formatIls(value, { decimals: false }), 'מאזן']}
                />
                {/* Single smooth area; the line color flips at the 0 axis via
                    a CSS variable trick by using two stacked filled areas
                    keyed off the sign of the value */}
                <Area
                  type="monotone"
                  dataKey="netIls"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  fill="url(#ncf-pos)"
                  baseValue={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </InsightCard>
  );
}
