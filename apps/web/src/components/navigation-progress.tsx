'use client';

/**
 * Navigation feedback shown whenever a Next.js client-side navigation is in
 * flight. Two layers:
 *   1. A thick 4px progress bar fixed to the top of the viewport. Sweeps
 *      from 0% → ~85% quickly, plateaus, jumps to 100% when the new page
 *      finishes rendering. Uses the accent (teal) colour with a soft glow.
 *   2. A small floating "טוען…" pill at the top-center of the viewport.
 *      Pulses gently so the user sees a clear "we're working" signal even
 *      if the bar happens to be off-screen / out of their eyeline.
 *
 * Pure React + CSS — no external dependencies.
 * Mount once inside the root layout (inside the <body>).
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  function clear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  // Every time the URL changes, the navigation is COMPLETE — finish the bar.
  useEffect(() => {
    clear();
    setProgress(100);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 300);
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  // On mount, kick off the "loading" animation when a link is clicked.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto')) return;
      if (href === window.location.pathname + window.location.search) return;

      clear();
      setVisible(true);
      setProgress(0);

      let p = 0;
      function tick() {
        p += p < 30 ? 8 : p < 60 ? 4 : p < 80 ? 1.5 : 0.3;
        if (p >= 85) p = 85;
        setProgress(p);
        if (p < 85) {
          rafRef.current = requestAnimationFrame(tick);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (!visible && progress === 0) return null;

  return (
    <>
      {/* Top progress bar — 4px tall, accent color, soft glow shadow underneath. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-1"
      >
        <div
          className="h-full bg-accent shadow-[0_0_10px_2px_rgba(38,124,116,0.55)] transition-all ease-out"
          style={{
            width: `${progress}%`,
            opacity: visible || progress < 100 ? 1 : 0,
            transitionDuration: progress === 100 ? '150ms' : '200ms',
          }}
        />
      </div>

      {/* Floating "טוען…" pill — top-center of the viewport. Stays up while
          navigation is in flight (visible = true). The icon spins so the
          user sees explicit motion. */}
      {visible && (
        <div
          aria-live="polite"
          aria-label="טוען"
          className="pointer-events-none fixed left-1/2 top-3 z-[9999] -translate-x-1/2"
        >
          <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-card/95 px-3 py-1 text-xs font-medium text-accent shadow-lg backdrop-blur-sm">
            <Loader2 className="size-3.5 animate-spin" />
            טוען…
          </div>
        </div>
      )}
    </>
  );
}
