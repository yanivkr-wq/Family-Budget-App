/**
 * Aggregation queries for the 13 P0 insight cards on /insights.
 *
 * Each function takes the household + the active InsightWindow and returns a
 * shape the corresponding card knows how to render. Drill-stack-aware queries
 * additionally take a `drillPath: string[]` — empty = root, [categoryId] =
 * level 1, [categoryId, subId] = level 2, etc.
 *
 * Conventions:
 *   • Always exclude soft-deleted txns (deletedAt IS NULL).
 *   • Always exclude isProjected=true (future installment placeholders).
 *   • Always exclude project-tagged txns via excludeAllProjectTxns() —
 *     STRICT exclusion: any row with a project_id is hidden from
 *     spending-math cards on /insights, regardless of per-project flags.
 *     The /projects page is the dedicated surface for project numbers.
 *   • For SPENDING insights: exclude isTransfer=true. For DATA INTEGRITY
 *     insights: include everything (transfers may be the bug we're hunting).
 *   • Aggregations always scope by householdId — never trust callers.
 */

import { and, desc, eq, gte, ilike, isNull, lte, sql, inArray, ne, isNotNull } from 'drizzle-orm';
/**
 * SINGLE-SOURCE-OF-TRUTH CONTRACT (added 2026-05-13 after a real bug):
 *
 * Every monthly aggregation in this file accepts the "current month" anchor
 * as a parameter — typically `anchorMonth: string` (YYYY-MM). The page
 * (insights/page.tsx) resolves the anchor ONCE via activeBillingMonth(10)
 * and hands the same value to every query. This guarantees every card on
 * the page agrees on which billing cycle is "now".
 *
 * Do NOT reintroduce `currentBillingMonth()` or `activeBillingMonth()` calls
 * inside this file — there's an ESLint guard against it (.eslintrc) and a
 * reason: those helpers diverge (calendar-month vs cutoff-aware billing-
 * cycle), and historically cards picked whichever was at hand, causing the
 * narrative and the KPI strip to silently reference different months.
 */
import { getDb, schema, addMonths, isSettlementLineExpr } from '@fba/db';
import type { InsightWindow } from './types';

/**
 * STRICT project exclusion for /insights spending-math queries.
 *
 * Different from the shared `excludeHiddenProjectTxns()` helper used by the
 * main dashboard. That helper respects per-project / per-row override flags
 * (e.g. a "lamp purchase" on a construction project can be flagged to count
 * toward monthly totals). On /insights we want a HARD cutoff — any
 * transaction tagged to ANY project is hidden from spending-math cards.
 *
 * Rationale: /insights is the diagnostic view of ongoing / regular finances.
 * Project spending is multi-month and lumpy — it would distort trends,
 * anomaly z-scores, and ratios. The /projects page is the dedicated surface
 * for project numbers; the Project Burn-Rate card on /insights is the only
 * exception (and it intentionally pulls project data).
 */
function excludeAllProjectTxns() {
  return isNull(schema.transactions.projectId);
}

// ─── Window → SQL fragment ────────────────────────────────────────────────────

/**
 * Build the date / billing-month constraint for a given window.
 * MTD uses billing_month equality; everything else uses transaction_date range.
 *
 * Throws on a malformed window rather than silently falling back. A silent
 * fallback to "today's calendar month" was the kind of drift this file's
 * single-source-of-truth contract is meant to prevent — a misconfigured
 * caller should fail loudly so we notice, not paper over the bug with the
 * wrong month.
 */
function windowFragment(w: InsightWindow) {
  if (w.kind === 'mtd' && w.billingMonth) {
    return eq(schema.transactions.billingMonth, w.billingMonth);
  }
  if (w.dateFrom && w.dateTo) {
    return and(
      gte(schema.transactions.transactionDate, w.dateFrom),
      lte(schema.transactions.transactionDate, w.dateTo),
    );
  }
  throw new Error(`insights/windowFragment: malformed InsightWindow ${JSON.stringify(w)} — caller must use readWindow() to construct a well-formed window`);
}

/** Standard "good rows for spending math" constraints. */
function spendingBaseConditions(householdId: string, w: InsightWindow) {
  return [
    eq(schema.transactions.householdId, householdId),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, false),
    eq(schema.transactions.isTransfer, false),
    eq(schema.transactions.excludedFromTotals, false),
    excludeAllProjectTxns(),
    windowFragment(w),
  ];
}

// ─── 1. Unusual transaction (z-score outlier) ────────────────────────────────

export interface OutlierFinding {
  id: string;
  date: string;
  merchant: string;
  amountIls: number;
  merchantMean: number;
  merchantStdev: number;
  zScore: number;
}

/**
 * For each transaction in window, compute the merchant's mean+stdev across the
 * trailing 6 months (excluding the row itself). Flag rows where |z| ≥ 2.5.
 *
 * Pure SQL would need window functions; we keep it simple by fetching candidate
 * rows and computing in JS — bounded to top 200 transactions × per-merchant
 * trailing stats query in a single aggregation.
 */
export async function getUnusualTransactions(
  householdId: string,
  w: InsightWindow,
  anchorMonth: string,
): Promise<OutlierFinding[]> {
  const db = getDb();
  const Z_THRESHOLD = 2.5;
  const HISTORY_MONTHS = 6;

  // Fetch the in-window candidate rows
  const candidates = await db
    .select({
      id: schema.transactions.id,
      date: schema.transactions.transactionDate,
      merchant: schema.transactions.merchantNormalized,
      amount: schema.transactions.amountIls,
    })
    .from(schema.transactions)
    .where(and(...spendingBaseConditions(householdId, w)))
    .orderBy(desc(schema.transactions.transactionDate))
    .limit(500);

  if (candidates.length === 0) return [];

  // Pull trailing 6-month stats per distinct merchant in candidates.
  // anchorMonth = "this page's current month" — passed in by the caller so
  // every card on /insights agrees on which month is "now". See the
  // single-source-of-truth contract in this file's header.
  const merchants = Array.from(new Set(candidates.map((c) => c.merchant)));
  const baselineFrom = addMonths(anchorMonth, -HISTORY_MONTHS);

  const stats = await db
    .select({
      merchant: schema.transactions.merchantNormalized,
      mean: sql<string>`avg(abs(${schema.transactions.amountIls}))`,
      stdev: sql<string>`coalesce(stddev_pop(abs(${schema.transactions.amountIls})), 0)`,
      n: sql<string>`count(*)`,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        eq(schema.transactions.excludedFromTotals, false),
        excludeAllProjectTxns(),
        gte(schema.transactions.billingMonth, baselineFrom),
        inArray(schema.transactions.merchantNormalized, merchants),
      ),
    )
    .groupBy(schema.transactions.merchantNormalized);

  const statMap = new Map(stats.map((s) => [s.merchant, { mean: Number(s.mean), stdev: Number(s.stdev), n: Number(s.n) }]));

  const findings: OutlierFinding[] = [];
  for (const c of candidates) {
    const stat = statMap.get(c.merchant);
    // Need at least 3 priors for a meaningful z-score; protects against single-shot merchants
    if (!stat || stat.n < 3 || stat.stdev === 0) continue;
    const amt = Math.abs(Number(c.amount));
    const z = (amt - stat.mean) / stat.stdev;
    if (Math.abs(z) >= Z_THRESHOLD) {
      findings.push({
        id: c.id,
        date: c.date,
        merchant: c.merchant,
        amountIls: Number(c.amount),
        merchantMean: stat.mean,
        merchantStdev: stat.stdev,
        zScore: z,
      });
    }
  }

  // Sort by |z| descending — biggest surprises first
  findings.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  return findings.slice(0, 10);
}

// ─── 2. Recurring drift ──────────────────────────────────────────────────────

export interface RecurringDriftFinding {
  patternId: string;
  merchant: string;
  description: string | null;
  expectedIls: number;
  latestActualIls: number;
  diffPct: number;
  toleranceLimit: number;
  latestDate: string;
}

/**
 * Active recurring patterns whose latest charge differs from `expectedAmountIls`
 * by more than (tolerancePct + 10pp buffer). The buffer prevents borderline
 * drifts from spamming the page — only meaningful jumps surface.
 */
