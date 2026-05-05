'use client';

/**
 * Per-insight "How did I reach this conclusion?" toggle.
 *
 * Renders a small Info button that opens a centered modal popup with the
 * insight's title + plain-Hebrew calculation breakdown. The widget itself is
 * a Server Component; this small island handles the only interactive bit.
 *
 * Mirrors the modal pattern used by InsightsCatalogToggle (and the rest of
 * the app's modals — installment-modal, savings, etc.) so the widget UX is
 * consistent: every "i" you click opens a popup.
 */

import { useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';

export function InsightDetailsToggle({
  title,
  explanation,
}: {
  title: string;
  explanation: string;
}) {
  const [open, setOpen] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on ESC + lock body scroll while open. Same pattern as
  // InsightsCatalogToggle.
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

  return (
    <>
      <button
        type="button"
        // Stop the click from bubbling up to a parent <Link> (the whole row is
        // sometimes wrapped in a Link to /transactions etc.).
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

      {open && (
        <div
          ref={backdropRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="insight-details-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === backdropRef.current) setOpen(false); }}
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card shadow-xl"
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  איך הגעתי למסקנה הזו?
                </p>
                <h2 id="insight-details-title" className="mt-0.5 text-base font-semibold leading-tight">
                  {title}
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
      )}
    </>
  );
}
