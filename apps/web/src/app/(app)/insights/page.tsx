/**
 * /insights — diagnostic surface (Phase A foundation).
 *
 * Sections (vertical, RTL):
 *   1. Data-quality strip (always-on banner)
 *   2. Page header + time-window selector
 *   3. Risk insights (top 3 only — informally enforced by quiet thresholds)
 *   4. Trends (chart-based with BI drill-stack)
 *   5. Patterns
 *   6. Data Integrity (the new 5-card section addressing failure mode #1)
 *
 * Phase B will add: drill-out routes to /transactions, the back-pill UX.
 * Phase F will add: drag/drop layout customization.
 * Phases D-G add chatbot context, pinning, narrative, exports, publish.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Sparkles, AlertTriangle, LineChart, Boxes, ShieldCheck, Briefcase } from 'lucide-react';
import { he } from '@fba/shared';

import { TimeWindowSelector } from '@/components/insights/time-window-selector';
import { DataQualityStrip } from '@/components/insights/data-quality-strip';
import { InsightSection } from '@/components/insights/insight-section';
import { NarrativeSummary } from '@/components/insights/narrative-summary';
import { HeroKpiStrip } from '@/components/insights/hero-kpi-strip';

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

  // Phase 8 cards always operate on the CURRENT active billing month — they
  // intentionally don't follow the time-window selector because they're
  // about a SPECIFIC cycle (or calendar month) snapshot, not a window.
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
    getUnusualTransactions(householdId, window),
    getRecurringDrift(householdId, window),
    getPhantomSubscriptions(householdId, window),
    getExpiringSubscriptions(householdId),
    getLapsedRecurring(householdId),
    getCategoryTrend(householdId, []),
    getCategoryMomSpike(householdId),
    getFixedVsVariable(householdId),
    getIncomeVsExpenses(householdId),
    getNetCashFlow(householdId),
    getRefundsAndCredits(householdId, window),
    getForeignCurrencyExposure(householdId, window),
    getProjectBurnRate(householdId),
    getUntaggedTransactions(householdId, window),
    getLowConfidenceCategorizations(householdId, window),
    getSuspiciousInstallments(householdId),
    getMisTaggedTransferCandidates(householdId),
    getBadRecurringPatterns(householdId),
    getCcSettlementMismatches(householdId),
    getCategoryByChargeDate(householdId, activeMonth),
    getCategoryByTxnDate(householdId, calMonth),
    getDataQualitySummary(householdId, window),
    getDashboardKpis(householdId, window),
  ]);

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

      {/* ─── Hero KPI strip — top-of-page summary tiles ────────────── */}
      <HeroKpiStrip kpis={kpis} />

      {/* ─── Storytelling / narrative summary (deterministic Phase A) ── */}
      <NarrativeSummary
        windowLabel={wLabel}
        outliers={outliers}
        drifts={drifts}
        phantoms={phantoms}
        lapsed={lapsed}
        momSpikes={momSpikes}
        income={incomeVsExp}
        untagged={untagged}
      />

      {/* ─── Risk insights ──────────────────────────────────────────── */}
      <InsightSection
        title="דחוף"
        caption="התראות שדורשות תשומת לב"
        icon={AlertTriangle}
        tone="destructive"
      >
        <CardUnusualTransaction windowLabel={wLabel} findings={outliers} />
        <CardRecurringDrift windowLabel={wLabel} findings={drifts} />
        <CardRecurringLapsed windowLabel={wLabel} findings={lapsed} />
      </InsightSection>

      {/* ─── Trends ─────────────────────────────────────────────────── */}
      <InsightSection
        title="מגמות"
        caption="לאן הכסף נע לאורך זמן"
        icon={LineChart}
        tone="accent"
      >
        <CardIncomeVsExpenses windowLabel={wLabel} buckets={incomeVsExp} />
        <CardNetCashFlow windowLabel={wLabel} buckets={netCashFlow} />
        <CardCategoryTrend windowLabel={wLabel} initial={catTrendRoot} />
        <CardCategoryMomSpike windowLabel={wLabel} findings={momSpikes} />
        <CardFixedVsVariable windowLabel={wLabel} buckets={fixedVar} />
        <CardCategoryByDate basis="charge" subtitle={`מחזור ${activeMonth}`} buckets={catByCharge} monthYM={activeMonth} />
        <CardCategoryByDate basis="txn" subtitle={`קלנדרי ${calMonth}`} buckets={catByTxn} monthYM={calMonth} />
      </InsightSection>

      {/* ─── Patterns ───────────────────────────────────────────────── */}
      <InsightSection
        title="דפוסים"
        caption="התנהגויות קבועות שכדאי להכיר"
        icon={Boxes}
        tone="primary"
      >
        <CardPhantomSubscription windowLabel={wLabel} findings={phantoms} />
        <CardExpiringSubscriptions windowLabel={wLabel} findings={expiringSubs} />
        <CardRefundsAndCredits windowLabel={wLabel} rows={refunds.rows} totalIls={refunds.totalIls} />
        <CardForeignCurrency windowLabel={wLabel} buckets={foreignCurrency} />
      </InsightSection>

      {/* ─── Tracking (project + future P1 cards land here) ─────────── */}
      <InsightSection
        title="מעקב"
        caption="פרויקטים ותוכניות שדורשות מעקב מתמשך"
        icon={Briefcase}
        tone="success"
      >
        <CardProjectBurnRate windowLabel={wLabel} findings={projectBurn} />
      </InsightSection>

      {/* ─── Data Integrity (anchor target for the data-quality strip) ── */}
      <section id="data-integrity" className="scroll-mt-20">
        <InsightSection
          title="אמינות הנתונים"
          caption="עזרה למצוא בעיות בנתונים שלך"
          icon={ShieldCheck}
          tone="warning"
        >
          <CardUntaggedTransactions windowLabel={wLabel} finding={untagged} />
          <CardLowConfidenceCategorizations windowLabel={wLabel} finding={lowConf} />
          <CardSuspiciousInstallments windowLabel={wLabel} findings={suspIns} />
          <CardMisTaggedTransfers windowLabel={wLabel} pairs={transferPairs} />
          <CardBadRecurringPatterns windowLabel={wLabel} findings={badPatterns} />
          <CardCcSettlementMismatch windowLabel={wLabel} findings={ccMismatches} />
        </InsightSection>
      </section>

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
            catByCharge.length +
            catByTxn.length
          ).toLocaleString('he-IL')}{' '}
          ממצאים נמצאו
        </p>
      </footer>
    </div>
  );
}
