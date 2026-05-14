/**
 * Storytelling card at the top of /insights.
 *
 * Phase A version is DETERMINISTIC — it picks the most-noteworthy bullets
 * from the same query results the cards already loaded, formats them as
 * 2-4 plain Hebrew lines, and renders them in a calm Sparkles-branded card.
 *
 * Phase E will REPLACE the body of `composeStory()` with a streaming LLM
 * call that uses the existing chatbot tool layer to compose richer narrative.
 * The card shell (icon, title, "powered by AI" microcopy, layout) stays the
 * same so the upgrade is invisible to the user.
 */

import { Sparkles } from 'lucide-react';
import { formatIls } from '@fba/shared';
import { InfoModalButton } from '@/components/ui/info-modal-button';
import type {
  OutlierFinding,
  RecurringDriftFinding,
  PhantomSubFinding,
  LapsedFinding,
  MomSpikeFinding,
  IncomeVsExpenseBucket,
  UntaggedFinding,
} from '@/app/(app)/insights/queries';

interface Props {
  windowLabel: string;
  /** The active billing month the page is showing (e.g. '2026-06'). The
   *  narrative tries to narrate THIS cycle. If it has no data yet (cycle
   *  just opened), it falls back to the most recent bucket with data and
   *  labels its bullets/subtitle with that month explicitly, so the user
   *  doesn't read "החודש את במאזן חיובי" for a month they're not looking at. */
  activeMonth: string;
  outliers: OutlierFinding[];
  drifts: RecurringDriftFinding[];
  phantoms: PhantomSubFinding[];
  lapsed: LapsedFinding[];
  momSpikes: MomSpikeFinding[];
  income: IncomeVsExpenseBucket[];
  untagged: UntaggedFinding;
}

const INFO = `מה זה: סיפור קצר בנוגע לחודש שלך — הדגשים שכדאי שתראי לפני שמתחילים לחפור בכרטיסים.

איך זה נבחר: בפאזה הנוכחית (A) הסיפור נבנה ממסקנות הכרטיסים האחרים — בוחרים את 2–4 הממצאים הבולטים ביותר ומחברים אותם למשפטים. אין כאן ייצור טקסט מלאכותי או "המצאות".

בעתיד (פאזה E): המודל (Claude Sonnet) יחבר טקסט עשיר יותר תוך שימוש באותם נתונים בלבד. עד אז — המקור והדיוק מובטחים מלאים.`;

