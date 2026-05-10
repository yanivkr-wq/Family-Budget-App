/**
 * Hero KPI strip — top-of-page summary tiles.
 *
 * Four big-number tiles with icons + delta indicators. Sets the context for
 * everything below. Reference: modern BI dashboards (HR, finance, ops) all
 * lead with a 3–5-tile KPI strip; it's the first thing the eye lands on and
 * primes the read of the cards underneath.
 *
 * Server component — pure render of the KPI numbers passed in.
 */

import { ArrowUp, ArrowDown, type LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, PiggyBank, Receipt } from 'lucide-react';
import { formatIls } from '@fba/shared';
import { cn } from '@/lib/utils';
import type { DashboardKpis } from '@/app/(app)/insights/queries';

interface Props {
  kpis: DashboardKpis;
}

export function HeroKpiStrip({ kpis }: Props) {
  const netPositive = kpis.netIls >= 0;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" dir="rtl">
      <KpiTile
        label="הכנסות"
        value={formatIls(kpis.incomeIls, { decimals: false })}
        deltaPct={kpis.incomeDeltaPct}
        deltaGoodWhenUp={true}
        icon={TrendingUp}
        accent="success"
      />
      <KpiTile
        label="הוצאות"
        value={formatIls(kpis.expensesIls, { decimals: false })}
        deltaPct={kpis.expensesDeltaPct}
        deltaGoodWhenUp={false}
        icon={Receipt}
        accent="warning"
      />
      <KpiTile
        label="מאזן נטו"
        value={`${kpis.netIls >= 0 ? '+' : ''}${formatIls(kpis.netIls, { decimals: false })}`}
        icon={netPositive ? TrendingUp : TrendingDown}
        accent={netPositive ? 'success' : 'destructive'}
        valueTone={netPositive ? 'success' : 'destructive'}
      />
      <KpiTile
        label="שיעור חיסכון"
        value={kpis.savingsRate == null ? '—' : `${(kpis.savingsRate * 100).toFixed(0)}%`}
        sublabel={
          kpis.savingsRate == null
            ? 'אין נתוני הכנסה'
            : `${kpis.txnCount.toLocaleString('he-IL')} תנועות`
        }
        icon={PiggyBank}
        accent="primary"
      />
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
  sublabel?: string;
  deltaPct?: number | null;
  /** When true, an UP delta is GOOD (income up = good). False = bad (expenses up = bad). */
  deltaGoodWhenUp?: boolean;
  icon: LucideIcon;
  accent: 'success' | 'warning' | 'destructive' | 'primary' | 'accent';
  valueTone?: 'success' | 'destructive';
}

const ACCENT_BG: Record<KpiTileProps['accent'], string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-accent',
};

function KpiTile({
  label,
  value,
  sublabel,
  deltaPct,
  deltaGoodWhenUp = true,
  icon: Icon,
  accent,
  valueTone,
}: KpiTileProps) {
  return (
    <article className="group relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
      {/* Subtle gradient wash at the top edge — adds depth without dominating */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-12 opacity-30',
          accent === 'success' && 'bg-gradient-to-b from-success/10 to-transparent',
          accent === 'warning' && 'bg-gradient-to-b from-warning/10 to-transparent',
          accent === 'destructive' && 'bg-gradient-to-b from-destructive/10 to-transparent',
          accent === 'primary' && 'bg-gradient-to-b from-primary/10 to-transparent',
          accent === 'accent' && 'bg-gradient-to-b from-accent/10 to-transparent',
        )}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p
            className={cn(
              'mt-1 text-2xl font-semibold tracking-tight tabular-nums',
              valueTone === 'success' && 'text-success',
              valueTone === 'destructive' && 'text-destructive',
              !valueTone && 'text-foreground',
            )}
          >
            {value}
          </p>
          {sublabel && (
            <p className="mt-0.5 text-2xs text-muted-foreground">{sublabel}</p>
          )}
          {deltaPct != null && (
            <DeltaPill pct={deltaPct} goodWhenUp={deltaGoodWhenUp} />
          )}
        </div>

        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            ACCENT_BG[accent],
          )}
        >
          <Icon className="size-4" aria-hidden />
        </div>
      </div>
    </article>
  );
}

function DeltaPill({ pct, goodWhenUp }: { pct: number; goodWhenUp: boolean }) {
  const up = pct > 0.5;
  const down = pct < -0.5;
  const tone = up ? (goodWhenUp ? 'text-success' : 'text-destructive') : down ? (goodWhenUp ? 'text-destructive' : 'text-success') : 'text-muted-foreground';
  const Arrow = up ? ArrowUp : down ? ArrowDown : null;
  return (
    <p className={cn('mt-1.5 flex items-center gap-0.5 text-2xs font-medium tabular-nums', tone)}>
      {Arrow && <Arrow className="size-3" aria-hidden />}
      {up ? '+' : ''}
      {pct.toFixed(0)}%
      <span className="ms-0.5 text-muted-foreground font-normal">לעומת תקופה קודמת</span>
    </p>
  );
}
