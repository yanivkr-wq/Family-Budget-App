'use client';

/**
 * App-wide loader. Used in every loading.tsx + the navigation-loader overlay
 * so the user always sees the same animated icon spinner.
 *
 * Behavior:
 *   • 10 finance/budget icons, shuffled per mount → each load looks different.
 *   • Icon cycles every `intervalMs` (default 1200ms — preview round 3 winner).
 *   • Three concentric rings pulse outward behind the icon ("radar" effect).
 *   • Text under the loader: shows "עובדים על זה" for the first 3s, then if
 *     the loader is still on screen, cycles funny Hebrew lines every 3.5s.
 *     Fast navigations never see the jokes; long ones get entertainment.
 *   • Pass an explicit `text` prop to override / disable the cycling.
 *     Pass `text=""` to hide the text entirely (used by the inline donut
 *     placeholder so the chart area stays uncluttered).
 *
 * All animation periods scale with `intervalMs` so changing the speed keeps
 * the visual proportions consistent.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Wallet, Coins, Banknote, CreditCard, PiggyBank,
  TrendingUp, Receipt, ShoppingBag, Calculator, Landmark,
} from 'lucide-react';

const ICON_POOL = [
  Wallet, Coins, Banknote, CreditCard, PiggyBank,
  TrendingUp, Receipt, ShoppingBag, Calculator, Landmark,
] as const;

// Funny Hebrew loading lines — kick in only after the loader has been on
// screen for `INITIAL_TEXT_HOLD_MS` (default 3s) so fast navigations never
// see them. After that, we cycle every `CYCLE_MS` through a shuffled order
// so consecutive long loads don't show the same line twice in a row.
const FUNNY_MESSAGES = [
  'סופרים אגורות',
  'מחפשים איפה הכסף הסתתר',
  'מאווררים את כרטיס האשראי',
  'מתפללים שלא יהיה עוד קנס חניה',
  'סופרים כמה קפה הזמנת השבוע',
  'מבקשים מהמשכורת להחזיק עוד קצת',
  'מתווכחים עם דמי הניהול',
  'בוכים בשקט על חשבון החשמל',
  'מנסים להבין לאן הלכו ה-200 ₪',
  'מחביאים את התנועות מבן/בת הזוג',
] as const;

const INITIAL_TEXT_HOLD_MS = 3000;
const CYCLE_MS = 3500;

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function AppLoader({
  intervalMs = 1200,
  text,
  className,
  inline = false,
}: {
  /** Icon swap interval. Default 1200ms (preview round 3 winner). */
  intervalMs?: number;
  /** Override the loader text. Omit to use the default + funny-message cycle.
   *  Pass an empty string to hide the text entirely. */
  text?: string;
  /** Extra classes on the outer wrapper. */
  className?: string;
  /** Compact mode: drop the min-h-[70vh] so the loader sits inside its parent
   *  container at natural size. Use for chart/list lazy-loading placeholders
   *  (e.g. the donut chart's fallback) instead of a gray pulsing rectangle. */
  inline?: boolean;
}) {
  const sequence = useMemo(() => shuffle(ICON_POOL), []);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % sequence.length), intervalMs);
    return () => clearInterval(id);
  }, [sequence.length, intervalMs]);
  const Icon = sequence[idx]!;

  // Funny-message cycling. Only kicks in when the caller didn't pass an
  // explicit `text` prop. Holds the default for INITIAL_TEXT_HOLD_MS so fast
  // navigations never see jokes, then cycles every CYCLE_MS through a
  // pre-shuffled order. Caller-provided text is shown verbatim.
  const messageSequence = useMemo(() => shuffle(FUNNY_MESSAGES), []);
  const [msgIdx, setMsgIdx] = useState(-1); // -1 = still showing the default
  useEffect(() => {
    if (text !== undefined) return; // explicit override wins; no cycling
    const startCycle = setTimeout(() => {
      setMsgIdx(0);
    }, INITIAL_TEXT_HOLD_MS);
    return () => clearTimeout(startCycle);
  }, [text]);
  useEffect(() => {
    if (text !== undefined) return;
    if (msgIdx < 0) return;
    const id = setInterval(() => {
      setMsgIdx((i) => (i + 1) % messageSequence.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [text, msgIdx, messageSequence.length]);

  const displayText =
    text !== undefined ? text
    : msgIdx < 0       ? 'עובדים על זה'
    :                    messageSequence[msgIdx]!;

  // Derived periods — scale together with intervalMs so any speed feels right.
  const popMs  = Math.round(intervalMs * 0.7);
  const ringMs = Math.round(intervalMs * 1.6);
  const dotsMs = Math.round(intervalMs * 1.6);

  // Outer wrapper takes the full content area so the loader sits dead-centre
  // on the screen regardless of the page that triggered it. min-h-[70vh]
  // leaves headroom for the nav + tab strip while still feeling "centered."
  // In `inline` mode we drop the min-height so the loader fits inside its
  // parent (e.g. inside a 220px-tall donut placeholder).
  return (
    <div
      className={
        'flex w-full flex-col items-center justify-center gap-6 ' +
        (inline ? 'h-full py-4' : 'min-h-[70vh]') +
        (className ? ' ' + className : '')
      }
      dir="rtl"
    >
      <div className="relative size-32">
        {/* Three staggered concentric rings. Stagger uses fractions of the
            ring period so the relationship looks the same at any speed. */}
        <span
          className="absolute inset-0 rounded-full bg-primary/10 app-loader-ping"
          style={{ animationDuration: `${ringMs}ms` }}
        />
        <span
          className="absolute inset-3 rounded-full bg-primary/15 app-loader-ping"
          style={{
            animationDuration: `${ringMs}ms`,
            animationDelay:    `${Math.round(ringMs / 5)}ms`,
          }}
        />
        <span
          className="absolute inset-6 rounded-full bg-primary/20 app-loader-ping"
          style={{
            animationDuration: `${ringMs}ms`,
            animationDelay:    `${Math.round((ringMs * 2) / 5)}ms`,
          }}
        />
        {/* Icon. key={idx} forces remount on swap → triggers fade+scale pop. */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon
            key={idx}
            className="size-14 text-primary app-loader-pop"
            strokeWidth={1.75}
            style={{ animationDuration: `${popMs}ms` }}
          />
        </div>
      </div>

      {displayText !== '' && (
        // key={displayText} forces remount on each text swap so the fade
        // animation re-runs — the line gracefully fades in instead of
        // snapping. font-medium + text-foreground (instead of muted gray)
        // keeps the line readable on the translucent navigation overlay
        // without looking heavy on solid loading.tsx backgrounds.
        <p className="min-h-[1.25rem] text-center text-sm font-medium text-foreground/90">
          <span key={displayText} className="app-loader-text-fade inline-block">
            {displayText}
          </span>
          <span
            className="app-loader-dots ms-0.5 inline-block tabular-nums"
            aria-hidden
            style={{ animationDuration: `${dotsMs}ms` }}
          >...</span>
        </p>
      )}

      <style>{`
        @keyframes app-loader-pop {
          from { opacity: 0; transform: scale(0.85); }
          50%  { opacity: 1; transform: scale(1.08); }
          to   { opacity: 1; transform: scale(1); }
        }
        .app-loader-pop { animation: app-loader-pop var(--dur, 840ms) cubic-bezier(0.34, 1.56, 0.64, 1) both; }

        @keyframes app-loader-ping {
          0%   { transform: scale(1); opacity: 1; }
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        .app-loader-ping { animation: app-loader-ping var(--dur, 1.6s) cubic-bezier(0, 0, 0.2, 1) infinite; }

        @keyframes app-loader-dots {
          0%, 20%   { opacity: 0; }
          40%, 60%  { opacity: 0.5; }
          80%, 100% { opacity: 1; }
        }
        .app-loader-dots { animation: app-loader-dots var(--dur, 1.6s) ease-in-out infinite; }

        @keyframes app-loader-text-fade {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .app-loader-text-fade { animation: app-loader-text-fade 350ms ease-out both; }
      `}</style>
    </div>
  );
}