export async function getRecurringDrift(householdId: string, _w: InsightWindow): Promise<RecurringDriftFinding[]> {
  const db = getDb();
  const BUFFER_PP = 10;

  const patterns = await db
    .select()
    .from(schema.recurringPatterns)
    .where(
      and(
        eq(schema.recurringPatterns.householdId, householdId),
        eq(schema.recurringPatterns.status, 'active'),
        ne(schema.recurringPatterns.amountMode, 'dynamic'),
      ),
    );

  if (patterns.length === 0) return [];

  const findings: RecurringDriftFinding[] = [];

  for (const p of patterns) {
    const expectedSigned = Number(p.expectedAmountIls);
    if (expectedSigned === 0) continue;
    // The recurring_pattern table stores expected_amount_ils SIGNED — negative
    // for expense patterns, positive for income. We only want to compare a
    // pattern against transactions of the SAME sign — otherwise an isolated
    // refund (positive) against an expense pattern (negative) gets compared
    // as +abs vs -expected and the diffPct comes out as ~-200% on every single
    // pattern. (That's the bug we're fixing here: previously this loop flagged
    // 100% of active expense patterns as "drifting" by ~200%.)
    const expectedSign = expectedSigned > 0 ? 1 : -1;

    // Latest charge of the SAME SIGN to this merchant. We deliberately
    // DO NOT filter excluded_from_totals here: most recurring expenses are
    // CC-paid, so the per-charge row is a CC detail (excluded_from_totals=
    // true — the settlement line carries the totals) and it's that detail
    // row that has the per-charge amount we need to compare against the
    // pattern's expected. Filtering it out would drop every CC-based
    // pattern from this card. We DO add the other spending-math guards
    // (transfer, project exclusion) that were missing originally.
    const [latest] = await db
      .select({
        amount: schema.transactions.amountIls,
        date: schema.transactions.transactionDate,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.merchantNormalized, p.merchantNormalized),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
          eq(schema.transactions.isTransfer, false),
          excludeAllProjectTxns(),
          expectedSign > 0
            ? sql`${schema.transactions.amountIls} > 0`
            : sql`${schema.transactions.amountIls} < 0`,
        ),
      )
      .orderBy(desc(schema.transactions.transactionDate))
      .limit(1);

    if (!latest) continue;
    // Drift is the change in MAGNITUDE of the recurring amount, so compare
    // absolute values. (Signed math here would be valid too, but abs is
    // clearer and matches how the card surfaces the number.)
    const expected = Math.abs(expectedSigned);
    const actual = Math.abs(Number(latest.amount));
    const diffPct = ((actual - expected) / expected) * 100;
    const limit = p.tolerancePct + BUFFER_PP;
    if (Math.abs(diffPct) >= limit) {
      findings.push({
        patternId: p.id,
        merchant: p.merchantNormalized,
        description: p.description,
        expectedIls: expected,
        latestActualIls: actual,
        diffPct,
        toleranceLimit: limit,
        latestDate: latest.date,
      });
    }
  }

  findings.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  return findings;
}

// ─── 3. Phantom subscription ────────────────────────────────────────────────

export interface PhantomSubFinding {
  patternId: string;
  merchant: string;
  description: string | null;
  monthlyIls: number;
  daysSinceLastNonRecurringActivity: number | null;
}

/**
 * Active recurring patterns where the merchant has had NO non-recurring
 * activity in 90+ days. Approximation of "I have a subscription but I haven't
 * actually used the service."
 */
export async function getPhantomSubscriptions(householdId: string, _w: InsightWindow): Promise<PhantomSubFinding[]> {
  const db = getDb();
  const QUIET_DAYS = 90;

  const patterns = await db
    .select()
    .from(schema.recurringPatterns)
    .where(
      and(
        eq(schema.recurringPatterns.householdId, householdId),
        eq(schema.recurringPatterns.status, 'active'),
        eq(schema.recurringPatterns.frequency, 'monthly'),
      ),
    );

  if (patterns.length === 0) return [];

  const findings: PhantomSubFinding[] = [];
  for (const p of patterns) {
    // Latest non-recurring transaction to this merchant
    const [last] = await db
      .select({ date: schema.transactions.transactionDate })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.merchantNormalized, p.merchantNormalized),
          eq(schema.transactions.isRecurring, false),
          isNull(schema.transactions.deletedAt),
        ),
      )
      .orderBy(desc(schema.transactions.transactionDate))
      .limit(1);

    const days = last
      ? Math.floor((Date.now() - new Date(last.date).getTime()) / 86_400_000)
      : null;

    // No non-recurring activity ever, OR last one was 90+ days ago → phantom
    if (last == null || (days !== null && days >= QUIET_DAYS)) {
      findings.push({
        patternId: p.id,
        merchant: p.merchantNormalized,
        description: p.description,
        monthlyIls: Number(p.expectedAmountIls),
        daysSinceLastNonRecurringActivity: days,
      });
    }
  }

  findings.sort((a, b) => b.monthlyIls - a.monthlyIls);
  return findings.slice(0, 8);
}

// ─── 3.5. Expiring subscriptions ────────────────────────────────────────────

export interface ExpiringSubscriptionFinding {
  patternId:        string;
  merchant:         string;
  description:      string | null;
  /** Signed monthly amount (negative = expense). */
  monthlyIls:       number;
  /** YYYY-MM-DD when the current period ends. */
  endDate:          string;
  /** Days from today until end_date. Negative = already past. */
  daysUntilEnd:     number;
  /** Days from today until cancel deadline (end_date - cancelNoticeDays). */
  daysUntilCancel:  number;
  autoRenew:        boolean;
  cancelNoticeDays: number;
}

/**
 * Recurring patterns whose CURRENT subscription period ends within the next
 * `WINDOW_DAYS`, OR whose cancellation deadline (end_date − notice) is within
 * that window. Surfaces what the user needs to act on RIGHT NOW — either:
 *   • Decide to keep it → renew (push end_date by one frequency cycle).
 *   • Decide to cancel  → end (status='ended', auto_renew=false).
 *
 * Patterns without an end_date are excluded — they're open-ended and have no
 * actionable expiration moment. The /insights card teaches the user to add
 * end dates by going to /recurring → edit.
 */
export async function getExpiringSubscriptions(
  householdId: string,
): Promise<ExpiringSubscriptionFinding[]> {
  const db = getDb();
  const WINDOW_DAYS = 30;

  // Fetch patterns with an end_date set. The partial index on
  // (household_id, subscription_end_date) WHERE end_date IS NOT NULL keeps
  // this cheap even with a lot of open-ended patterns.
  const rows = await db
    .select({
      id:                  schema.recurringPatterns.id,
      merchant:            schema.recurringPatterns.merchantNormalized,
      description:         schema.recurringPatterns.description,
      expectedAmountIls:   schema.recurringPatterns.expectedAmountIls,
      endDate:             schema.recurringPatterns.subscriptionEndDate,
      autoRenew:           schema.recurringPatterns.autoRenew,
      cancelNoticeDays:    schema.recurringPatterns.cancelNoticeDays,
      status:              schema.recurringPatterns.status,
    })
    .from(schema.recurringPatterns)
    .where(
      and(
        eq(schema.recurringPatterns.householdId, householdId),
        isNotNull(schema.recurringPatterns.subscriptionEndDate),
        // Only "live" patterns — a pattern the user already marked 'ended'
        // doesn't need surfacing. 'paused' still does (might be temporarily
        // suspended but the user still needs to act before end_date).
        ne(schema.recurringPatterns.status, 'ended'),
      ),
    );

  if (rows.length === 0) return [];

  const todayMs = new Date().setUTCHours(0, 0, 0, 0);
  const dayMs = 86_400_000;

  const findings: ExpiringSubscriptionFinding[] = [];
  for (const r of rows) {
    if (!r.endDate) continue;
    // Date arithmetic: parse ISO date as UTC midnight to avoid TZ drift.
    // Tuple-destructure with explicit types so TS narrows away `undefined`
    // (string.split returns string[], not [string, string, string]).
    const parts = r.endDate.split('-');
    if (parts.length !== 3) continue;
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) continue;
    const endMs = Date.UTC(y, m - 1, d);
    const daysUntilEnd = Math.round((endMs - todayMs) / dayMs);
    const daysUntilCancel = daysUntilEnd - r.cancelNoticeDays;

    // Surface if either deadline (end OR cancel) lands within the window —
    // including slightly-overdue ones (-7 .. 0) so the user sees them instead
    // of silently missing the moment.
    const inWindow =
      (daysUntilEnd >= -7 && daysUntilEnd <= WINDOW_DAYS) ||
      (daysUntilCancel >= -7 && daysUntilCancel <= WINDOW_DAYS);
    if (!inWindow) continue;

    findings.push({
      patternId:        r.id,
      merchant:         r.merchant,
      description:      r.description,
      monthlyIls:       Number(r.expectedAmountIls),
      endDate:          r.endDate,
      daysUntilEnd,
      daysUntilCancel,
      autoRenew:        r.autoRenew,
      cancelNoticeDays: r.cancelNoticeDays,
    });
  }

  // Sort by urgency: closest cancel deadline first, then closest end date.
  findings.sort((a, b) => {
    const ax = Math.min(a.daysUntilCancel, a.daysUntilEnd);
    const bx = Math.min(b.daysUntilCancel, b.daysUntilEnd);
    return ax - bx;
  });

  return findings.slice(0, 8);
}

// ─── 4. Recurring lapsed ────────────────────────────────────────────────────

export interface LapsedFinding {
  patternId: string;
  merchant: string;
  description: string | null;
  expectedIls: number;
  expectedByDate: string;
  daysOverdue: number;
}

/**
 * Active monthly patterns whose expected charge for the current cycle has not
 * fired. "Expected by" = the median day-of-month from the pattern's last 6
 * charges (proxy for its usual cadence).
 */
export async function getLapsedRecurring(
  householdId: string,
  anchorMonth: string,
): Promise<LapsedFinding[]> {
  const db = getDb();
  const cur = anchorMonth;
  const today = new Date();
  const todayDay = today.getDate();

  const patterns = await db
    .select()
    .from(schema.recurringPatterns)
    .where(
      and(
        eq(schema.recurringPatterns.householdId, householdId),
        eq(schema.recurringPatterns.status, 'active'),
        eq(schema.recurringPatterns.frequency, 'monthly'),
      ),
    );

  if (patterns.length === 0) return [];

  const findings: LapsedFinding[] = [];
  for (const p of patterns) {
    // Did this pattern fire in the current billing month?
    const [hit] = await db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.merchantNormalized, p.merchantNormalized),
          eq(schema.transactions.billingMonth, cur),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
        ),
      )
      .limit(1);

    if (hit) continue;

    // Find median day-of-month from last 6 charges
    const recent = await db
      .select({ date: schema.transactions.transactionDate })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.merchantNormalized, p.merchantNormalized),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
        ),
      )
      .orderBy(desc(schema.transactions.transactionDate))
      .limit(6);

    if (recent.length === 0) continue;

    const days = recent.map((r) => Number(r.date.split('-')[2])).sort((a, b) => a - b);
    const expectedDay = days[Math.floor(days.length / 2)] ?? 15;

    // Only flag if today is past the expected day
    if (todayDay <= expectedDay) continue;

    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const expectedByDate = `${yyyy}-${mm}-${String(expectedDay).padStart(2, '0')}`;

    findings.push({
      patternId: p.id,
      merchant: p.merchantNormalized,
      description: p.description,
      expectedIls: Number(p.expectedAmountIls),
      expectedByDate,
      daysOverdue: todayDay - expectedDay,
    });
  }

  findings.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return findings;
}

