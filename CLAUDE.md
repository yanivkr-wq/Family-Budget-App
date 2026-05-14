# Project-wide rules for Claude (any session in this repo)

These rules apply to every Claude session working in this repository. Read them at session start. They are NOT optional — they're contracts that prevent specific classes of bugs we've already hit.

---

## 1. Widget-spec doc-sync rule (non-negotiable)

The file `packages/shared/src/widget-specs.ts` is the **authoritative documentation** the in-app chatbot quotes from when answering questions about how each page/widget/card/table works. It documents:

- which data source each widget reads (bank rows / CC details / other tables)
- what filters / time scope / math rule it applies
- what's excluded

**Rule:** If you change the **logic** behind any widget, KPI, summary, table, or card on `/`, `/insights`, `/transactions`, `/recurring`, `/installments`, `/savings`, `/projects` — **you MUST update the matching entry in `widget-specs.ts` in the same change.**

This includes:
- Adding / removing a SQL filter
- Changing a sign rule (sign-aware vs abs)
- Changing the time scope (window vs billing month vs trailing-N vs today-relative)
- Renaming the underlying query function (update `queryFunction` field)
- Changing which account types are included (bank vs CC)
- Adding / removing an exclusion (transfers, projects, dynamic-amount, etc.)
- Fixing a bug that changes a number the user sees

**Why this is critical:** The chatbot quotes the spec verbatim when users ask "how does this widget work?". Drift between code and spec → the chatbot answers confidently wrong.

**Workflow when modifying a widget:**

1. Edit the SQL / aggregation logic.
2. Open `packages/shared/src/widget-specs.ts` and find the matching entry by `id` (or by `queryFunction` if you can't remember the id).
3. Update every affected field: `dataSource`, `dataSourceNotes`, `filters`, `mathRule`, `exclusions`, `timeScope`, `caveats`.
4. If the fix corrected a real bug, add a short `caveats` note like "Recent fix: previously was X, now Y."
5. If you added a new widget, add a new entry with a stable `id` and the correct `pageId`.
6. **Run `pnpm validate:specs` and confirm 0 errors.** This script (in `scripts/validate-widget-specs.ts`) pattern-matches each spec against its referenced source file and fails on hard drift — e.g. `dataSource='bank'` without the `accounts.type` filter, or a `queryFunction` that no longer exists. Warnings are best-effort heuristics; only errors must be zero.
7. Don't ship until the spec matches the new code AND `pnpm validate:specs` exits clean.

There's an ESLint guard on `apps/web/src/app/(app)/insights/queries.ts` preventing direct calls to `currentBillingMonth()` / `activeBillingMonth()` — that's the related guardrail for the single-source-of-truth contract on the insights page anchor month. Don't bypass it without lifting the rule explicitly in code review.

---

## 2. Insights queries: anchor month contract

`apps/web/src/app/(app)/insights/queries.ts` follows a single-source-of-truth rule for "which month is now": the page resolves `activeBillingMonth(10)` ONCE and passes it as `anchorMonth: string` to every query that needs it. **Do NOT call `currentBillingMonth()` or `activeBillingMonth()` inside individual query functions** — the lint rule will flag it.

If you add a new monthly-aggregation query to that file, accept `anchorMonth` as a parameter from the caller. See the contract note at the top of `queries.ts` for the rationale.

---

## 3. Bank rows vs CC details

The app distinguishes two row classes:

- **Bank rows** (`accounts.type='bank'`): settlement lines + bank-direct charges. These are the canonical "money left the account" rows.
- **CC details** (`accounts.type='credit_card'`): per-purchase rows, typically marked `excluded_from_totals=true` so they don't double-count the bank-side settlement that bundles them.

**Contract:** Income/expense TOTALS widgets read **bank rows only** (enforced via `accounts.type='bank'` in SQL, not just `excluded_from_totals=false` — that flag has been unreliable for forex CC imports). Behavioral / per-purchase widgets (category-by-txn-date, foreign-currency, recurring-drift) deliberately use **CC details**.

If a widget produces a "totals" number, it should structurally filter to bank-only. If it produces "behavior" data (per-merchant, per-category breakdown), it should use CC details.

---

## 4. Commit hygiene

- Don't add backwards-compatibility shims when straightforward replacement is fine — this is a single-user, self-hosted app.
- Pre-existing typecheck errors in `apps/web/src/app/(app)/page.tsx` and `apps/web/src/app/design-preview/v5a/refined/page.tsx` are known and out of scope for unrelated changes. Don't try to "fix" them in passing.
- Verify with `pnpm typecheck` on the touched packages before declaring done. Build doesn't need to be clean on `apps/web` due to the pre-existing errors above; just on whatever you touched.

---

## 5. Local DB / preview

- Postgres runs in docker container `budget-pg`. User=`budget`, password=`devpass`, db=`budget`. Tables are singular (`transaction`, `account`, `installment_plan`, `recurring_pattern`, `saving_goal`, `project`, `category`).
- Dev server runs on port 3010, started via the `Claude_Preview` MCP server. Auth is required to actually render pages — preview tools will hit the sign-in redirect when the session has expired.
- When validating math against the DB: query directly with `docker exec budget-pg psql -U budget -d budget -c "..."`. Faster than building Drizzle queries for one-off checks.
