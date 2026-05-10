/**
 * Server-side helper for reading the active view cookie set by <ViewTabs>.
 *
 * Lives in its own file (not view-tabs.tsx) because that file is marked
 * 'use client' for the click handler, and importing `cookies()` from
 * `next/headers` is forbidden in client modules.
 *
 * Resolution order for "what view to show":
 *   1. URL search param (?view=…) — explicit, takes precedence
 *   2. fba_view cookie               — what the user last clicked
 *   3. 'combined'                    — global default
 */

import { cookies } from 'next/headers';
import type { View } from './view-tabs';

const VIEW_COOKIE = 'fba_view';
const VALID: View[] = ['combined', 'personal', 'business', 'household'];

function isValidView(v: unknown): v is View {
  return typeof v === 'string' && VALID.includes(v as View);
}

/** Resolve the active view for a server-rendered page. Pass the URL's
 *  view-search-param if present; this helper takes care of the cookie
 *  fallback and the global default. */
export async function readActiveView(urlParam?: string): Promise<View> {
  if (isValidView(urlParam)) return urlParam;
  const cookieView = (await cookies()).get(VIEW_COOKIE)?.value;
  if (isValidView(cookieView)) return cookieView;
  return 'combined';
}
