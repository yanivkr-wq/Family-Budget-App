'use client';

/**
 * Thin progress bar that sweeps across the top of the viewport whenever
 * a Next.js client-side navigation is in flight.
 *
 * Uses only React + CSS — no external dependencies.
 * Mount it once inside the root layout (inside the <body>).
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

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
    // Fade out after completion
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
      // Only intercept internal navigation (not external / hash-only links)
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto')) return;
      // Don't animate if it's the same page
      if (href === window.location.pathname + window.location.search) return;

      clear();
      setVisible(true);
      setProgress(0);

      // Animate progress from 0 → ~85% quickly, then slow down to wait for actual load
      let p = 0;
      function tick() {
        p += p < 30 ? 8 : p < 60 ? 4 : p < 80 ? 1.5 : 0.3;
        if (p >= 85) p = 85; // plateau — real completion will jump to 100
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
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px]"
    >
      <div
        className="h-full bg-primary transition-all duration-200 ease-out"
        style={{
          width: `${progress}%`,
          opacity: visible || progress < 100 ? 1 : 0,
          // Smooth entry, instant jump to 100 % on complete
          transitionDuration: progress === 100 ? '150ms' : '200ms',
        }}
      />
    </div>
  );
}