// ─── 5. Category trend (drill-stack: top → sub → merchant) ───────────────────

export interface CategoryTrendBucket {
  /** Category / sub-category / merchant identifier (depending on level) */
  id: string;
  label: string;
  color: string | null;
  /** Per-month totals, oldest → newest. Length = N months. */
  monthly: Array<{ month: string; total: number }>;
  /** Total across all months in window. */
  total: number;
  /** Direction: 'up' | 'down' | 'flat' based on first vs last month */
  direction: 'up' | 'down' | 'flat';
  /** Pct change first → last (null if first==0). */
  changePct: number | null;
}

/**
 * Drill-stack semantics:
 *   depth 0          → top-level categories
 *   depth 1 [catId]  → sub-categories within that category
 *                       FALL-THROUGH: if no transactions in this category have
 *                       a sub_category_id, we silently group by merchant
 *                       instead so the drill produces something useful.
 *   depth 2 [catId, subId-or-'__merchants__'] → merchants
 *
 * The fall-through prevents the broken UX where a user drills into a category
 * with no sub-tagged rows and sees an empty card.
 */
export async function getCategoryTrend(
  householdId: string,
  drillPath: string[],
  anchorMonth: string,
): Promise<{ buckets: CategoryTrendBucket[]; months: string[]; effectiveLevel: 'category' | 'sub' | 'merchant' }> {
  const db = getDb();
  const N_MONTHS = 4;
  const cur = anchorMonth;
  const months: string[] = [];
  for (let i = N_MONTHS - 1; i >= 0; i--) months.push(addMonths(cur, -i));
  const earliest = months[0]!;

  const baseConditions = [
    eq(schema.transactions.householdId, householdId),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, false),
    eq(schema.transactions.isTransfer, false),
    eq(schema.transactions.excludedFromTotals, false),
    excludeAllProjectTxns(),
    gte(schema.transactions.billingMonth, earliest),
    lte(schema.transactions.billingMonth, cur),
  ];

  // Cache categories table lookup once — used for labels at multiple levels
  const cats = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.nameHe,
      color: schema.categories.color,
      parentId: schema.categories.parentId,
    })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId));
  const catMap = new Map(cats.map((c) => [c.id, c]));

  let groupKeyCol: any;
  let labelFor: (id: string) => { label: string; color: string | null };
  let effectiveLevel: 'category' | 'sub' | 'merchant';

  if (drillPath.length === 0) {
    groupKeyCol = schema.transactions.categoryId;
    labelFor = (id: string) => {
      const c = catMap.get(id);
      return { label: c?.name ?? 'ללא קטגוריה', color: c?.color ?? null };
    };
    effectiveLevel = 'category';
  } else if (drillPath.length === 1) {
    const categoryId = drillPath[0]!;
    baseConditions.push(eq(schema.transactions.categoryId, categoryId));
    groupKeyCol = schema.transactions.subCategoryId;
    labelFor = (id: string) => {
      const c = catMap.get(id);
      return { label: c?.name ?? 'ללא תת-קטגוריה', color: c?.color ?? null };
    };
    effectiveLevel = 'sub';
  } else {
    // Depth 2: merchant. The path[1] may be either a real subCategoryId or
    // the sentinel '__merchants__' meaning "user drilled past an empty
    // sub-cat level"; either way we filter by category and (optionally) sub.
    const categoryId = drillPath[0]!;
    const subId = drillPath[1]!;
    baseConditions.push(eq(schema.transactions.categoryId, categoryId));
    if (subId !== '__merchants__') {
      baseConditions.push(eq(schema.transactions.subCategoryId, subId));
    }
    groupKeyCol = schema.transactions.merchantNormalized;
    labelFor = (id: string) => ({ label: id, color: null });
    effectiveLevel = 'merchant';
  }

  const fetchBuckets = async (): Promise<CategoryTrendBucket[]> => {
    // Sign-aware total: only count NEGATIVE amounts as spending. Positive
    // amounts in non-income categories are refunds/credits/transfers and
    // shouldn't inflate category trend bars.
    const rows = await db
      .select({
        key: groupKeyCol,
        month: schema.transactions.billingMonth,
        total: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} < 0 then abs(${schema.transactions.amountIls}) else 0 end), 0)`,
      })
      .from(schema.transactions)
      .where(and(...baseConditions))
      .groupBy(groupKeyCol, schema.transactions.billingMonth);

    const pivot = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (r.key == null) continue;
      if (!pivot.has(r.key)) pivot.set(r.key, new Map());
      pivot.get(r.key)!.set(r.month, Number(r.total));
    }

    const out: CategoryTrendBucket[] = [];
    for (const [key, monthMap] of pivot.entries()) {
      const monthly = months.map((m) => ({ month: m, total: monthMap.get(m) ?? 0 }));
      const total = monthly.reduce((s, b) => s + b.total, 0);
      if (total === 0) continue;
      const first = monthly[0]!.total;
      const last = monthly[monthly.length - 1]!.total;
      const changePct = first === 0 ? null : ((last - first) / first) * 100;
      const direction: 'up' | 'down' | 'flat' =
        changePct == null || Math.abs(changePct) < 5 ? 'flat' : changePct > 0 ? 'up' : 'down';
      const meta = labelFor(key);
      out.push({ id: key, label: meta.label, color: meta.color, monthly, total, direction, changePct });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  };

  let buckets = await fetchBuckets();

  // FALL-THROUGH: if user drilled to sub-category level and got nothing
  // (because no transactions in this category have a sub_category_id), skip
  // straight to merchant level so the drill is never a dead-end.
  if (buckets.length === 0 && effectiveLevel === 'sub') {
    groupKeyCol = schema.transactions.merchantNormalized;
    labelFor = (id: string) => ({ label: id, color: null });
    effectiveLevel = 'merchant';
    buckets = await fetchBuckets();
  }

  return { buckets, months, effectiveLevel };
}

// ─── 6. Category MoM spike ──────────────────────────────────────────────────

export interface MomSpikeFinding {
  categoryId: string;
  category: string;
  color: string | null;
  thisMonthIls: number;
  trailingMedianIls: number;
  pctOver: number;
}

/**
 * Current billing month per top-level category vs trailing 3-month median.
 * Flag categories where this month is ≥30% over the trailing median (and the
 * absolute difference is ≥ ₪200, to suppress noise on tiny categories).
 */
export async function getCategoryMomSpike(
  householdId: string,
  anchorMonth: string,
): Promise<MomSpikeFinding[]> {
  const db = getDb();
  const SPIKE_PCT = 30;
  const MIN_DELTA = 200;
  const TRAILING_MONTHS = 3;
  const cur = anchorMonth;
  const months = [cur];
  for (let i = 1; i <= TRAILING_MONTHS; i++) months.push(addMonths(cur, -i));

  // Sign-aware: only count NEGATIVE amounts as spending. Positive flows are
  // refunds / unmarked transfers; surfaced elsewhere.
  const rows = await db
    .select({
      categoryId: schema.transactions.categoryId,
      month: schema.transactions.billingMonth,
      total: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} < 0 then abs(${schema.transactions.amountIls}) else 0 end), 0)`,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        eq(schema.transactions.excludedFromTotals, false),
        excludeAllProjectTxns(),
        inArray(schema.transactions.billingMonth, months),
      ),
    )
    .groupBy(schema.transactions.categoryId, schema.transactions.billingMonth);

  const cats = await db
    .select({ id: schema.categories.id, name: schema.categories.nameHe, color: schema.categories.color, isIncome: schema.categories.isIncome })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId));
  const catMap = new Map(cats.map((c) => [c.id, c]));

  const pivot = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.categoryId) continue;
    if (!pivot.has(r.categoryId)) pivot.set(r.categoryId, new Map());
    pivot.get(r.categoryId)!.set(r.month, Number(r.total));
  }

  const findings: MomSpikeFinding[] = [];
  for (const [categoryId, monthMap] of pivot.entries()) {
    const cat = catMap.get(categoryId);
    if (!cat || cat.isIncome) continue;
    const thisMonth = monthMap.get(cur) ?? 0;
    const priors = months.slice(1).map((m) => monthMap.get(m) ?? 0).sort((a, b) => a - b);
    if (priors.length < TRAILING_MONTHS) continue;
    const median = priors[Math.floor(priors.length / 2)] ?? 0;
    if (median === 0) continue;
    const pctOver = ((thisMonth - median) / median) * 100;
    if (pctOver >= SPIKE_PCT && (thisMonth - median) >= MIN_DELTA) {
      findings.push({
        categoryId,
        category: cat.name,
        color: cat.color,
        thisMonthIls: thisMonth,
        trailingMedianIls: median,
        pctOver,
      });
    }
  }

  findings.sort((a, b) => b.pctOver - a.pctOver);
  return findings;
}