export function NarrativeSummary(props: Props) {
  const { lines, narratedMonth, isFallback } = composeStory(props);

  // The subtitle shows the month being NARRATED (not necessarily the page's
  // active window). When we fell back to a prior cycle (because the active
  // cycle is empty), add a small hint so the reader doesn't mistake the
  // bullet's numbers for the active window's numbers.
  const subtitle = narratedMonth
    ? isFallback
      ? `החודש האחרון עם נתונים: ${narratedMonth}`
      : `חודש ${narratedMonth}`
    : props.windowLabel;

  return (
    <article
      className="relative overflow-hidden rounded-xl border border-accent/25 bg-gradient-to-bl from-accent-soft/50 via-card to-card p-5 shadow-sm transition-shadow hover:shadow-md"
      dir="rtl"
    >
      {/* Subtle decorative ring in the corner — adds visual depth like
          the reference dashboards without dominating */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -end-12 size-40 rounded-full bg-accent/8 blur-2xl"
      />
      <div className="relative flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-sm">
          <Sparkles className="size-5" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">סיכום החודש שלך</h2>
            <InfoModalButton title="סיכום החודש שלך" body={INFO} />
            <span className="ms-auto text-2xs text-muted-foreground tabular-nums">{subtitle}</span>
          </div>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            {lines.map((line, i) => (
              <li key={i} className="flex items-baseline gap-2.5">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span className="flex-1">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

interface ComposedStory {
  lines: string[];
  /** YYYY-MM of the bucket whose data appears in the bullets, if any. Used
   *  by the card to label the subtitle so the user knows which month the
   *  narrative is actually about. */
  narratedMonth: string | null;
  /** True when the narrated month is NOT the page's active window — i.e. we
   *  fell back to the most recent cycle with data. Drives a clarifying hint
   *  ("החודש האחרון עם נתונים: ...") instead of plain "חודש ...". */
  isFallback: boolean;
}

/**
 * Pure function: pick 2-4 noteworthy bullets, sorted by ROUGH severity.
 * Every fact comes from a query result — never invented.
 *
 * Month-resolution rule (added after the user noticed the narrative was
 * citing last month's numbers under the current month's header):
 *   1. Prefer the bucket matching the page's active billing month.
 *   2. If that's empty (cycle just opened, no data yet), fall back to the
 *      most recent non-empty bucket — but flag isFallback=true so the card
 *      can label the subtitle clearly.
 *   3. Every bullet that references a month uses the explicit YYYY-MM
 *      instead of "החודש" — that word lies when fallback fires.
 */
function composeStory({
  outliers,
  drifts,
  phantoms,
  lapsed,
  momSpikes,
  income,
  untagged,
  activeMonth,
}: Props): ComposedStory {
  const lines: string[] = [];

  // (1) Net cash flow — pick the bucket to narrate.
  const hasData = (b: IncomeVsExpenseBucket) => b.incomeIls > 0 || b.expensesIls > 0;
  const activeBucket = income.find((b) => b.month === activeMonth) ?? null;
  const fallbackBucket =
    activeBucket && hasData(activeBucket)
      ? null
      : [...income].reverse().find(hasData) ?? null;
  const narrated = activeBucket && hasData(activeBucket) ? activeBucket : fallbackBucket;
  const isFallback = !!fallbackBucket && narrated === fallbackBucket;
  const narratedMonth = narrated?.month ?? null;

  if (narrated) {
    const monthLabel = narrated.month;
    if (narrated.netIls >= 0) {
      lines.push(
        `${isFallback ? `בחודש ${monthLabel}` : 'החודש'} את במאזן חיובי של ${formatIls(narrated.netIls, { decimals: false })} — הכנסות (${formatIls(narrated.incomeIls, { decimals: false })}) גבוהות מההוצאות.`,
      );
    } else {
      lines.push(
        `${isFallback ? `בחודש ${monthLabel}` : 'החודש'} המאזן שלילי ב-${formatIls(Math.abs(narrated.netIls), { decimals: false })} — את מוציאה יותר ממה שנכנס.`,
      );
    }
  }

  // (2) Biggest MoM spike (if any)
  const topSpike = momSpikes[0];
  if (topSpike) {
    lines.push(
      `הקטגוריה "${topSpike.category}" קפצה ב-${topSpike.pctOver.toFixed(0)}% מעל החציון של החודשים האחרונים — שווה לבדוק.`,
    );
  }

  // (3) Recurring drift (price increases stand out more than decreases)
  const topDrift = [...drifts]
    .filter((d) => d.diffPct > 0)
    .sort((a, b) => b.diffPct - a.diffPct)[0];
  if (topDrift) {
    lines.push(
      `הוצאה קבועה של "${topDrift.description ?? topDrift.merchant}" עלתה ב-${topDrift.diffPct.toFixed(0)}% — מ-${formatIls(topDrift.expectedIls, { decimals: false })} ל-${formatIls(topDrift.latestActualIls, { decimals: false })}.`,
    );
  }

  // (4) Phantom subscriptions — only if there's a clear cluster
  const phantomTotal = phantoms.reduce((s, p) => s + p.monthlyIls, 0);
  if (phantoms.length >= 2 && phantomTotal >= 100) {
    lines.push(
      `מצאנו ${phantoms.length} מנויים אצל בתי עסק שלא נראתה אצלם פעילות לא-קבועה ב-90 יום — סכום של ${formatIls(phantomTotal, { decimals: false })} בחודש.`,
    );
  }

  // (5) Outlier (only the most extreme)
  const topOutlier = outliers[0];
  if (topOutlier) {
    lines.push(
      `תנועה חריגה: ${formatIls(Math.abs(topOutlier.amountIls), { decimals: false })} ב-"${topOutlier.merchant}" (${topOutlier.zScore > 0 ? '+' : ''}${topOutlier.zScore.toFixed(1)} סטיות תקן מהממוצע).`,
    );
  }

  // (6) Recurring lapsed
  if (lapsed.length > 0) {
    lines.push(
      `${lapsed.length} חיובים קבועים שהיו אמורים להופיע השבוע — לא הופיעו עדיין.`,
    );
  }

  // (7) Data quality gentle nudge — only if we DON'T have enough other content
  if (lines.length < 3 && untagged.count >= 3) {
    lines.push(
      `יש ${untagged.count} תנועות לא מקוטלגות בטווח — לטיפול בהן ייתנו תמונה מדויקת יותר.`,
    );
  }

  // Fallback: clean month, nothing notable
  if (lines.length === 0) {
    lines.push('החודש שקט — אין תנועות חריגות, מנויים פנטום, או קפיצות בקטגוריות. כל הכבוד.');
  }

  // Cap at 4 lines so the card stays readable
  return { lines: lines.slice(0, 4), narratedMonth, isFallback };
}
