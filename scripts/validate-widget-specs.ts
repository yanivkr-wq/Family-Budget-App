#!/usr/bin/env node
/**
 * Widget-spec drift validator.
 *
 * Runs pattern-match invariants over each entry in `WIDGET_SPECS` (defined
 * in `packages/shared/src/widget-specs.ts`) against the actual source file
 * the spec references via its `queryFunction` field. Catches the worst
 * class of "code changed but spec didn't" bug — the one that makes the
 * chatbot confidently quote stale logic to the user.
 *
 * What it checks per spec:
 *   1. The source file exists and is readable.
 *   2. If queryFunction names a function (not a file path), that
 *      identifier actually appears in the resolved file.
 *   3. `dataSource` invariants — e.g. dataSource='bank' means the SQL
 *      must contain a `accounts.type` reference (the structural bank-only
 *      filter we documented).
 *   4. Filter-string invariants — common filters declared in the `filters`
 *      array must appear (by their column name) in the source.
 *   5. `timeScope` invariants — e.g. 'active-billing-month' must
 *      reference `billing_month` / `billingMonth`; 'window' must call
 *      `windowFragment` or use a window helper.
 *
 * The checks are deliberately heuristic — false positives are possible
 * if SQL is written unusually (e.g. raw template literals that obscure
 * column names). When a check produces a clearly-wrong negative, prefer
 * tightening the spec wording over weakening the check.
 *
 * Output is grouped by widget id; exit code 0 = all-clean, 1 = drift
 * detected. Run via `pnpm validate:specs`.
 *
 * NOTE on heuristic accuracy: this catches BIG drift (someone removed
 * the bank-only filter; the time-window param disappeared; the function
 * was renamed). It does NOT catch subtle semantic drift (someone changed
 * the threshold from 30% to 50% but didn't update the spec). For that,
 * the runtime validator in `packages/chatbot/src/validator.ts` is the
 * second line of defense.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { WIDGET_SPECS, type WidgetSpec } from '../packages/shared/src/widget-specs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

interface Finding {
  widgetId: string;
  pageId: string;
  severity: 'error' | 'warn';
  message: string;
}

const findings: Finding[] = [];

function err(widget: WidgetSpec, msg: string) {
  findings.push({ widgetId: widget.id, pageId: widget.pageId, severity: 'error', message: msg });
}
function warn(widget: WidgetSpec, msg: string) {
  findings.push({ widgetId: widget.id, pageId: widget.pageId, severity: 'warn', message: msg });
}

/**
 * Resolve the spec's `queryFunction` field to a concrete file path under
 * the repo. Three forms in practice:
 *   1. A bare function name like `getDashboardKpis` → assume it lives in
 *      `apps/web/src/app/(app)/insights/queries.ts` (the insights surface
 *      that introduced this naming convention).
 *   2. A file path like `apps/web/src/app/(app)/page.tsx` → return as-is.
 *   3. A path with trailing free-text annotation like
 *      `apps/web/.../page.tsx (cashFlowByPurposeRows for the breakdown)` →
 *      strip the parenthetical.
 *
 * Returns null when we can't resolve to a real on-disk file.
 */
function resolveSourcePath(qf: string): string | null {
  // Strip ONLY a TRAILING parenthetical annotation (e.g.
  // "apps/.../page.tsx (cashFlowByPurposeRows)"). We can't naively
  // split on '(' because Next.js group paths contain '(app)' in them.
  const cleaned = qf.replace(/\s*\([^)]*\)\s*$/, '').trim();

  // Looks like a path?
  if (cleaned.includes('/') || cleaned.endsWith('.ts') || cleaned.endsWith('.tsx')) {
    const abs = join(REPO_ROOT, cleaned);
    // existsSync returns true for directories too — make sure it's a file
    // we can actually read.
    if (!existsSync(abs)) return null;
    try {
      readFileSync(abs, 'utf8');
      return abs;
    } catch {
      return null; // e.g. EISDIR — the path was a folder, not a file
    }
  }

  // Otherwise assume insights/queries.ts.
  const fallback = join(REPO_ROOT, 'apps/web/src/app/(app)/insights/queries.ts');
  return existsSync(fallback) ? fallback : null;
}

