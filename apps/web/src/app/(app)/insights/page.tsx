/**
 * /insights — diagnostic surface (Phase A foundation).
 *
 * Sections (vertical, RTL):
 *   1. Data-quality strip (always-on banner)
 *   2. Page header + time-window selector
 *   3. Section tabs (filter: all | urgent | trends | patterns | tracking | integrity)
 *   4. (when tab=all) Hero KPI + narrative summary
 *   5. Risk insights ("דחוף")
 *   6. Trends ("מגמות")
 *   7. Patterns ("דפוסים")
 *   8. Tracking ("מעקב")
 *   9. Data Integrity ("אמינות הנתונים")
 *
 * Layout features:
 *   • SectionTabs (top) — URL-driven, filters to a single section.
 *   • SectionRail (right, lg+) — sticky nav, jump-to anchors when tab=all.
 *   • InsightSection (collapsible) — per-section toggle, localStorage-persisted.
 *
 * Phase B will add: drill-out routes to /transactions, the back-pill UX.
 * Phase F will add: drag/drop layout customization.
 * Phases D-G add chatbot context, pinning, narrative, exports, publish.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Sparkles, Briefcase } from 'lucide-react';
import { he } from '@fba/shared';

import { TimeWindowSelector } from '@/components/insights/time-window-selector';
import { DataQualityStrip } from '@/components/insights/data-quality-strip';
import { InsightSection } from '@/components/insights/insight-section';
import { NarrativeSummary } from '@/components/insights/narrative-summary';
import { HeroKpiStrip } from '@/components/insights/hero-kpi-strip';
import { SectionTabs } from '@/components/insights/section-tabs';
import { SectionRail } from '@/components/insights/section-rail';
import { SECTIONS, SECTION_ALL, readActiveSection, type SectionId } from './sections';

import { CardUnusualTransaction } from '@/components/insights/cards/card-unusual-transaction';
import { CardRecurringDrift } from '@/components/insights/cards/card-recurring-drift';
import { CardRecurringLapsed } from '@/components/insights/cards/card-recurring-lapsed';
import { CardPhantomSubscription } from '@/components/insights/cards/card-phantom-subscription';
import { CardCategoryTrend } from '@/components/insights/cards/card-category-trend';
import { CardCategoryMomSpike } from '@/components/insights/cards/card-category-mom-spike';
import { CardFixedVsVariable } from '@/components/insights/cards/card-fixed-vs-variable';
import { CardIncomeVsExpenses } from '@/components/insights/cards/card-income-vs-expenses';
import { CardNetCashFlow } from '@/components/insights/cards/card-net-cash-flow';
import { CardRefundsAndCredits } from '@/components/insights/cards/card-refunds-and-credits';
import { CardForeignCurrency } from '@/components/insights/cards/card-foreign-currency';
import { CardProjectBurnRate } from '@/components/insights/cards/card-project-burn-rate';
import { CardUntaggedTransactions } from '@/components/insights/cards/card-untagged-transactions';
import { CardLowConfidenceCategorizations } from '@/components/insights/cards/card-low-confidence-categorizations';
import { CardSuspiciousInstallments } from '@/components/insights/cards/card-suspicious-installments';
import { CardMisTaggedTransfers } from '@/components/insights/cards/card-mis-tagged-transfers';
import { CardBadRecurringPatterns } from '@/components/insights/cards/card-bad-recurring-patterns';
import { CardCcSettlementMismatch } from '@/components/insights/cards/card-cc-settlement-mismatch';
import { CardCategoryByDate } from '@/components/insights/cards/card-category-by-date';
import { CardExpiringSubscriptions } from '@/components/insights/cards/card-expiring-subscriptions';

import { readWindow, windowLabelHe } from './window';
import {
  getUnusualTransactions,
  getRecurringDrift,
  getPhantomSubscriptions,
  getExpiringSubscriptions,
  getLapsedRecurring,
  getCategoryTrend,
  getCategoryMomSpike,
  getFixedVsVariable,
  getIncomeVsExpenses,
  getNetCashFlow,
  getRefundsAndCredits,
  getForeignCurrencyExposure,
  getProjectBurnRate,
  getUntaggedTransactions,
  getLowConfidenceCategorizations,
  getSuspiciousInstallments,
  getMisTaggedTransferCandidates,
  getBadRecurringPatterns,
  getCcSettlementMismatches,
  getCategoryByChargeDate,
  getCategoryByTxnDate,
  getDataQualitySummary,
  getDashboardKpis,
} from './queries';
import { activeBillingMonth } from '@fba/db';

export const dynamic = 'force-dynamic';

export default async function InsightsPage(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { householdId } = session.user;

  const sp = await props.searchParams;
  const window = readWindow(sp);
  const wLabel = windowLabelHe(window);

  // SINGLE SOURCE OF TRUTH for "which month is now" on this page.
  //
  // We resolve the anchor ONCE here and hand the same value to every query
  // that anchors on "now" (trailing trend windows, lapsed-by-today logic,
  // category-by-X snapshots, etc.). Queries are forbidden from calling
  // currentBillingMonth() / activeBillingMonth() internally — see the
  // contract note at the top of queries.ts. This prevents the silent drift
  // where one card was reading currentBillingMonth (calendar) and another
  // was reading activeBillingMonth (cutoff-aware) and they disagreed.
  const activeMonth = activeBillingMonth(10);
  // Calendar month for the txn-date view = same YYYY-MM as the current
  // billing month (close enough; later we can decouple if needed).
  const calMonth = activeMonth;

  // Parallel fetch: every aggregation runs concurrently. The data-quality
  // summary internally re-runs the integrity queries so we don't double-fetch
  // (Promise.all dedupes once the queries return — fine for Phase A; Phase E
  // will add an unstable_cache layer per (household, window).
  const [
    outliers,
    drifts,
    phantoms,
    expiringSubs,
    lapsed,
    catTrendRoot,
    momSpikes,
    fixedVar,
    incomeVsExp,
    netCashFlow,
    refunds,
    foreignCurrency,
    projectBurn,
    untagged,
    lowConf,
    suspIns,
    transferPairs,
    badPatterns,
    ccMismatches,
    catByCharge,
    catByTxn,
    dataQuality,
    kpis,
  ] = await Promise.all([
    getUnusualTransactions(householdId, window, activeMonth),
    getRecurringDrift(householdId, window),
    getPhantomSubscriptions(householdId, window),
    getExpiringSubscriptions(householdId),
    getLapsedRecurring(householdId, activeMonth),
    getCategoryTrend(householdId, [], activeMonth),
    getCategoryMomSpike(householdId, activeMonth),
    getFixedVsVariable(householdId, activeMonth),
    getIncomeVsExpenses(householdId, activeMonth),
    getNetCashFlow(householdId, activeMonth),
    getRefundsAndCredits(householdId, window),
    getForeignCurrencyExposure(householdId, window),
    getProjectBurnRate(householdId, activeMonth),
    getUntaggedTransactions(householdId, window),
    getLowConfidenceCategorizations(householdId, window),
    getSuspiciousInstallments(householdId, activeMonth),
    getMisTaggedTransferCandidates(householdId),
    getBadRecurringPatterns(householdId),
    getCcSettlementMismatches(householdId),
    getCategoryByChargeDate(householdId, activeMonth),
    getCategoryByTxnDate(householdId, calMonth),
    getDataQualitySummary(householdId, window, activeMonth),
    getDashboardKpis(householdId, window),
  ]);

  // ── Active section (from ?section= URL param) ────────────────────
  const activeSection = readActiveSection(sp.section);
  const showAll = activeSection === SECTION_ALL;
  // When a single section is active, sections shouldn't collapse — there's
  // nothing else on screen, hiding the only content would be confusing.
  const forceOpen = !showAll;
  const isVisible = (id: SectionId) => showAll || activeSection === id;

  // Counts per section — used to badge tab pills, rail pills, and section
  // headers consistently.
  //
  // RULE: "count" = number of **actionable findings**, not data points.
  // Reference charts (income-vs-expenses, net-cash-flow buckets, fixed-vs-
  // variable, category-by-date breakdowns, foreign-currency exposure) are
  // EXCLUDED — their card always renders something and counting their data
  // rows inflated the trends badge to 30+ even when nothing required atten-
  // tion. The user reads the badge as "how much should I worry?", and that
  // only makes sense for findings, not chart bins.
  //
  // Data-integrity binary cards (untagged, lowConfidence) collapse to 0/1.
  const counts: Record<SectionId, number> = {
    urgent: outliers.length + drifts.length + lapsed.length,
    trends: momSpikes.length, // line-chart / breakdown cards aren't "findings"
    patterns: phantoms.length + expiringSubs.length + refunds.rows.length,
    tracking: projectBurn.length,
    integrity:
      (untagged.count > 0 ? 1 : 0) +
      (lowConf.count > 0 ? 1 : 0) +
      suspIns.length +
      transferPairs.length +
      badPatterns.length +
      ccMismatches.length,
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* ─── Data-quality strip (always-on banner) ──────────────────── */}
      <DataQualityStrip summary={dataQuality} />

      {/* ─── Page header + window selector ──────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="size-5 text-accent" aria-hidden />
            {he.nav.insights}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {wLabel} · ניתוח חכם של דפוסי ההוצאות שלך
          </p>
          {/* Make the strict project exclusion visible — no guessing whether
              the numbers include construction/vacation/etc. They don't. */}
          <p className="mt-1 inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Briefcase className="size-3" aria-hidden />
            הוצאות שוטפות בלבד · פרויקטים מוצגים בנפרד ב
            <Link href="/projects" className="text-accent hover:underline">
              /projects
            </Link>
          </p>
        </div>
        <TimeWindowSelector />
      </header>

      {/* ─── Section tabs (top filter) ──────────────────────────────── */}
      <SectionTabs counts={counts} />

      {/* ─── Two-column layout: rail (lg+) + main content ───────────── */}
      <div className="flex flex-row-reverse items-start gap-6">
        {/* Right-side rail — only when showing all sections (no point on
            single-section view). Hidden under lg via the component. */}
        {showAll && <SectionRail counts={counts} />}

        <main className="min-w-0 flex-1 space-y-6">
          {/* Hero KPI + narrative — only shown in the "all" overview. On
              a single-section view they'd just push the actual cards down. */}
          {showAll && (
            <>
              <HeroKpiStrip kpis={kpis} />
              <NarrativeSummary
                windowLabel={wLabel}
                activeMonth={activeMonth}
                outliers={outliers}
                drifts={drifts}
                phantoms={phantoms}
                lapsed={lapsed}
                momSpikes={momSpikes}
                income={incomeVsExp}
                untagged={untagged}
              />
            </>
          )}

          {/* Render sections in the order defined by SECTIONS, but only the
              visible ones. Each section's defaultOpen comes from the
              centralized smart defaults in sections.ts. */}
          {SECTIONS.map((s) => {
            if (!isVisible(s.id)) return null;
            // Note: icon is NOT passed as a prop. InsightSection looks it up
            // from the central SECTIONS registry by id. Lucide icons are
            // forwardRef functions and can't cross the SC→CC boundary.
            const sectionDefaults = {
              id: s.id,
              title: s.title,
              caption: s.caption,
              tone: s.tone,
              defaultOpen: s.defaultOpen,
              count: counts[s.id],
              forceOpen,
            } as const;

            if (s.id === 'urgent') {
              return (
                <InsightSection key={s.id} {...sectionDefaults}>
                  <CardUnusualTransaction windowLabel={wLabel} findings={outliers} />
                  <CardRecurringDrift windowLabel={wLabel} findings={drifts} />
                  <CardRecurringLapsed windowLabel={wLabel} findings={lapsed} />
                </InsightSection>
              );
            }
            if (s.id === 'trends') {
              return (
                <InsightSection key={s.id} {...sectionDefaults}>
                  <CardIncomeVsExpenses windowLabel={wLabel} buckets={incomeVsExp} />
                  <CardNetCashFlow windowLabel={wLabel} buckets={netCashFlow} />
                  <CardCategoryTrend windowLabel={wLabel} initial={catTrendRoot} />
                  <CardCategoryMomSpike windowLabel={wLabel} findings={momSpikes} />
                  <CardFixedVsVariable windowLabel={wLabel} buckets={fixedVar} />
                  <CardCategoryByDate basis="charge" result={catByCharge} />
                  <CardCategoryByDate basis="txn" result={catByTxn} />
                </InsightSection>
              );
            }
            if (s.id === 'patterns') {
              return (
                <InsightSection key={s.id} {...sectionDefaults}>
                  <CardPhantomSubscription windowLabel={wLabel} findings={phantoms} />
                  <CardExpiringSubscriptions windowLabel={wLabel} findings={expiringSubs} />
                  <CardRefundsAndCredits windowLabel={wLabel} rows={refunds.rows} totalIls={refunds.totalIls} />
                  <CardForeignCurrency windowLabel={wLabel} buckets={foreignCurrency} />
                </InsightSection>
              );
            }
            if (s.id === 'tracking') {
              return (
                <InsightSection key={s.id} {...sectionDefaults}>
                  <CardProjectBurnRate windowLabel={wLabel} findings={projectBurn} />
                </InsightSection>
              );
            }
            // 'integrity' — preserve the legacy #data-integrity anchor for
            // the data-quality strip's "השלם בדיקה" link.
            return (
              <div key={s.id} id="data-integrity" className="scroll-mt-20">
                <InsightSection {...sectionDefaults}>
                  <CardUntaggedTransactions windowLabel={wLabel} finding={untagged} />
                  <CardLowConfidenceCategorizations windowLabel={wLabel} finding={lowConf} />
                  <CardSuspiciousInstallments windowLabel={wLabel} findings={suspIns} />
                  <CardMisTaggedTransfers windowLabel={wLabel} pairs={transferPairs} />
                  <CardBadRecurringPatterns windowLabel={wLabel} findings={badPatterns} />
                  <CardCcSettlementMismatch windowLabel={wLabel} findings={ccMismatches} />
                </InsightSection>
              </div>
            );
          })}

          {/* ─── Phase A footer ─────────────────────────────────────────── */}
          <footer className="border-t pt-4 text-2xs text-muted-foreground">
            <p>
              תובנות (פאזה A) ·{' '}
              {(
                outliers.length +
                drifts.length +
                phantoms.length +
                lapsed.length +
                momSpikes.length +
                incomeVsExp.length +
                netCashFlow.length +
                refunds.rows.length +
                foreignCurrency.length +
                projectBurn.length +
                (untagged.count > 0 ? 1 : 0) +
                (lowConf.count > 0 ? 1 : 0) +
                suspIns.length +
                transferPairs.length +
                badPatterns.length +
                ccMismatches.length +
                catByCharge.buckets.length +
                catByTxn.buckets.length
              ).toLocaleString('he-IL')}{' '}
              ממצאים נמצאו
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
