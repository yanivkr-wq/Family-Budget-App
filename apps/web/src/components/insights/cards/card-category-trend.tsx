'use client';

/**
 * Insight #5 — Category trend (BI drill-stack: top → sub → merchant).
 *
 * Visual rewrite per feedback: properly-aligned horizontal bar list with
 * consistent left-aligned labels, right-aligned values, and a subtle 4-month
 * sparkline next to each bar showing direction. Eliminates the cramped
 * Recharts vertical-layout issues from the first pass.
 */

import { useState, useTransition, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, LineChart as LineChartIcon } from 'lucide-react';
import { formatIls } from '@fba/shared';
import { InsightCard } from '@/components/insights/insight-card';
import { fetchCategoryTrendLevel, type CategoryTrendDrillResult } from '@/app/(app)/insights/actions';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

const CHART_FALLBACK = 'hsl(215 65% 35%)';

interface Props {
  windowLabel: string;
  initial: CategoryTrendDrillResult;
}

export function CardCategoryTrend({ windowLabel, initial }: Props) {
  return (
    <InsightCard
      id="category-trend"
      title="מגמת קטגוריות"
      subtitle={`${windowLabel} · 4 חודשים`}
      icon={<LineChartIcon className="size-4 shrink-0" aria-hidden />}
      tone="accent"
      info={INSIGHT_EXPLANATIONS['category-trend']}
      renderBody={({ stack, push }) => (
        <CategoryTrendBody initial={initial} stack={stack} pushCrumb={push} />
      )}
    />
  );
}

interface BodyProps {
  initial: CategoryTrendDrillResult;
  stack: { label: string; filterValue: string }[];
  pushCrumb: (c: { label: string; filterValue: string }) => void;
}

function CategoryTrendBody({ initial, stack, pushCrumb }: BodyProps) {
  const [data, setData] = useState<CategoryTrendDrillResult>(initial);
  const [pending, startTransition] = useTransition();

  // Re-fetch whenever the drill stack changes.
  useEffect(() => {
    if (stack.length === 0) {
      setData(initial);
      return;
    }
    startTransition(async () => {
      const next = await fetchCategoryTrendLevel(stack.map((c) => c.filterValue));
      setData(next);
    });
  }, [stack, initial]);

  // Leaf = we're already at merchant level (the deepest bucket type), regardless
  // of how the user got there. Lets the fall-through case (sub-cat skipped to
  // merchant because there were no sub-cat'd transactions) read the same as
  // a normal 3-level drill.
  const isLeaf = data.effectiveLevel === 'merchant';
  const rows = useMemo(() => data.buckets.slice(0, 8), [data.buckets]);
  const maxTotal = useMemo(() => Math.max(1, ...rows.map((r) => r.total)), [rows]);

  if (pending && data.buckets.length === 0) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">טוען…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 py-4 text-center">
        <p className="text-xs text-muted-foreground">אין נתונים ברמה הזו</p>
        <p className="text-2xs text-muted-foreground/80">נסה לחזור רמה אחת אחורה ולבחור קטגוריה אחרת</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 space-y-2.5">
        {rows.map((row) => {
          const widthPct = Math.max(6, (row.total / maxTotal) * 100);
          const color = row.color ?? CHART_FALLBACK;
          const trendIcon =
            row.direction === 'up' ? (
              <TrendingUp className="size-3 text-destructive" aria-hidden />
            ) : row.direction === 'down' ? (
              <TrendingDown className="size-3 text-success" aria-hidden />
            ) : (
              <Minus className="size-3 text-muted-foreground" aria-hidden />
            );
          const Tag: React.ElementType = isLeaf ? 'div' : 'button';
          return (
            <li key={row.id}>
              <Tag
                type={isLeaf ? undefined : 'button'}
                onClick={
                  isLeaf
                    ? undefined
                    : () => pushCrumb({ label: row.label, filterValue: row.id })
                }
                className={`block w-full text-start ${
                  isLeaf ? '' : 'cursor-pointer rounded-md hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring/50'
                }`}
                aria-label={`${row.label}: ${formatIls(row.total, { decimals: false })}`}
              >
                {/* Row 1: label + amount, baseline-aligned */}
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <span className="flex items-center gap-1.5 min-w-0 text-xs font-medium">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="truncate" title={row.label}>{row.label}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {formatIls(row.total, { decimals: false })}
                  </span>
                </div>
                {/* Row 2: bar + sparkline + delta */}
                <div className="mt-1 flex items-center gap-2 px-1">
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${widthPct}%`, backgroundColor: color }}
                    />
                  </div>
                  <Sparkline values={row.monthly.map((m) => m.total)} color={color} />
                  <span className="flex shrink-0 items-center gap-0.5 text-2xs tabular-nums text-muted-foreground" style={{ minWidth: 36 }}>
                    {trendIcon}
                    {row.changePct == null ? '—' : `${row.changePct > 0 ? '+' : ''}${row.changePct.toFixed(0)}%`}
                  </span>
                </div>
              </Tag>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-2xs text-muted-foreground">
        {isLeaf ? '💡 הקש על שורה לצפייה בתנועות (זמין בפאזה הבאה)' : '💡 הקש על קטגוריה כדי להעמיק'}
      </p>
    </div>
  );
}

/**
 * Tiny inline SVG sparkline (4 monthly values). Pure SVG so we don't need
 * Recharts here — keeps each row light and uniform-width.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length === 0) return <span style={{ width: 48 }} />;
  const max = Math.max(...values, 1);
  const w = 48;
  const h = 16;
  const step = w / Math.max(1, values.length - 1);
  const pts = values
    .map((v, i) => `${i * step},${h - (v / max) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