/**
 * If queryFunction is a bare identifier (no slashes), make sure that
 * identifier actually exists in the resolved source. Catches renames /
 * removals.
 */
function checkFunctionExists(widget: WidgetSpec, source: string) {
  const qf = widget.queryFunction;
  // Same trailing-paren strip as resolveSourcePath — keeps `(app)` in
  // paths intact while removing trailing annotations.
  const cleaned = qf.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (cleaned.includes('/') || cleaned.endsWith('.ts') || cleaned.endsWith('.tsx')) return; // path mode

  if (!cleaned) return;
  // Look for function definition OR direct reference.
  const re = new RegExp(`\\b${cleaned.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`);
  if (!re.test(source)) {
    err(widget, `queryFunction "${cleaned}" not found in the resolved source file. Did you rename or remove it?`);
  }
}

/**
 * `dataSource` invariants — checks that the SQL actually expresses the
 * filter the spec claims.
 */
function checkDataSource(widget: WidgetSpec, source: string) {
  switch (widget.dataSource) {
    case 'bank':
      // Bank-only widgets MUST filter accounts.type. Without this check
      // we silently re-broke the CC-leak bug from earlier in the session.
      if (!/accounts\.type|account\.type/.test(source)) {
        err(widget, `dataSource='bank' but source has no accounts.type filter — the structural bank-only rule isn't enforced.`);
      }
      break;
    case 'cc':
      // CC-detail widgets typically reference excluded_from_totals
      // OR isSettlementLineExpr OR account.type='credit_card'. We treat
      // missing all three as a warning (some CC widgets work via
      // recurring_pattern lookups instead, which is fine).
      if (
        !/excludedFromTotals|excluded_from_totals/.test(source) &&
        !/isSettlementLineExpr/.test(source) &&
        !/credit_card/.test(source) &&
        !/originalCurrency/.test(source) &&
        !/recurringPatterns|recurring_pattern/.test(source)
      ) {
        warn(widget, `dataSource='cc' but source has no CC-specific reference (excluded_from_totals / isSettlementLineExpr / credit_card / originalCurrency / recurringPatterns). Verify it's actually pulling CC details.`);
      }
      break;
    case 'both':
    case 'other-table':
    case 'ui-only':
      // No specific check — these are too varied to pattern-match safely.
      break;
  }
}

/**
 * Filter-string invariants — for each filter the spec lists, look for
 * something in the source that backs it up. Heuristic mapping of common
 * phrasings to expected source patterns.
 */