// ─── 7. Fixed vs variable cost ratio trend ──────────────────────────────────

export interface FixedVsVariableMonthlyBucket {
  month: string;
  fixedIls: number;
  variableIls: number;
  fixedPct: number;
}

/**
 * Last 6 monthly buckets. "Fixed" = transactions where isRecurring=true OR
 * isInstallment=true. "Variable" = everything else (still spending, no transfers).
 */
export async function getFixedVsVariable(
  householdId: string,
  anchorMonth: string,
): Promise<FixedVsVariableMonthlyBucket[]> {
  const db = getDb();
  const N = 6;
  const cur = anchorMonth;
  const months: string[] = [];
  for (let i = N - 1; i >= 0; i--) months.push(addMonths(cur, -i));
  const earliest = months[0]!;

  // Sign-aware: only count NEGATIVE spending. Positive flows in non-income
  // categories are refunds / transfers — they don't belong in this ratio.
  const rows = await db
    .select({
      month: schema.transactions.billingMonth,
      isFixed: sql<string>`(${schema.transactions.isRecurring} OR ${schema.transactions.isInstallment})`,
      total: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} < 0 then abs(${schema.transactions.amountIls}) else 0 end), 0)`,
    })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        eq(schema.transactions.excludedFromTotals, false),
        excludeAllProjectTxns(),
        gte(schema.transactions.billingMonth, earliest),
        lte(schema.transactions.billingMonth, cur),
        // Only spending — drop income rows from this ratio
        eq(schema.categories.isIncome, false),
      ),
    )
    .groupBy(schema.transactions.billingMonth, sql`(${schema.transactions.isRecurring} OR ${schema.transactions.isInstallment})`);

  const map = new Map<string, { fixed: number; variable: number }>();
  for (const m of months) map.set(m, { fixed: 0, variable: 0 });
  for (const r of rows) {
    const slot = map.get(r.month);
    if (!slot) continue;
    const amt = Number(r.total);
    if (amt === 0) continue;
    // Postgres returns boolean as 't'/'f' string in this kind of expression
    const v = r.isFixed as unknown;
    const isFixed = v === 'true' || v === 't' || v === true;
    if (isFixed) slot.fixed += amt;
    else slot.variable += amt;
  }

  return months.map((m) => {
    const s = map.get(m)!;
    const total = s.fixed + s.variable;
    return {
      month: m,
      fixedIls: s.fixed,
      variableIls: s.variable,
      fixedPct: total === 0 ? 0 : (s.fixed / total) * 100,
    };
  });
}

// ─── Income vs Expenses (last N months) ────────────────────────────────────

export interface IncomeVsExpenseBucket {
  month: string;
  incomeIls: number;     // positive
  expensesIls: number;   // positive (we abs() the spending so the chart is clean)
  netIls: number;        // income - expenses (signed)
}

/**
 * Last 6 monthly buckets, income vs expenses.
 *
 * Sign-aware math (same rule as getDashboardKpis):
 *   • Expenses = sum(|amount|) WHERE amount < 0
 *   • Income   = sum(amount)   WHERE amount > 0 AND category.is_income = TRUE
 *   • Positive amounts in non-income categories are IGNORED — they're refunds
 *     or unmarked transfers, surfaced separately by the dedicated cards.
 *
 * ⚠ STRUCTURAL "totals = bank rows only" RULE (added 2026-05-13):
 * The user's principle is that income/expense TOTALS come from bank-account
 * rows (settlement lines + bank-direct charges) — never from CC detail rows.
 * Previously we relied on every CC detail being flagged
 * `excluded_from_totals=true` at import time, but forex imports sometimes
 * skipped that flag, causing CC details to double-count on top of the
 * settlement line that already bundles them (e.g. 9 forex CC rows leaked
 * ₪2,861 into the 2026-04 expenses total). The fix enforces the rule
 * structurally with `accounts.type = 'bank'` — no per-row flag required.
 *
 * Category / behavior cards (CategoryByDate, ForeignCurrency, etc.) are
 * unaffected — they correctly pull CC detail rows because their purpose
 * is to surface per-purchase data, not bank-side totals.
 */
export async function getIncomeVsExpenses(
  householdId: string,
  anchorMonth: string,
): Promise<IncomeVsExpenseBucket[]> {
  const db = getDb();
  const N = 6;
  const cur = anchorMonth;
  const months: string[] = [];
  for (let i = N - 1; i >= 0; i--) months.push(addMonths(cur, -i));
  const earliest = months[0]!;

  const rows = await db
    .select({
      month: schema.transactions.billingMonth,
      expenses: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} < 0 then abs(${schema.transactions.amountIls}) else 0 end), 0)`,
      income: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} > 0 and ${schema.categories.isIncome} = true then ${schema.transactions.amountIls} else 0 end), 0)`,
    })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        // Bank-only structural filter — see ⚠ block above. The legacy
        // excluded_from_totals filter is kept as a belt-and-suspenders
        // guard (bank rows that import flagged excluded for some reason
        // should still respect that flag).
        eq(schema.accounts.type, 'bank'),
        eq(schema.transactions.excludedFromTotals, false),
        excludeAllProjectTxns(),
        gte(schema.transactions.billingMonth, earliest),
        lte(schema.transactions.billingMonth, cur),
      ),
    )
    .groupBy(schema.transactions.billingMonth);

  const map = new Map<string, { income: number; expenses: number }>();
  for (const m of months) map.set(m, { income: 0, expenses: 0 });
  for (const r of rows) {
    const slot = map.get(r.month);
    if (!slot) continue;
    slot.income += Number(r.income);
    slot.expenses += Number(r.expenses);
  }

  return months.map((m) => {
    const s = map.get(m)!;
    return {
      month: m,
      incomeIls: s.income,
      expensesIls: s.expenses,
      netIls: s.income - s.expenses,
    };
  });
}

// ─── 8a. Untagged transactions ──────────────────────────────────────────────

export interface UntaggedFinding {
  count: number;
  totalAbsIls: number;
  topMerchants: Array<{ merchant: string; count: number; totalAbsIls: number }>;
}

export async function getUntaggedTransactions(householdId: string, w: InsightWindow): Promise<UntaggedFinding> {
  const db = getDb();

  const baseConditions = [
    eq(schema.transactions.householdId, householdId),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, false),
    isNull(schema.transactions.categoryId),
    excludeAllProjectTxns(),
    windowFragment(w),
  ];

  const [totals] = await db
    .select({
      count: sql<string>`count(*)`,
      totalAbs: sql<string>`coalesce(sum(abs(${schema.transactions.amountIls})), 0)`,
    })
    .from(schema.transactions)
    .where(and(...baseConditions));

  const byMerchant = await db
    .select({
      merchant: schema.transactions.merchantNormalized,
      count: sql<string>`count(*)`,
      totalAbs: sql<string>`coalesce(sum(abs(${schema.transactions.amountIls})), 0)`,
    })
    .from(schema.transactions)
    .where(and(...baseConditions))
    .groupBy(schema.transactions.merchantNormalized)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  return {
    count: Number(totals?.count ?? 0),
    totalAbsIls: Number(totals?.totalAbs ?? 0),
    topMerchants: byMerchant.map((r) => ({
      merchant: r.merchant,
      count: Number(r.count),
      totalAbsIls: Number(r.totalAbs),
    })),
  };
}

// ─── 8b. Low-confidence categorizations ─────────────────────────────────────

export interface LowConfidenceFinding {
  count: number;
  bySource: Record<string, number>;
  recent: Array<{ id: string; date: string; merchant: string; amountIls: number; source: string }>;
}

export async function getLowConfidenceCategorizations(householdId: string, w: InsightWindow): Promise<LowConfidenceFinding> {
  const db = getDb();

  const baseConditions = [
    eq(schema.transactions.householdId, householdId),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, false),
    inArray(schema.transactions.categorySource, ['llm']),
    isNotNull(schema.transactions.categoryId),
    excludeAllProjectTxns(),
    windowFragment(w),
  ];

  const counts = await db
    .select({
      source: schema.transactions.categorySource,
      count: sql<string>`count(*)`,
    })
    .from(schema.transactions)
    .where(and(...baseConditions))
    .groupBy(schema.transactions.categorySource);

  const recent = await db
    .select({
      id: schema.transactions.id,
      date: schema.transactions.transactionDate,
      merchant: schema.transactions.merchantNormalized,
      amount: schema.transactions.amountIls,
      source: schema.transactions.categorySource,
    })
    .from(schema.transactions)
    .where(and(...baseConditions))
    .orderBy(desc(schema.transactions.transactionDate))
    .limit(8);

  const bySource: Record<string, number> = {};
  let total = 0;
  for (const c of counts) {
    const k = c.source ?? 'unknown';
    bySource[k] = Number(c.count);
    total += Number(c.count);
  }

  return {
    count: total,
    bySource,
    recent: recent.map((r) => ({
      id: r.id,
      date: r.date,
      merchant: r.merchant,
      amountIls: Number(r.amount),
      source: r.source ?? 'unknown',
    })),
  };
}

// ─── 8c. Suspicious installments ────────────────────────────────────────────

export interface SuspiciousInstallmentFinding {
  planId: string;
  merchant: string;
  description: string | null;
  paymentAmountIls: number;
  reason: 'overflow' | 'missing_cycle' | 'amount_drift';
  detail: string;
}

export async function getSuspiciousInstallments(
  householdId: string,
  anchorMonth: string,
): Promise<SuspiciousInstallmentFinding[]> {
  const db = getDb();
  const cur = anchorMonth;

  const plans = await db
    .select()
    .from(schema.installmentPlans)
    .where(
      and(
        eq(schema.installmentPlans.householdId, householdId),
        eq(schema.installmentPlans.status, 'active'),
      ),
    );

  const findings: SuspiciousInstallmentFinding[] = [];

  for (const p of plans) {
    // Reason 1: counter overflow
    if (p.totalPayments != null && p.currentPaymentNo > p.totalPayments) {
      findings.push({
        planId: p.id,
        merchant: p.merchantNormalized,
        description: p.description,
        paymentAmountIls: Number(p.paymentAmountIls),
        reason: 'overflow',
        detail: `תשלום ${p.currentPaymentNo} מתוך ${p.totalPayments} — כבר עבר את הסוף`,
      });
      continue;
    }

    // Reason 2: missing this cycle (no charge OR projection in cur month)
    const [hit] = await db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.installmentPlanId, p.id),
          eq(schema.transactions.billingMonth, cur),
          isNull(schema.transactions.deletedAt),
        ),
      )
      .limit(1);
    if (!hit) {
      findings.push({
        planId: p.id,
        merchant: p.merchantNormalized,
        description: p.description,
        paymentAmountIls: Number(p.paymentAmountIls),
        reason: 'missing_cycle',
        detail: `אין חיוב או תחזית במאזן החודש (${cur})`,
      });
      continue;
    }

    // Reason 3: average actual deviates >5% from declared paymentAmount
    const [avgRow] = await db
      .select({
        avg: sql<string>`coalesce(avg(abs(${schema.transactions.amountIls})), 0)`,
        n: sql<string>`count(*)`,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.installmentPlanId, p.id),
          eq(schema.transactions.isProjected, false),
          isNull(schema.transactions.deletedAt),
        ),
      );
    const avg = Number(avgRow?.avg ?? 0);
    const declared = Math.abs(Number(p.paymentAmountIls));
    if (Number(avgRow?.n ?? 0) >= 2 && declared > 0) {
      const drift = Math.abs(avg - declared) / declared;
      if (drift > 0.05) {
        findings.push({
          planId: p.id,
          merchant: p.merchantNormalized,
          description: p.description,
          paymentAmountIls: declared,
          reason: 'amount_drift',
          detail: `ממוצע בפועל ₪${Math.round(avg)} שונה מהמוצהר ₪${Math.round(declared)} (${Math.round(drift * 100)}%)`,
        });
      }
    }
  }

  return findings.slice(0, 8);
}

// ─── 8d. Possible mis-tagged transfer candidates ────────────────────────────

export interface TransferCandidatePair {
  outId: string;
  inId: string;
  outAccount: string;
  inAccount: string;
  outDate: string;
  inDate: string;
  amountIls: number;
}

/**
 * Sign-flipped pairs (one positive, one negative; equal magnitude ±1%) within
 * ±2 calendar days, on different accounts, where neither side is already
 * marked as a transfer. Last 90 days.
 *
 * This is a heuristic — same as cleanup-data-anomalies.ts but limited to
 * recent unflagged candidates so the user can review and pair manually.
 */
export async function getMisTaggedTransferCandidates(householdId: string): Promise<TransferCandidatePair[]> {
  const db = getDb();
  const FLOOR = 100;       // ignore noise below this absolute amount
  const PCT_TOLERANCE = 0.01;
  const DAY_TOLERANCE = 2;

  // Pull last-90d non-transfer candidates from all accounts
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: schema.transactions.id,
      accountId: schema.transactions.accountId,
      date: schema.transactions.transactionDate,
      amount: schema.transactions.amountIls,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        eq(schema.transactions.isTransfer, false),
        eq(schema.transactions.excludedFromTotals, false),
        isNull(schema.transactions.transferPairId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        gte(schema.transactions.transactionDate, sinceStr),
      ),
    );

  if (rows.length === 0) return [];

  // Account name lookup for display
  const accs = await db
    .select({ id: schema.accounts.id, name: schema.accounts.name })
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, householdId));
  const accMap = new Map(accs.map((a) => [a.id, a.name]));

  // Bucket by signed amount sign + magnitude bucket so pairing is O(n) not O(n²)
  const positives = rows.filter((r) => Number(r.amount) > 0);
  const negatives = rows.filter((r) => Number(r.amount) < 0);

  const findings: TransferCandidatePair[] = [];
  const usedNeg = new Set<string>();
  for (const p of positives) {
    const pAmt = Number(p.amount);
    if (pAmt < FLOOR) continue;
    for (const n of negatives) {
      if (usedNeg.has(n.id)) continue;
      if (n.accountId === p.accountId) continue;
      const nAmt = Math.abs(Number(n.amount));
      if (nAmt < FLOOR) continue;
      const diffPct = Math.abs(pAmt - nAmt) / pAmt;
      if (diffPct > PCT_TOLERANCE) continue;
      const dayDiff = Math.abs((new Date(p.date).getTime() - new Date(n.date).getTime()) / 86_400_000);
      if (dayDiff > DAY_TOLERANCE) continue;
      // Match
      findings.push({
        outId: n.id,
        inId: p.id,
        outAccount: accMap.get(n.accountId) ?? 'Unknown',
        inAccount: accMap.get(p.accountId) ?? 'Unknown',
        outDate: n.date,
        inDate: p.date,
        amountIls: pAmt,
      });
      usedNeg.add(n.id);
      break;
    }
  }

  findings.sort((a, b) => b.amountIls - a.amountIls);
  return findings.slice(0, 10);
}

// ─── 8f. CC Settlement Reconciliation (invariant validation) ───────────────

export interface CcSettlementMismatch {
  ccAccountId: string;
  ccAccountName: string;
  /** Pattern used to find the bank-side settlement line. */
  pattern: string;
  billingMonth: string;
  /** Sum of NON-FOREX CC details for this card in this billing month. */
  detailsSum: number;
  detailsCount: number;
  /** Sum of bank-side rows matching the CC pattern in this billing month. */
  settlementSum: number;
  settlementCount: number;
  /** detailsSum - settlementSum. Positive = more details than settlement. */
  gap: number;
}

/**
 * For each (CC account × billing month), compare:
 *   • Sum of non-forex CC details on the CC account in that billing month
 *   • Sum of bank-side rows matching the CC's settlement_merchant_pattern
 *     in that billing month
 *
 * The invariant says these should be equal (to the agora). Mismatches surface
 * as data integrity issues so the user can re-upload the CC excel for the
 * missing slice.
 *
 * Pattern source priority:
 *   1. account.settlement_merchant_pattern (user-configured)
 *   2. fallback regex match against the account name (Diners, Cal, Max, etc.)
 *
 * Filters out clean cycles (gap = 0) to keep the card focused on real issues.
 * Configurable threshold below — anything ≥ 10₪ counts as worth surfacing.
 */
export async function getCcSettlementMismatches(householdId: string): Promise<CcSettlementMismatch[]> {
  const db = getDb();
  const TOLERANCE_ILS = 10; // gaps below this are noise (rounding, fx slip)

  // Active CC accounts
  const ccAccounts = await db
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      settlementPattern: schema.accounts.settlementMerchantPattern,
    })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.householdId, householdId),
        eq(schema.accounts.type, 'credit_card'),
        eq(schema.accounts.isActive, true),
      ),
    );

  if (ccAccounts.length === 0) return [];

  const findings: CcSettlementMismatch[] = [];

  for (const cc of ccAccounts) {
    // Resolve the merchant pattern — explicit field, then heuristic fallback.
    let pattern = cc.settlementPattern;
    if (!pattern) {
      const nameLower = cc.name.toLowerCase();
      if (nameLower.includes('דיינרס') || nameLower.includes('diners')) pattern = 'דיינרס';
      else if (nameLower.includes('כ.א.ל') || nameLower.includes('כאל') || nameLower.includes('cal')) pattern = 'כ.א.ל';
      else if (nameLower.includes('מקס') || nameLower.includes('max')) pattern = 'מקס';
      else if (nameLower.includes('ישראכרט') || nameLower.includes('isracard')) pattern = 'ישראכרט';
      else continue; // unknown CC issuer — skip; user can configure pattern manually
    }

    // Per billing month: NET sum of non-forex details on this CC account.
    //
    // CRITICAL: we use ABS(SUM(amount)), NOT SUM(ABS(amount)). The bank's
    // single settlement line for the cycle equals the NET of all CC details
    // — refunds reduce what the bank withdraws. If we sum the absolute
    // values, every refund double-counts (the refund got "subtracted" from
    // settlement but "added" to details), producing false gaps on every
    // cycle that has even one return. With the user's data this previously
    // showed e.g. ₪355 fake gap on Diners 2026-05 (single ₪177.57 refund).
    const detailRows = await db
      .select({
        billingMonth: schema.transactions.billingMonth,
        sum: sql<string>`coalesce(abs(sum(${schema.transactions.amountIls}))::numeric, 0)`,
        n: sql<string>`count(*)`,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.accountId, cc.id),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
          // Only non-forex (forex isn't bundled into the bank settlement)
          sql`(${schema.transactions.originalCurrency} IS NULL OR ${schema.transactions.originalCurrency} = 'ILS')`,
        ),
      )
      .groupBy(schema.transactions.billingMonth);

    // Per billing month: sum of bank-side settlement lines matching the pattern
    const settlementRows = await db
      .select({
        billingMonth: schema.transactions.billingMonth,
        sum: sql<string>`coalesce(sum(abs(${schema.transactions.amountIls}))::numeric, 0)`,
        n: sql<string>`count(*)`,
      })
      .from(schema.transactions)
      .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.accounts.type, 'bank'),
          ilike(schema.transactions.merchantNormalized, `%${pattern}%`),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
          sql`${schema.transactions.amountIls} < 0`,
        ),
      )
      .groupBy(schema.transactions.billingMonth);

    const detailMap = new Map(detailRows.map((r) => [r.billingMonth, { sum: Number(r.sum), n: Number(r.n) }]));
    const settleMap = new Map(settlementRows.map((r) => [r.billingMonth, { sum: Number(r.sum), n: Number(r.n) }]));

    const months = new Set([...detailMap.keys(), ...settleMap.keys()]);
    for (const m of months) {
      const d = detailMap.get(m) ?? { sum: 0, n: 0 };
      const s = settleMap.get(m) ?? { sum: 0, n: 0 };
      const gap = d.sum - s.sum;
      // Surface only meaningful gaps. Cycles where details + settlement
      // are both zero (no activity) are silently skipped.
      if (Math.abs(gap) < TOLERANCE_ILS) continue;
      findings.push({
        ccAccountId: cc.id,
        ccAccountName: cc.name,
        pattern,
        billingMonth: m,
        detailsSum: d.sum,
        detailsCount: d.n,
        settlementSum: s.sum,
        settlementCount: s.n,
        gap,
      });
    }
  }

  // Most-recent month first, biggest gap first
  findings.sort((a, b) => {
    if (a.billingMonth !== b.billingMonth) return b.billingMonth.localeCompare(a.billingMonth);
    return Math.abs(b.gap) - Math.abs(a.gap);
  });

  return findings.slice(0, 20);
}

// ─── 8e. Bad recurring patterns ─────────────────────────────────────────────

export interface BadPatternFinding {
  patternId: string;
  merchant: string;
  description: string | null;
  expectedIls: number;
  tolerancePct: number;
  recentCharges: number[]; // last 6 actuals (positive numbers, oldest → newest)
  violations: number;      // count of charges outside tolerance
}

/**
 * Active recurring patterns where ≥2 of the last 6 charges blew through the
 * pattern's tolerancePct. Likely a mis-detected pattern (the merchant is being
 * charged in different contexts, the detector grouped them).
 */
export async function getBadRecurringPatterns(householdId: string): Promise<BadPatternFinding[]> {
  const db = getDb();
  const patterns = await db
    .select()
    .from(schema.recurringPatterns)
    .where(
      and(
        eq(schema.recurringPatterns.householdId, householdId),
        eq(schema.recurringPatterns.status, 'active'),
        ne(schema.recurringPatterns.amountMode, 'dynamic'),
      ),
    );

  const findings: BadPatternFinding[] = [];

  for (const p of patterns) {
    const recent = await db
      .select({ amount: schema.transactions.amountIls })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.merchantNormalized, p.merchantNormalized),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
        ),
      )
      .orderBy(desc(schema.transactions.transactionDate))
      .limit(6);

    if (recent.length < 3) continue;

    const charges = recent.map((r) => Math.abs(Number(r.amount))).reverse();
    const expected = Number(p.expectedAmountIls);
    if (expected === 0) continue;
    const tolerance = p.tolerancePct / 100;
    const violations = charges.filter((c) => Math.abs(c - expected) / expected > tolerance).length;

    if (violations >= 2) {
      findings.push({
        patternId: p.id,
        merchant: p.merchantNormalized,
        description: p.description,
        expectedIls: expected,
        tolerancePct: p.tolerancePct,
        recentCharges: charges,
        violations,
      });
    }
  }

  findings.sort((a, b) => b.violations - a.violations);
  return findings.slice(0, 8);
}

// ─── Dashboard hero KPIs (top-of-page summary strip) ────────────────────────

export interface DashboardKpis {
  /** Sum of income transactions in the active window. */
  incomeIls: number;
  /** Sum of |expense| transactions in the active window (positive number). */
  expensesIls: number;
  /** Net = income - expenses (signed). */
  netIls: number;
  /** Savings rate = net / income, 0..1 (or null when income = 0). */
  savingsRate: number | null;
  /** Income delta vs the previous comparable window, in pct (null if no prior). */
  incomeDeltaPct: number | null;
  /** Expense delta vs the previous comparable window, in pct (null if no prior). */
  expensesDeltaPct: number | null;
  /** Number of non-deleted, non-projected, non-transfer transactions in window. */
  txnCount: number;
}

/**
 * Top-of-page hero strip: 4 numbers + 2 deltas. Computed off the active
 * InsightWindow so it always matches the rest of the page.
 *
 * Math rule (sign-aware — fixes the bug where positive transfers in non-income
 * categories were being absolute-valued into expenses):
 *   • Expenses = sum(|amount|) WHERE amount < 0 (only outflows count)
 *   • Income   = sum(amount)   WHERE amount > 0 AND category.is_income = TRUE
 *   • Positive amounts in non-income categories are IGNORED here — they're
 *     refunds, credits, or unmarked transfers, all surfaced separately by
 *     the Refunds card and the Mis-tagged Transfers card.
 *
 * ⚠ STRUCTURAL "totals = bank rows only" RULE (added 2026-05-13): Hero KPI
 * totals come exclusively from bank-account rows — settlement lines and
 * bank-direct charges. CC detail rows are EXPLICITLY excluded by
 * `accounts.type = 'bank'`, not just by the flaky `excluded_from_totals=true`
 * flag. The flag was leaking forex CC charges that double-counted on top of
 * their settlement line. See the matching rule on getIncomeVsExpenses for
 * the full rationale.
 *
 * Strict project exclusion via excludeAllProjectTxns().
 */
export async function getDashboardKpis(householdId: string, w: InsightWindow): Promise<DashboardKpis> {
  const db = getDb();

  // One round-trip — return three separate totals so we don't have to
  // post-process per-row signs in JS.
  const baseConditions = and(
    eq(schema.transactions.householdId, householdId),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, false),
    eq(schema.transactions.isTransfer, false),
    eq(schema.accounts.type, 'bank'),
    eq(schema.transactions.excludedFromTotals, false),
    excludeAllProjectTxns(),
    windowFragment(w),
  );

  const [agg] = await db
    .select({
      expenses: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} < 0 then abs(${schema.transactions.amountIls}) else 0 end), 0)`,
      income: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} > 0 and ${schema.categories.isIncome} = true then ${schema.transactions.amountIls} else 0 end), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(baseConditions);

  const income = Number(agg?.income ?? 0);
  const expenses = Number(agg?.expenses ?? 0);
  const txnCount = Number(agg?.count ?? 0);

  // Compute the previous-period window for the delta. For MTD we look at the
  // previous billing month; for date ranges we shift back by the window length.
  let prevWhere: ReturnType<typeof and>;
  if (w.kind === 'mtd' && w.billingMonth) {
    prevWhere = eq(schema.transactions.billingMonth, addMonths(w.billingMonth, -1));
  } else if (w.dateFrom && w.dateTo) {
    const from = new Date(w.dateFrom);
    const to = new Date(w.dateTo);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
    const prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - days);
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    prevWhere = and(
      gte(schema.transactions.transactionDate, fmt(prevFrom)),
      lte(schema.transactions.transactionDate, fmt(prevTo)),
    )!;
  } else {
    prevWhere = sql`false`; // shouldn't happen, but be safe
  }

  // Same sign-aware rule + same bank-only structural filter as the current-
  // period query. Otherwise the delta would compare current-period bank-only
  // numbers against previous-period "bank + leaky-CC" numbers — apples to
  // oranges, and the delta would always look smaller than reality.
  const [prevAgg] = await db
    .select({
      expenses: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} < 0 then abs(${schema.transactions.amountIls}) else 0 end), 0)`,
      income: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} > 0 and ${schema.categories.isIncome} = true then ${schema.transactions.amountIls} else 0 end), 0)`,
    })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        eq(schema.accounts.type, 'bank'),
        eq(schema.transactions.excludedFromTotals, false),
        excludeAllProjectTxns(),
        prevWhere,
      ),
    );

  const prevIncome = Number(prevAgg?.income ?? 0);
  const prevExpenses = Number(prevAgg?.expenses ?? 0);

  const incomeDeltaPct = prevIncome > 0 ? ((income - prevIncome) / prevIncome) * 100 : null;
  const expensesDeltaPct = prevExpenses > 0 ? ((expenses - prevExpenses) / prevExpenses) * 100 : null;
  const net = income - expenses;
  const savingsRate = income > 0 ? net / income : null;

  return {
    incomeIls: income,
    expensesIls: expenses,
    netIls: net,
    savingsRate,
    incomeDeltaPct,
    expensesDeltaPct,
    txnCount,
  };
}

