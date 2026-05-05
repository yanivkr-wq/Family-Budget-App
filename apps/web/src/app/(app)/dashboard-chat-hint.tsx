'use client';

/**
 * Click-to-open hint card under the dashboard's category donut. Acts as a big
 * tap target that pops open the AI chat drawer (same as ⌘K). Dispatches the
 * `fba:open-chat` custom event that ChatDrawer listens for.
 *
 * Why a dedicated component: the dashboard page.tsx is a Server Component and
 * can't have onClick handlers. A two-line island handles the interaction
 * without bloating the server tree.
 *
 * Why explicit `dir="rtl"` + `text-right` + the icon outside the text span:
 * earlier attempts had the icon inside the flex flow, which in RTL placed it
 * at the visual right and clipped the leading ש of the Hebrew text. Now the
 * icon is anchored to the visual end (left) via `order-last`, and the text
 * span owns its own width with `flex-1 text-right`, so nothing can encroach
 * on the rightmost character.
 */

import { MessageCircle } from 'lucide-react';

export function DashboardChatHint() {
  return (
    <button
      type="button"
      dir="rtl"
      onClick={() => window.dispatchEvent(new CustomEvent('fba:open-chat'))}
      className="mt-3 flex w-full items-center gap-2.5 rounded-md border bg-accent-soft/50 p-2.5 text-xs text-accent transition-colors hover:bg-accent-soft hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      aria-label='פתח את העוזר. דוגמה: "איפה אפשר לחסוך?". קיצור מקלדת: Cmd+K'
    >
      <MessageCircle className="order-last size-3.5 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-right">
        שאל את העוזר בעברית — לדוגמה: &ldquo;איפה אפשר לחסוך?&rdquo; (⌘K)
      </span>
    </button>
  );
}
