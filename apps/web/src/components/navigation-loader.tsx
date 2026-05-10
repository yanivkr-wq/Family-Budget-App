'use client';

/**
 * Whole-screen navigation loader. Two-part behaviour:
 *
 *   1. The MOMENT the user clicks an internal link, an overlay with the
 *      <AppLoader> appears. No 100-800ms gap waiting for the server roundtrip
 *      to start streaming — feedback is instant.
 *   2. When `usePathname()` / `useSearchParams()` change (Next.js has
 *      navigated to the new URL), the overlay disappears.
 *
 * If the destination's loading.tsx subsequently fires, AppLoader stays
 * visible inside the page area for the rest of the data-fetch wait — so the
 * user sees one continuous loader from click → render.
 *
 * pointer-events: none on the overlay — the user can keep clicking nav links
 * to change destination mid-flight without being blocked.
 */

import { useEffect, useState, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { AppLoader } from './ui/app-loader';

function NavigationLoaderInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, setNavigating] = useState(false);

  // URL changed → the new page is being rendered, the overlay can come down.
  useEffect(() => {
    setNavigating(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Don't intercept ctrl/cmd/shift/middle clicks — let the browser handle
      // open-in-new-tab etc. naturally.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      // Skip external, hash, mail, tel, download, target=_blank links.
      if (
        href.startsWith('http') ||
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:')
      ) return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.getAttribute('target') === '_blank') return;
      // Skip same-page navigation (the URL won't change → overlay would never clear).
      if (href === window.location.pathname + window.location.search) return;
      setNavigating(true);
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (!navigating) return null;

  return (
    <div
      // pointer-events-none keeps the nav clickable while the overlay is up.
      // bg-background/70 + backdrop-blur gives a soft frosted veil — the
      // page being left is clearly visible behind the loader, but the blur
      // signals "you're between screens."
      className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      aria-live="polite"
      aria-label="טוען"
    >
      <AppLoader inline />
    </div>
  );
}

export function NavigationLoader() {
  // useSearchParams() requires Suspense at the boundary in App Router.
  return (
    <Suspense fallback={null}>
      <NavigationLoaderInner />
    </Suspense>
  );
}