// ─── Phase 8 — category breakdown by CHARGE date (cash-out view) ───────────

export interface CategoryByDateBucket {
  categoryId: string;
  category: string;
  color: string | null;
  totalIls: number;
  count: number;
}

/** Result envelope: when the requested month has zero categorized expenses
 *  we fall back to the most recent month that does. `resolvedMonth` tells the
 *  caller which month is actually being shown, so the UI subtitle can reflect
 *  reality instead of silently showing the empty requested month. */
export interface CategoryByDateResult {
  resolvedMonth: string;
  requestedMonth: string;
  /** True if we fell back to a different month because the requested one had
   *  no data. Useful for showing a "showing X instead of Y" hint. */
  fellBack: boolean;
  buckets: CategoryByDateBucket[];
}

/**
 * "What hit my bank this billing cycle, by category?" — uses charge_date
 * (or billing_month for accounts that don't track charge_date) so the
 * sums match what actually moved through the bank account in the cycle.
 *
 * Includes carry-over: transactions DATED in the prior calendar month but
 * BILLED to this cycle are counted. Mirrors the cycle-banner math.
 *
 * Reads categories from CC details + non-CC bank rows. Settlement lines
 * have no category (excluded from per-category math via category_id IS NULL
 * being grouped under "ללא קטגוריה").
 *
 * Strict project exclusion. Settlement-basis filter (excluded_from_totals=false).
 */
