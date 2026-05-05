import { cn } from '@/lib/utils';
import { formatIls } from '@fba/shared';

export interface BudgetProgressProps {
  label: string;
  actual: number;
  target?: number | null;
  /** Optional swatch color for the label dot — usually category.color */
  color?: string | null;
  className?: string;
}

/**
 * Per-category budget progress row used on the dashboard and category list.
 * Shows label + amount, plus a bar that goes:
 *   neutral (under 80%) → warning (80-99%) → destructive (>=100%).
 * If no target is set, just shows the actual without a bar.
 */
export function BudgetProgress({ label, actual, target, color, className }: BudgetProgressProps) {
  const hasTarget = typeof target === 'number' && target > 0;
  const pct = hasTarget ? Math.min(100, (actual / target!) * 100) : null;

  const barClass = !hasTarget
    ? ''
    : pct! >= 100
      ? 'bg-destructive'
      : pct! >= 80
        ? 'bg-warning'
        : 'bg-primary';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {color && (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
          )}
          <span>{label}</span>
        </div>
        <div className="text-sm tabular-nums">
          <span className="font-semibold">{formatIls(actual, { decimals: false })}</span>
          {hasTarget && (
            <span className="text-muted-foreground">
              {' / '}
              {formatIls(target!, { decimals: false })}
            </span>
          )}
        </div>
      </div>
      {hasTarget && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all', barClass)}
            style={{ width: `${pct!}%` }}
          />
        </div>
      )}
    </div>
  );
}
