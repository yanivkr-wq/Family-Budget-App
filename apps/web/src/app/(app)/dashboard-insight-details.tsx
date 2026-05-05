'use client';

/**
 * Click-to-expand "How did I reach this conclusion?" toggle for the dashboard
 * AI Insights widget. The widget itself is a Server Component; this small
 * island handles the only interactive bit — the disclosure.
 */

import { useState } from 'react';
import { Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function InsightDetailsToggle({
  explanation,
  className,
}: {
  explanation: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        // Stop the click from bubbling up to a parent <Link> (the whole row is
        // sometimes wrapped in a Link to /transactions etc.)
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={open ? 'סגור הסבר' : 'איך הגעתי לתובנה הזו?'}
        title="איך הגעתי לתובנה הזו?"
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground',
          className,
        )}
      >
        {open ? <X className="size-3" /> : <Info className="size-3.5" />}
      </button>

      {open && (
        // Inline expansion below the insight body. dir="rtl" so Hebrew text
        // and the heading read naturally.
        <div
          className="mt-2 rounded-md border bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          dir="rtl"
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            איך הגעתי למסקנה הזו?
          </p>
          <p className="whitespace-pre-line text-foreground/80">{explanation}</p>
        </div>
      )}
    </>
  );
}