async function queryCategoryByChargeDate(
  householdId: string,
  billingMonth: string,
  catMap: Map<string, { name: string; color: string | null; isIncome: boolean }>,
): Promise<CategoryByDateBucket[]> {
  const db = getDb();
  const rows = await db
    .select({
      categoryId: schema.transactions.categoryId,
      total: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} < 0 then abs(${schema.transactions.amountIls}) else 0 end), 0)`,
      count: sql<string>`count(*) filter (where ${schema.transactions.amountIls} < 0)`,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        eq(schema.transactions.excludedFromTotals, false),
        excludeAllProjectTxns(),
        eq(schema.transactions.billingMonth, billingMonth),
      ),
    )
    .groupBy(schema.transactions.categoryId);

  const buckets: CategoryByDateBucket[] = [];
  for (const r of rows) {
    const total = Number(r.total);
    if (total === 0) continue;
    const cat = r.categoryId ? catMap.get(r.categoryId) : null;
    if (cat?.isIncome) continue; // expenses only
    buckets.push({
      categoryId: r.categoryId ?? 'null',
      category: cat?.name ?? 'ללא קטגוריה',
      color: cat?.color ?? null,
      totalIls: total,
      count: Number(r.count),
    });
  }
  buckets.sort((a, b) => b.totalIls - a.totalIls);
  return buckets;
}

export async function getCategoryByChargeDate(householdId: string, billingMonth: string): Promise<CategoryByDateResult> {
  const db = getDb();

  const catRows = await db
    .select({ id: schema.categories.id, name: schema.categories.nameHe, color: schema.categories.color, isIncome: schema.categories.isIncome })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId));
  const catMap = new Map(catRows.map((c) => [c.id, { name: c.name, color: c.color, isIncome: c.isIncome }]));

  // First try the requested month.
  let buckets = await queryCategoryByChargeDate(householdId, billingMonth, catMap);
  if (buckets.length > 0) {
    return { resolvedMonth: billingMonth, requestedMonth: billingMonth, fellBack: false, buckets };
  }

  // Fallback: pick the most recent billing_month that has any non-project,
  // non-transfer, settlement-basis expense. Empty current cycle is the common
  // case right after the cycle rollover (data not imported yet) — without this
  // fallback the card silently shows nothing and the user can't tell why.
  const latest = await db
    .select({ m: sql<string>`max(${schema.transactions.billingMonth})` })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        eq(schema.transactions.excludedFromTotals, false),
        excludeAllProjectTxns(),
        sql`${schema.transactions.amountIls} < 0`,
        sql`${schema.transactions.billingMonth} < ${billingMonth}`,
      ),
    );
  const fallbackMonth = latest[0]?.m;
  if (!fallbackMonth) {
    return { resolvedMonth: billingMonth, requestedMonth: billingMonth, fellBack: false, buckets: [] };
  }

  buckets = await queryCategoryByChargeDate(householdId, fallbackMonth, catMap);
  return { resolvedMonth: fallbackMonth, requestedMonth: billingMonth, fellBack: true, buckets };
}

// ─── Phase 8 — category breakdown by TRANSACTION date (buying behavior) ─────

/**
 * "What did I BUY this calendar month, by category?" — uses transaction_date
 * within the calendar month boundaries (1st → last day). Ignores billing
 * cycle entirely. Pure buying behavior view.
 *
 * INVERSE filter from the charge-date view (deliberately):
 *   • INCLUDES CC detail rows (excluded_from_totals=true) — they have the
 *     real transaction_date when the user actually made the purchase.
 *   • EXCLUDES bank-side settlement lines (isSettlementLineExpr matches) —
 *     those are roll-ups of CC details, counting them would double count.
 *
 * Why the inversion: the charge view answers "what hit the bank this cycle"
 * (settlement lines are the answer; CC details are duplicates). The txn
 * view answers "what did I buy this month" (CC details ARE the answer; the
 * settlement line is a billing artifact). Same data + opposite roles.
 *
 * Result: charge view of April + txn view of April will SHOW DIFFERENT
 * numbers — as the user expects.
 */
async function queryCategoryByTxnDate(
  householdId: string,
  calendarMonth: string,
  catMap: Map<string, { name: string; color: string | null; isIncome: boolean }>,
): Promise<CategoryByDateBucket[]> {
  const db = getDb();
  const monthStart = `${calendarMonth}-01`;
  const [y, m] = calendarMonth.split('-').map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  const monthEnd = `${calendarMonth}-${String(lastDay).padStart(2, '0')}`;

  const rows = await db
    .select({
      categoryId: schema.transactions.categoryId,
      total: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} < 0 then abs(${schema.transactions.amountIls}) else 0 end), 0)`,
      count: sql<string>`count(*) filter (where ${schema.transactions.amountIls} < 0)`,
    })
    .from(schema.transactions)
    .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        // KEY DIFFERENCE: don't filter on excluded_from_totals — CC details
        // ARE the truth for buying date. Instead, exclude settlement lines.
        sql`NOT (${isSettlementLineExpr()})`,
        excludeAllProjectTxns(),
        gte(schema.transactions.transactionDate, monthStart),
        lte(schema.transactions.transactionDate, monthEnd),
      ),
    )
    .groupBy(schema.transactions.categoryId);

  const buckets: CategoryByDateBucket[] = [];
  for (const r of rows) {
    const total = Number(r.total);
    if (total === 0) continue;
    const cat = r.categoryId ? catMap.get(r.categoryId) : null;
    if (cat?.isIncome) continue;
    buckets.push({
      categoryId: r.categoryId ?? 'null',
      category: cat?.name ?? 'ללא קטגוריה',
      color: cat?.color ?? null,
      totalIls: total,
      count: Number(r.count),
    });
  }
  buckets.sort((a, b) => b.totalIls - a.totalIls);
  return buckets;
}