// Source-side patterns accept BOTH the Drizzle JS field (camelCase) AND the
// raw SQL column (snake_case). Many queries are written as inline `sql`
// template literals that use the snake_case column directly, e.g.
// `AND t.excluded_from_totals = false` — those need to match too.
const FILTER_PATTERNS: Array<[RegExp, RegExp, string]> = [
  // [spec filter pattern, source code pattern, human-readable description]
  [/is_transfer\s*=\s*false/i, /isTransfer|is_transfer/, '`is_transfer = false`'],
  [/excluded_from_totals\s*=\s*false/i, /excludedFromTotals|excluded_from_totals/, '`excluded_from_totals = false`'],
  [/accounts\.type\s*=\s*['"]?bank['"]?/i, /accounts\.type|account\.type|accounts?\.type/, '`accounts.type = bank`'],
  [/accounts\.type\s*=\s*['"]?credit_card['"]?/i, /credit_card/, '`accounts.type = credit_card`'],
  [/project_id\s+IS\s+NOT\s+NULL/i, /projectId|project_id/, '`project_id IS NOT NULL`'],
  [/deleted_at\s+IS\s+NULL/i, /deletedAt|deleted_at/, '`deleted_at IS NULL`'],
  [/is_projected\s*=\s*false/i, /isProjected|is_projected/, '`is_projected = false`'],
  [/billing_month/i, /billingMonth|billing_month/, '`billing_month`'],
  [/transaction_date/i, /transactionDate|transaction_date/, '`transaction_date`'],
];

function checkFilters(widget: WidgetSpec, source: string) {
  for (const filterText of widget.filters) {
    for (const [filterPat, sourcePat, name] of FILTER_PATTERNS) {
      if (filterPat.test(filterText) && !sourcePat.test(source)) {
        warn(widget, `spec lists filter ${name} but the source doesn't reference it. Either the filter was removed from the SQL or the spec is stale.`);
      }
    }
  }
}

/**
 * `timeScope` invariants — the source should reference appropriate
 * date/month columns or helpers for the declared scope.
 */
function checkTimeScope(widget: WidgetSpec, source: string) {
  switch (widget.timeScope) {
    case 'window':
      if (!/windowFragment|InsightWindow|window\.kind/.test(source)) {
        warn(widget, `timeScope='window' but source has no InsightWindow / windowFragment reference. Verify the widget actually honors the page's window selector.`);
      }
      break;
    case 'active-billing-month':
      if (!/billingMonth|billing_month/.test(source)) {
        warn(widget, `timeScope='active-billing-month' but source doesn't reference billing_month.`);
      }
      break;
    case 'trailing-months':
      if (!/addMonths|trailing|months\.push/.test(source)) {
        warn(widget, `timeScope='trailing-months' but no obvious trailing-N logic (addMonths / months.push). Verify.`);
      }
      break;
    case 'today-relative':
      // Just expect SOME today reference — too varied to be strict.
      if (!/new Date|Date\.now|today|now\(\)/.test(source)) {
        warn(widget, `timeScope='today-relative' but no obvious "today" reference (new Date / today / Date.now).`);
      }
      break;
    case 'all-time':
    case 'na':
      // No specific check.
      break;
  }
}

// ─── Main run ───────────────────────────────────────────────────────────

console.log(`\nValidating ${WIDGET_SPECS.length} widget specs against source...`);

const sourceCache = new Map<string, string>();
function loadSource(path: string): string {
  let s = sourceCache.get(path);
  if (s == null) {
    s = readFileSync(path, 'utf8');
    sourceCache.set(path, s);
  }
  return s;
}

for (const widget of WIDGET_SPECS) {
  // Skip widgets that have no logic (pure UI elements).
  if (widget.dataSource === 'ui-only') continue;

  const sourcePath = resolveSourcePath(widget.queryFunction);
  if (!sourcePath) {
    err(widget, `Could not resolve queryFunction "${widget.queryFunction}" to a real on-disk file. Either fix the path or the function name.`);
    continue;
  }
  const source = loadSource(sourcePath);

  checkFunctionExists(widget, source);
  checkDataSource(widget, source);
  checkFilters(widget, source);
  checkTimeScope(widget, source);
}

// ─── Report ─────────────────────────────────────────────────────────────

const errors = findings.filter((f) => f.severity === 'error');
const warnings = findings.filter((f) => f.severity === 'warn');

if (findings.length === 0) {
  console.log(`✓ all ${WIDGET_SPECS.length} widget specs check out (${WIDGET_SPECS.filter((w) => w.dataSource === 'ui-only').length} ui-only widgets skipped)`);
  process.exit(0);
}

// Group findings by widget for readable output.
const byWidget = new Map<string, Finding[]>();
for (const f of findings) {
  const arr = byWidget.get(f.widgetId) ?? [];
  arr.push(f);
  byWidget.set(f.widgetId, arr);
}

for (const [widgetId, group] of byWidget) {
  const page = group[0]!.pageId;
  console.log(`\n  [${page}] ${widgetId}`);
  for (const f of group) {
    const tag = f.severity === 'error' ? '✗ ERROR' : '!  WARN';
    console.log(`    ${tag}  ${f.message}`);
  }
}

console.log(`\nSummary: ${errors.length} error(s), ${warnings.length} warning(s).`);
if (errors.length > 0) {
  console.log('\nDrift detected. Either fix the source to match the spec, or update the spec to match the source.\nSee CLAUDE.md "Widget-spec doc-sync rule" for the contract.');
  process.exit(1);
}

console.log('\nNo hard errors — warnings are best-effort. Review them if you suspect drift.');
process.exit(0);
