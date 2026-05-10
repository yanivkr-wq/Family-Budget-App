'use client';

/**
 * Breadcrumb shown at the top of a drill-stack-aware insight card.
 *
 *   ⌐ הכל › מזון › מסעדות
 *
 * "הכל" (root) is always present and clickable to reset. Every previous crumb
 * (everything except the deepest) is a button that pops the stack back to that
 * level. The deepest crumb is plain text — that's where you are.
 */

import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DrillCrumb } from '@/app/(app)/insights/types';

interface Props {
  stack: DrillCrumb[];
  /** Called with the index to roll BACK to (0 = root, len = current). */
  onCrumbClick: (index: number) => void;
}

export function InsightCardBreadcrumb({ stack, onCrumbClick }: Props) {
  return (
    <nav
      aria-label="נתיב הצגה"
      className="flex items-center gap-1 text-xs min-w-0 overflow-hidden"
    >
      <Crumb label="הכל" isCurrent={stack.length === 0} onClick={() => onCrumbClick(0)} />
      {stack.map((c, i) => {
        const isLast = i === stack.length - 1;
        return (
          <span key={`${c.filterValue}-${i}`} className="flex items-center gap-1 min-w-0">
            <ChevronLeft className="size-3 shrink-0 text-muted-foreground rtl-flip" aria-hidden />
            <Crumb
              label={c.label}
              isCurrent={isLast}
              onClick={() => onCrumbClick(i + 1)}
            />
          </span>
        );
      })}
    </nav>
  );
}

function Crumb({
  label,
  isCurrent,
  onClick,
}: {
  label: string;
  isCurrent: boolean;
  onClick: () => void;
}) {
  if (isCurrent) {
    return (
      <span
        className="truncate font-medium text-foreground"
        aria-current="page"
        title={label}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'truncate rounded px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      title={label}
    >
      {label}
    </button>
  );
}