export async function getCategoryByTxnDate(householdId: string, calendarMonth: string): Promise<CategoryByDateResult> {
  const db = getDb();

  const catRows = await db
    .select({ id: schema.categories.id, name: schema.categories.nameHe, color: schema.categories.color, isIncome: schema.categories.isIncome })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId));
  const catMap = new Map(catRows.map((c) => [c.id, { name: c.name, color: c.color, isIncome: c.isIncome }]));

  // First try the requested month.
  let buckets = await queryCategoryByTxnDate(householdId, calendarMonth, catMap);
  if (buckets.length > 0) {
    return { resolvedMonth: calendarMonth, requestedMonth: calendarMonth, fellBack: false, buckets };
  }

  // Fallback: find the most recent calendar month with any non-project,
  // non-settlement-line expense. Uses to_char to extract YYYY-MM from the
  // transaction_date column. isSettlementLineExpr() references accounts.type,
  // so we MUST left-join accounts here too.
  const monthStart = `${calendarMonth}-01`;
  const latest = await db
    .select({ m: sql<string>`max(to_char(${schema.transactions.transactionDate}, 'YYYY-MM'))` })
    .from(schema.transactions)
    .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        sql`NOT (${isSettlementLineExpr()})`,
        excludeAllProjectTxns(),
        sql`${schema.transactions.amountIls} < 0`,
        sql`${schema.transactions.transactionDate} < ${monthStart}`,
      ),
    );
  const fallbackMonth = latest[0]?.m;
  if (!fallbackMonth) {
    return { resolvedMonth: calendarMonth, requestedMonth: calendarMonth, fellBack: false, buckets: [] };
  }

  buckets = await queryCategoryByTxnDate(householdId, fallbackMonth, catMap);
  return { resolvedMonth: fallbackMonth, requestedMonth: calendarMonth, fellBack: true, buckets };
}

// ─── Net cash flow per month ────────────────────────────────────────────────

export interface NetCashFlowBucket {
  month: string;
  netIls: number; // income − expenses
}

/**
 * Last 6 monthly buckets, signed net (income − expenses). Different from
 * IncomeVsExpenses: this is just the bottom line per month for a quick scan.
 */
export async function getNetCashFlow(
  householdId: string,
  anchorMonth: string,
): Promise<NetCashFlowBucket[]> {
  const buckets = await getIncomeVsExpenses(householdId, anchorMonth);
  return buckets.map((b) => ({ month: b.month, netIls: b.netIls }));
}

// ─── Refunds & "found money" ────────────────────────────────────────────────

export interface RefundFinding {
  id: string;
  date: string;
  merchant: string;
  amountIls: number;        // positive
  category: string | null;  // the EXPENSE category it landed in
}

