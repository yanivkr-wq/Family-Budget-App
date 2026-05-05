'use client';

/**
 * Per-insight "How did I reach this conclusion?" toggle.
 *
 * Renders a small Info button that opens a centered modal popup with the
 * insight's icon + title + plain-Hebrew calculation breakdown. The widget
 * itself is a Server Component; this small island handles the only
 * interactive bit.
 *
 * The modal is rendered via createPortal into document.body so it lives
 * OUTSIDE the parent <Link> wrapper. Without that, every click on the
 * backdrop bubbled up through the Link and triggered navigation, causing
 * the visible "screen flips" the user reported.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function InsightDetailsToggle({
  title,
  explanation,
  icon: Icon,
  iconColorClass,
}: {
  title:           string;
  explanation:     string;
  /** Lucide icon component for the originating insight — rendered next to
   *  the title in the popup header so the popup keeps the visual identity
   *  of the row it came from. */
  icon?:           LucideIcon;
  /** Tailwind text-color class for the icon (matches the row's severity
   *  color). E.g. 'text-destructive' / 'text-warning' / 'text-primary'. */
  iconColorClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Portals require the DOM to exist — guard against SSR rendering.
  useEffect(() => { setMounted(true); }, []);

  // Close on ESC + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const popup = (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="insight-details-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      // Backdrop click closes; the actual modal content swallows clicks below
      // so they don't bubble to the backdrop.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.target === backdropRef.current) setOpen(false);
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card shadow-xl"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              איך הגעתי למסקנה הזו?
            </p>
            <h2
              id="insight-details-title"
              className="mt-0.5 flex items-start gap-2 text-base font-semibold leading-tight"
            >
              {Icon && (
                <Icon className={cn('mt-0.5 size-4 shrink-0', iconColorClass ?? 'text-primary')} />
              )}
              <span className="min-w-0">{title}</span>
            </h2>
          </div>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent/40"
            aria-label="סגור"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-foreground/85">
          <p className="whitespace-pre-line">{explanation}</p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        // Stop the click from bubbling up to a parent <Link>.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="איך הגעתי לתובנה הזו?"
        title="איך הגעתי לתובנה הזו?"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Info className="size-3.5" />
      </button>

      {/* Render the popup via portal into document.body so its clicks NEVER
          bubble up through the row's parent <Link>. */}
      {open && mounted && createPortal(popup, document.body)}
    </>
  );
}
