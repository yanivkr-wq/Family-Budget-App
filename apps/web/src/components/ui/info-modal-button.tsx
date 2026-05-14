'use client';

/**
 * Click-to-open modal that explains how a metric is computed. Replaces
 * the native browser tooltip (`title=`) used by Tile so explanations get:
 *   • Proper line breaks (the `\n` in the original strings now render)
 *   • A real heading + scrollable body — long explanations don't get cut off
 *   • Esc / outside-click / X-button to close
 *   • Touch-friendly (browser tooltips don't work on tap)
 *
 * Pass the same explainer text Tile previously took via `info`. The
 * button is a small "i" pill rendered inline with the tile label.
 */

import { useEffect, useRef, useState } from 'react';
import { X, Info } from 'lucide-react';

export function InfoModalButton({
  title,
  body,
  buttonClassName,
}: {
  title: string;
  /** Multiline explanation. `\n` → line breaks, `\n\n` → paragraph break. */
  body: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // ESC closes; lock body scroll while open.
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
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label={`הסבר על ${title}`}
        className={
          buttonClassName ??
          'inline-flex size-4 cursor-pointer items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground/80 hover:bg-accent hover:text-foreground transition-colors'
        }
        title="לחץ להסבר"
      >
        i
      </button>

      {open && (
        <div
          ref={backdropRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === backdropRef.current) setOpen(false); }}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border bg-card shadow-2xl max-h-[85vh] flex flex-col"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b bg-muted/20 px-5 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Info className="size-4 text-primary" />
                {title}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent/40"
                aria-label="סגור"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Body — paragraphs split on blank lines, lines split on \n */}
            <div className="overflow-y-auto px-5 py-4 text-sm leading-relaxed text-foreground/90">
              {body.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="mb-3 last:mb-0 whitespace-pre-line">
                  {para}
                </p>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t bg-muted/10 px-5 py-2.5 text-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-primary px-4"
              >
                הבנתי
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