/**
 * Positive amounts that landed in EXPENSE categories (not income, not transfer).
 * These are returns, refunds, reimbursements, cashback, voided charges — money
 * coming back that you'd normally miss when scanning expense lists.
 */
export async function getRefundsAndCredits(
  householdId: string,
  w: InsightWindow,
): Promise<{ rows: RefundFinding[]; totalIls: number }> {
  const db = getDb();

  const rows = await db
    .select({
      id: schema.transactions.id,
      date: schema.transactions.transactionDate,
      merchant: schema.transactions.merchantNormalized,
      amount: schema.transactions.amountIls,
      categoryName: schema.categories.nameHe,
      isIncome: schema.categories.isIncome,
    })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
        eq(schema.transactions.excludedFromTotals, false),
        excludeAllProjectTxns(),
        gte(schema.transactions.amountIls, '0.01'), // positive
        windowFragment(w),
      ),
    )
    .orderBy(desc(schema.transactions.amountIls));

  // Filter out income rows in JS (so we keep null-cat positives — they may also
  // be refunds the categorizer hasn't tagged yet).
  const refunds = rows.filter((r) => !r.isIncome).slice(0, 20);

  return {
    rows: refunds.map((r) => ({
      id: r.id,
      date: r.date,
      merchant: r.merchant,
      amountIls: Number(r.amount),
      category: r.categoryName ?? null,
    })),
    totalIls: refunds.reduce((s, r) => s + Number(r.amount), 0),
  };
}

// ─── Foreign currency exposure ──────────────────────────────────────────────

export interface ForeignCurrencyBucket {
  currency: string;
  countTransactions: number;
  totalOriginal: number;
  totalIls: number;
  topMerchants: Array<{ merchant: string; totalIls: number }>;
}

/**
 * Transactions where originalCurrency != ILS (or != null). Aggregates per
 * currency: count, sum in original units, sum in converted ILS, and the
 * top 3 merchants per currency.
 */
export async function getForeignCurrencyExposure(
  householdId: string,
  w: InsightWindow,
): Promise<ForeignCurrencyBucket[]> {
  const db = getDb();

  const rows = await db
    .select({
      currency: schema.transactions.originalCurrency,
      original: schema.transactions.originalAmount,
      ils: schema.transactions.amountIls,
      merchant: schema.transactions.merchantNormalized,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        excludeAllProjectTxns(),
        isNotNull(schema.transactions.originalCurrency),
        ne(schema.transactions.originalCurrency, 'ILS'),
        windowFragment(w),
      ),
    );

  if (rows.length === 0) return [];

  // Group by currency
  const byCurrency = new Map<string, { count: number; orig: number; ils: number; merchants: Map<string, number> }>();
  for (const r of rows) {
    const cur = (r.currency ?? 'OTHER') as string;
    if (!byCurrency.has(cur)) byCurrency.set(cur, { count: 0, orig: 0, ils: 0, merchants: new Map() });
    const slot = byCurrency.get(cur)!;
    slot.count += 1;
    slot.orig += Math.abs(Number(r.original ?? 0));
    slot.ils += Math.abs(Number(r.ils));
    slot.merchants.set(r.merchant, (slot.merchants.get(r.merchant) ?? 0) + Math.abs(Number(r.ils)));
  }

  return Array.from(byCurrency.entries())
    .map(([currency, slot]) => ({
      currency,
      countTransactions: slot.count,
      totalOriginal: slot.orig,
      totalIls: slot.ils,
      topMerchants: Array.from(slot.merchants.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([merchant, totalIls]) => ({ merchant, totalIls })),
    }))
    .sort((a, b) => b.totalIls - a.totalIls);
}

// ─── Project burn-rate (per active project) ─────────────────────────────────

export interface ProjectBurnFinding {
  projectId: string;
  name: string;
  color: string | null;
  totalBudgetIls: number | null;     // null = open-ended budget
  spentIls: number;                  // absolute, all time
  remainingIls: number | null;       // budget - spent (null when no budget)
  consumedPct: number | null;        // 0-100 (null when no budget)
  monthlyBurnIls: number;            // average over last 3 months
  projectedMonthsToBudget: number | null; // months left at current burn (null when no budget or no burn)
  startDate: string | null;
}

export async function getProjectBurnRate(
  householdId: string,
  anchorMonth: string,
): Promise<ProjectBurnFinding[]> {
  const db = getDb();

  const projs = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.householdId, householdId),
        eq(schema.projects.status, 'active'),
      ),
    );

  if (projs.length === 0) return [];

  const findings: ProjectBurnFinding[] = [];
  const cur = anchorMonth;
  const burnWindow = addMonths(cur, -3); // average over last 3 months

  for (const p of projs) {
    // Total spend (all time) — projects are usually multi-month
    const [totalRow] = await db
      .select({
        total: sql<string>`coalesce(sum(abs(${schema.transactions.amountIls})), 0)`,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.projectId, p.id),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
        ),
      );

    // Last 3 months burn for projection
    const [burnRow] = await db
      .select({
        total: sql<string>`coalesce(sum(abs(${schema.transactions.amountIls})), 0)`,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.projectId, p.id),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
          gte(schema.transactions.billingMonth, burnWindow),
        ),
      );

    const spent = Number(totalRow?.total ?? 0);
    const burn3mo = Number(burnRow?.total ?? 0);
    const monthlyBurn = burn3mo / 3;
    const budget = p.totalBudgetIls ? Number(p.totalBudgetIls) : null;
    const remaining = budget == null ? null : budget - spent;
    const consumedPct = budget == null || budget === 0 ? null : (spent / budget) * 100;
    const projectedMonths =
      budget == null || remaining == null || remaining <= 0 || monthlyBurn === 0
        ? null
        : remaining / monthlyBurn;

    findings.push({
      projectId: p.id,
      name: p.name,
      color: p.color,
      totalBudgetIls: budget,
      spentIls: spent,
      remainingIls: remaining,
      consumedPct,
      monthlyBurnIls: monthlyBurn,
      projectedMonthsToBudget: projectedMonths,
      startDate: p.startDate,
    });
  }

  // Most-active first
  findings.sort((a, b) => b.monthlyBurnIls - a.monthlyBurnIls);
  return findings;
}

// ─── Data quality strip (always-on banner) ──────────────────────────────────

export interface DataQualitySummary {
  /** Worst-case account staleness in days. null = no accounts. */
  worstStaleDays: number | null;
  staleAccountName: string | null;
  /** Counts feeding the §2.bis insights. */
  untaggedCount: number;
  lowConfidenceCount: number;
  suspiciousInstallmentsCount: number;
  unpairedTransferCandidates: number;
  badPatternsCount: number;
  /** Aggregate "is anything off" — used for the strip's tone */
  hasIssues: boolean;
}

export async function getDataQualitySummary(
  householdId: string,
  w: InsightWindow,
  anchorMonth: string,
): Promise<DataQualitySummary> {
  const db = getDb();

  // Last import per account
  const accs = await db
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      lastScrapedAt: schema.accounts.lastScrapedAt,
    })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.householdId, householdId), eq(schema.accounts.isActive, true)));

  const sessions = await db
    .select({
      accountId: schema.importSessions.accountId,
      committedAt: schema.importSessions.committedAt,
    })
    .from(schema.importSessions)
    .where(
      and(
        eq(schema.importSessions.householdId, householdId),
        eq(schema.importSessions.status, 'committed'),
      ),
    );

  // Latest commit per account
  const lastByAccount = new Map<string, Date>();
  for (const s of sessions) {
    if (!s.accountId) continue;
    const cur = lastByAccount.get(s.accountId);
    if (!cur || s.committedAt > cur) lastByAccount.set(s.accountId, s.committedAt);
  }

  let worstStaleDays: number | null = null;
  let staleAccountName: string | null = null;
  for (const a of accs) {
    const last = lastByAccount.get(a.id) ?? a.lastScrapedAt;
    if (!last) continue; // accounts that have never imported are skipped (handled elsewhere)
    const days = Math.floor((Date.now() - last.getTime()) / 86_400_000);
    if (worstStaleDays == null || days > worstStaleDays) {
      worstStaleDays = days;
      staleAccountName = a.name;
    }
  }

  // Pull counts from the data-integrity insights — pragmatic: just length
  // (each underlying query returns its own pre-truncated array; close enough
  // for the strip's headline number)
  const [untagged, lowConf, suspIns, unpaired, badPats] = await Promise.all([
    getUntaggedTransactions(householdId, w),
    getLowConfidenceCategorizations(householdId, w),
    getSuspiciousInstallments(householdId, anchorMonth),
    getMisTaggedTransferCandidates(householdId),
    getBadRecurringPatterns(householdId),
  ]);

  const STALE_THRESHOLD = 14;
  const hasIssues =
    (worstStaleDays ?? 0) > STALE_THRESHOLD ||
    untagged.count > 0 ||
    lowConf.count > 0 ||
    suspIns.length > 0 ||
    unpaired.length > 0 ||
    badPats.length > 0;

  return {
    worstStaleDays,
    staleAccountName,
    untaggedCount: untagged.count,
    lowConfidenceCount: lowConf.count,
    suspiciousInstallmentsCount: suspIns.length,
    unpairedTransferCandidates: unpaired.length,
    badPatternsCount: badPats.length,
    hasIssues,
  };
}

// (Historically re-exported activeBillingMonth/currentBillingMonth here.
// Removed deliberately — see the contract note at the top of this file.
// If you need them, import from '@fba/db' at the caller, NOT inside this
// file's queries. The page resolves the anchor month and passes it in.)
