'use client';

/**
 * Client-side wrapper that lazy-loads CategoryDonut (Recharts ~450 KB) on demand.
 * Import this instead of CategoryDonut directly from Server Components.
 * The ssr:false here is allowed because this file itself is a Client Component.
 */
import dynamic from 'next/dynamic';
import type { CategoryDonutDatum } from './category-donut';
import { AppLoader } from './app-loader';

export type { CategoryDonutDatum };

export const CategoryDonutLazy = dynamic(
  () => import('./category-donut').then((m) => m.CategoryDonut),
  {
    ssr: false,
    // Use the same animated loader as the page-level fallback (instead of a
    // gray pulsing rectangle) so the dashboard stays visually consistent
    // while Recharts is being fetched.
    loading: () => (
      <div className="h-[220px]">
        <AppLoader inline text="" />
      </div>
    ),
  },
);
