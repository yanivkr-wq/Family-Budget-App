# Insights — Spec & Phased Plan

> **Status:** Phase 2 deliverable — spec for review. No code shipped yet.
> **Owner:** Lily.   **Date drafted:** 2026-05-08.

---

## 1. Executive summary

The Insights section is a **diagnostic** surface — not prescriptive, not motivational. Its job is to show the user things she could not notice manually: silent subscription drift, dormant recurring charges, statistical outliers, category trends, concentration shifts, and **data-integrity anomalies** (mis-tagged transactions, mis-calculated installments, miscategorized income). It uses the existing chatbot (single global drawer, ⌘K, Sonnet 4.6, persistent sessions) as the conversational layer; the static dashboard renders the same data the chatbot can fetch via tool calls. Risk alerting is quiet (top 3, severity-ranked); thresholds are conservative; cold-start sparseness is preferred over noisy half-baked insights. Every chart supports **BI-tool-grade drill-in / drill-out** — click a wedge to descend a level, breadcrumbs to climb back. Every layout is **user-customizable** — drag, drop, resize, persisted per-user. Insights worth daily attention can be **published to the main dashboard** with one click, where they render with the same drill behavior in their own dedicated section. Every number is drillable to source transactions, every chart has empty / loading / error states, and a persistent data-quality strip surfaces the failure mode the user explicitly named: *"can't trust the data."*

---

## 2. Insight catalog

**21 insights total.** P0 = ship in Phase A (13, including a new Data-Integrity sub-section of 5). P1 = Phase C (8). Forecasting / goals / nudges live only in the chatbot's tool layer — no static cards.

Format: **Name** · category · data deps · default window · drill-down · priority · justification.

### P0 — ship in Phase A

1. **Unusual transaction (z-score outlier)** · Risk · `transaction.amountIls`, `merchantNormalized` · trailing 6 months baseline; flagged within active window · → `/transactions?merchant=X&highlight=Y` · **P0** · Single highest-leverage "surprise me" insight. Catches mistakes (double-charge, wrong tip) and silent bill jumps that recurring-drift won't because the merchant has no recurring pattern yet.

2. **Recurring drift (subscription price increased silently)** · Risk · `recurring_pattern`, `transaction` · current charge vs `expectedAmountIls`, last 90d · → expanded card showing the price history sparkline, then `/transactions?merchant=X` · **P0** · Already 100% supported by the schema. This is the canonical "surprise me" insight — Netflix going from ₪38 → ₪45 silently is exactly what the user can't catch by eye.

3. **Phantom subscription (recurring + dormant merchant)** · Pattern · `recurring_pattern`, `transaction` · pattern still active but no non-recurring transactions to that merchant in 90+ days · → expanded card with "last activity at this merchant" + cancel hint, then `/recurring` for management · **P0** · Highest discovery value per pixel. The user explicitly down-ranked nudges, but this isn't a nudge — it's a finding she couldn't make manually.

4. **Recurring lapsed (expected charge missing)** · Risk · `recurring_pattern`, `transaction` · current cycle has no charge despite `frequency` saying it should · → expanded card with "expected by date X, hasn't fired" + check-on-vendor hint · **P0** · Inverse of drift. Useful for catching cancelled-without-knowing-it gym memberships, missed insurance renewals.

5. **Category trend (3-month direction with magnitude)** · Trend · `transaction`, `category` · last 4 monthly buckets · → inline expansion: monthly bar mini-chart of the category, then `/transactions?category=X&month=Y` · **P0** · Core trend insight. Surfaces only categories with a clear direction (≥3 consecutive months up or down ≥15%).

6. **Category MoM spike** · Anomaly · `transaction`, `category` · current billing month vs trailing 3-month median · → inline expansion: which sub-categories / merchants drove the spike, then `/transactions?category=X&month=Y` · **P0** · Different from #5 — single-month deviation, not direction. Catches one-off events (vacation, big repair).

7. **Fixed vs variable cost ratio trend** · Trend · `recurring_pattern`, `installment_plan`, `transaction` · last 6 monthly buckets · → inline expansion: stacked area chart, then "see all fixed costs" → `/recurring` · **P0** · Long-arc indicator the user couldn't compute. If fixed costs ate 50% of spend in Jan and 65% in May, that's a warning shot.

8. **Data-quality watchtower (always-on banner)** · Meta · `import_session`, `account`, `transaction` · live · → drill: the worst-offending account → `/admin/imports` or `/transactions?missing=true` · **P0** · *Directly addresses the user's #1 failure mode ("can't rely on the data").* Surfaces: stale imports per account (>14d), counts of issues found by §2.bis Data-Integrity insights below. NOT an insight card — a thin colored strip at the top of `/insights` that's neutral when clean and amber when something needs attention. Click → scrolls to the Data Integrity section.

### P0 — Data Integrity sub-section (also Phase A)

This section is the user's "help me find potential issues with the data" surface. Each insight here is admin-quality scaffolding — finding things that look wrong, not finding things you spent too much on. Lives in its own labeled section (`אמינות הנתונים`) below the risk section.

8a. **Untagged transactions** · Integrity · `transaction.categoryId IS NULL` · active window · → `/transactions?unmapped=true` · **P0** · One of the simplest signals of broken downstream insights — every other insight depends on `categoryId`. Card shows count + total ILS uncategorized + "תקן עכשיו" CTA.

8b. **Low-confidence categorizations** · Integrity · `transaction.categorySource IN ('llm', 'pending')` AND not user-confirmed · active window · → `/transactions?categorySource=llm&from=insight:8b` · **P0** · The schema already tracks how each row was categorized. LLM-suggested rows that the user hasn't reviewed are a known weak spot — surface them, let the user mass-confirm or recategorize from the deep-link.

8c. **Suspicious installments** · Integrity · `installment_plan.status = 'active'` with anomalies · live · → `/installments?highlight=X` · **P0** · Detects three sub-cases: (1) plan with `currentPaymentNo > totalPayments` (data error), (2) active plan with no charge in the current cycle when one was expected (`isProjected` row missing), (3) plan whose `paymentAmountIls` differs by >5% from the average actual charge (likely mis-parsed from import). Card shows up to 3 worst offenders.

8d. **Possible mis-tagged transfers** · Integrity · `transaction` pairs (sign-flipped, equal magnitude ±1%, ±2 days, different accounts) where neither has `isTransfer=true` or `transferPairId` set · last 90d · → `/transactions?candidate_transfer=true&from=insight:8d` · **P0** · The cross-account transfer auto-detector you built can miss pairs (different cutoff days, slight amount drift). Surfacing them lets the user manually pair and stop double-counting income/expense in the Combined view.

8e. **Recurring patterns that might be wrong** · Integrity · `recurring_pattern.status = 'active'` with charges that violated `tolerancePct` ≥2 times in last 6 cycles · live · → `/recurring?highlight=X&from=insight:8e` · **P0** · Distinct from #2 (drift): drift is "this is real, just expensive." This is "this looks like the pattern detector mis-grouped two different charges as one." Card shows pattern + last 6 actual charges + suggestion to split.

### P1 — ship in Phase C

9. **Category velocity (burn-rate within month)** · Risk · `transaction`, `category.monthlyTargetIls` · current billing month, day-of-month-paced · → expanded card showing pace line vs target, then `/transactions?category=X&month=Y` · **P1** · "On day 15 you've burned 70% of dining" is genuinely informative when the target is set. Skip categories without targets.

10. **Sub-category drill (parent stable, child shifting)** · Trend · `transaction`, `category` (parent/sub) · last 4 months · → expanded card with parent vs sub bar chart, then `/transactions?subCategory=X` · **P1** · Catches the case where overall dining is flat but fast-food doubled while sit-down halved.

11. **Merchant concentration (top N = X% of discretionary)** · Pattern · `transaction`, `category.isIncome=false`, exclude recurring · current window · → inline list of top 5 merchants with totals, then `/transactions?merchant=X` · **P1** · Nice "huh, didn't realize Wolt was 14% of my discretionary." Excludes recurring patterns to avoid restating subscriptions.

12. **New merchants bloom** · Pattern · `transaction.merchantNormalized`, `transaction.transactionDate` · count of merchants new this window vs trailing avg · → list of the new merchants, then `/transactions?merchant=X` · **P1** · Spike in new merchants is a behavioral signal (vacation, new neighborhood, life change). Not threshold-y, just shown.

13. **Income drop / income spike** · Risk · `transaction` where `category.isIncome=true` · current billing month vs trailing 3-month average · → `/transactions?category=income&month=current` · **P1** · Symmetric to category MoM but for income. Default thresholds: 80% = note, 60% = risk; for spike: 130% = note, 160% = risk insight.

14. **Category right-sizing suggestion** · Behavioral · `transaction`, `category.monthlyTargetIls` · trailing 4 months · → inline card with proposed new target + **inline "adjust target" affordance** (server action, no leaving page) · **P1** · Bridges insight → write. Powered by the user's confirmation that page-level writes are in scope.

15. **Installment cliff** · Forecast (limited) · `installment_plan` · forward 6 months · → list of upcoming endings with monthly cash freed, then `/installments` · **P1** · One forecast-shaped insight that survives the "forecasting is bottom 3" cull because it's *deterministic* (the schema knows when each plan ends), not predictive.

16. **Project burn-rate** · Trend · `project`, `transaction.projectId` · per active project · → expanded inline: monthly burn vs `totalBudgetIls`, then `/projects/[id]` · **P1** · Bonus insight tailored to the user's existing `project` model (construction, etc.). Trivial to compute, high signal for active projects.

### Cut from the catalog (with reasoning)

- **Top expense of the month** — already on the dashboard. Violates "don't tell me what I already know."
- **"Quiet wins" / behavioral nudges** — bottom 3 in priority ranking. Cut.
- **Cash-flow runway if income stopped** — interesting but emergency-fund framing, doesn't match "diagnostic" stance. Lives in chatbot only (`get_predicted_balance` already exists).
- **EOM cash-flow projection** — bottom 3 (forecasting). Lives in chatbot.
- **Savings rate trend** — goal-tracking territory, bottom 3. Chatbot only.
- **Day-of-week / time-of-month patterns** — feels like trivia, not surprise. Cut.
- **YoY anything** — only ~4 months of data. Unlocks at month 12+. Spec'd as "future" not "P2."

---

## 3. Information architecture

### 3.1 Page layout (text wireframe)

```
┌──────────────────────────────────────────────────────────────────────┐
│  GLOBAL HEADER (existing)                                ⌘K  user ▼ │
├──────┬───────────────────────────────────────────────────────────────┤
│      │  /insights                                                    │
│ NAV  │  ─────────────────────────────────────────────────────────────│
│      │                                                               │
│      │  [Data-quality watchtower strip] ─────────────────────────────│
│      │  ✓ הנתונים עדכניים | תקין    OR   ⚠ 3 תנועות לא ממופות → תקן │
│      │  ─────────────────────────────────────────────────────────────│
│      │                                                               │
│      │  תובנות                                                       │
│      │  ניתוח חכם של דפוסי ההוצאות שלך                                │
│      │                                                               │
│      │  [Time-window selector]  MTD · 30D · 90D · טווח מותאם...      │
│      │                                                               │
│      │  ─── AI narrative summary card (collapsible) ─────────────────│
│      │  Sparkles  סיכום החודש שלך                                    │
│      │  3 בולטים: דמי ניהול בנק עלו ב-22%, חודש נדיר של 0 חיובי     │
│      │  Wolt, פרויקט שיפוץ סיים ¾ מהתקציב.                           │
│      │  [▼ הצג פירוט מלא]                                            │
│      │                                                               │
│      │  ─── 🔴 דחוף (Risk — top 3 only) ───────────────────────────│
│      │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│      │  │ ≡ Insight#2 │ │ ≡ Insight#1 │ │ ≡ Insight#4 │              │
│      │  │ Recurring   │ │ Unusual     │ │ Recurring   │              │
│      │  │ drift       │ │ transaction │ │ lapsed      │              │
│      │  │ ₪45 ↑18%    │ │ ₪890 outlier│ │ Gym dormant │              │
│      │  │ [drill→]  ↘ │ │ [drill→]  ↘ │ │ [drill→]  ↘ │              │
│      │  └─────────────┘ └─────────────┘ └─────────────┘              │
│      │                                                               │
│      │  ─── אמינות הנתונים (Data Integrity) ────────────────────────│
│      │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│      │  │ ≡ #8a       │ │ ≡ #8b       │ │ ≡ #8c       │              │
│      │  │ Untagged    │ │ Low-conf    │ │ Suspicious  │              │
│      │  │ 23 txns     │ │ 8 txns      │ │ installments│              │
│      │  │ [תקן →]   ↘ │ │ [סקור →]  ↘ │ │ [בדוק →]  ↘ │              │
│      │  └─────────────┘ └─────────────┘ └─────────────┘              │
│      │  ┌─────────────┐ ┌─────────────┐                              │
│      │  │ ≡ #8d       │ │ ≡ #8e       │                              │
│      │  │ Mis-tagged  │ │ Bad recurr. │                              │
│      │  │ transfers   │ │ patterns    │                              │
│      │  └─────────────┘ └─────────────┘                              │
│      │                                                               │
│      │  ─── מגמות (Trend — supports drill-stack) ───────────────────│
│      │  ┌────────────────────┐ ┌────────────────────┐                │
│      │  │ ≡ #5 Category trend│ │ ≡ #7 Fixed/var     │                │
│      │  │ ⌐ הכל › מזון       │ │ ⌐ הכל              │                │
│      │  │ [bars] [← back] ↻  │ │ [stacked area]     │                │
│      │  └────────────────────┘ └────────────────────┘              ↘ │
│      │                                                               │
│      │  ─── דפוסים (Pattern) ────────────────────────────────────────│
│      │  ... insights #3, #11, #12 ...                                │
│      │                                                               │
│      │  ─── מעקב (Tracking) ─────────────────────────────────────────│
│      │  ... insights #15, #16 ...                                    │
│      │                                                               │
│      │  ─── 📌 מוצמדות (Pinned chatbot answers) ─────────────────────│
│      │  ... user-pinned cards (live or snapshot) ...                 │
│      │                                                               │
│      │  ─── תובנות מוסתרות (collapsed list of hidden cards) ─────────│
│      │                                                               │
│      │  [↻ איפוס פריסה]                       [↓ ייצוא ל-Excel]    │
│      │                                                               │
└──────┴───────────────────────────────────────────────────────────────┘
       Floating chat pill (bottom-left, existing) ─── ⌘K opens drawer
```

Mobile: same vertical order, single-column cards, time-window selector becomes a sheet picker. Tabs at the bottom of the screen (existing). Density bumps to "comfortable" on mobile per user's "information-dense" preference reading desktop-first.

### 3.2 Drill model — BI-tool drill-stack with breadcrumbs

The interaction model is borrowed from Tableau / Power BI / Looker, simplified for a single-screen finance dashboard. **Each chart-based card holds its own drill stack** — an array of filter levels — and renders a clickable breadcrumb at the top showing where the user is.

```
┌── Card: Category trend ─────────────────────────────────┐
│  מגמת קטגוריות · 4 חודשים            [ⓘ]  [≡ drag]    │
│  ──────────────────────────────────────────────────────│
│  ⌐ הכל                                                  │  ← root level
│                                                          │
│   [bar chart of all categories — clickable bars]         │
│                                                          │
│  💡 לחץ על קטגוריה כדי להעמיק                          │
└─────────────────────────────────────────────────────────┘

After clicking the "מזון" bar:

┌── Card: Category trend ─────────────────────────────────┐
│  מגמת קטגוריות · 4 חודשים            [ⓘ]  [≡ drag]    │
│  ──────────────────────────────────────────────────────│
│  ⌐ הכל › מזון           [← חזור]  [↻ אפס]              │  ← breadcrumb
│                                                          │
│   [bar chart of sub-categories within Food]              │
│                                                          │
│  💡 לחץ על תת-קטגוריה כדי להעמיק                       │
└─────────────────────────────────────────────────────────┘

After clicking "מסעדות":

┌── Card: Category trend ─────────────────────────────────┐
│  מגמת קטגוריות · 4 חודשים            [ⓘ]  [≡ drag]    │
│  ──────────────────────────────────────────────────────│
│  ⌐ הכל › מזון › מסעדות    [← חזור]  [↻ אפס]            │  ← all crumbs clickable
│                                                          │
│   [horizontal bar chart of merchants within Restaurants] │
│                                                          │
│  💡 לחץ על בית עסק לראות תנועות                        │
└─────────────────────────────────────────────────────────┘

After clicking "פפא ג'ון":
   → routes to /transactions?subCategory=restaurants
       &merchant=papa-john&from=insight:5&drill=food/restaurants/papa-john
```

**Rules.**
- Breadcrumb always visible at the top of the card. Root crumb is `הכל`.
- Each crumb except the current one is clickable → pops the drill stack to that level.
- `[← חזור]` pops one level. `[↻ אפס]` clears to root.
- The leaf level (most-granular chart) is the level that routes out to `/transactions`. Above the leaf, drilling stays in the card.
- Drill-stack depth is capped per-insight (declared in the insight's metadata). For category trends: 3 levels (top → sub → merchant). For merchant concentration: 2 levels (top-N list → merchant detail). For data-integrity insights: usually 1 level (list → /transactions).
- **Drill state is local to the card and ephemeral** by default — refreshing the page resets cards to root. Open question (§9) on whether to URL-encode the deepest card's drill stack for shareability.
- **Smooth transition** between levels: 200ms cross-fade with a slight slide (chart shifts up 4px, fades out, new chart fades in). Already-defined `fade-in` keyframe + a new `slide-fade` for this.

**Out-routes (when drill bottoms out).**
- Always to `/transactions?...&from=insight:<id>&drill=<crumb-path>` so the user can land on the filtered list and click the back-pill to return to the same card at the same drill depth.

**Chat drawer for "ask about this insight"** — opens existing left drawer, injects the insight's name/window/numbers AND the current drill path as context. `pageContext = { insight: 'category-trend', drill: ['food', 'restaurants'] }`.

**No modals.** Drill-stack lives entirely inside the card.

### 3.3 Filter context preservation

The active time-window (MTD / 30D / 90D / custom) is encoded in the URL: `/insights?window=mtd` or `/insights?window=custom&from=2026-03-01&to=2026-04-30`. When drilling from an insight to `/transactions`, the resolved date range carries through: `/transactions?dateFrom=...&dateTo=...&category=...&drill=food/restaurants&from=insight:xyz`. Returning via the back-pill restores the exact `/insights?window=...` URL AND the source card's drill stack at the drilled level.

### 3.4 Layout customization (drag, drop, resize, persist)

The user can rearrange and resize insight cards on the desktop view. Layout persists per-user in a new `user_layout_preference` table (see §7.3).

- **Library:** `react-grid-layout` (the de facto choice — RTL works via container `dir`, supports resize handles and drag handles, ships its own collision detection). Adds ~70KB gzipped.
- **Grid:** 12 columns, configurable row height (default 4 grid units = ~80px). Each card declares a default `{ x, y, w, h, minW, maxW, minH, maxH }` in its metadata. The user's saved layout overrides defaults; if a card is added later (new insight ships), it appears at the bottom in its default size.
- **Visible affordances:**
  - Drag handle is the card's title bar (`cursor: grab`). The whole card is draggable from the title.
  - Resize handle is a small `↘` glyph in the bottom-end corner (visible on hover only — keeps the card chrome quiet).
  - Layout edits are saved on drag-end / resize-end via debounced server action (no save button). Toast confirms.
- **Reset.** A small `[↻ איפוס פריסה]` button at the bottom of the page restores all cards to their default positions and sizes.
- **Mobile (< md breakpoint).** Drag-and-drop is impractical one-thumb. Mobile gets a **single-column locked layout** in the user's saved order, plus an `[≡ ערוך סדר]` button that opens a bottom sheet with a sortable list (long-press or grip-handle drag in a 1D list). No resize on mobile — every card is full-width.
- **Sections vs free-form.** Section headers (`🔴 דחוף`, `מגמות`, `אמינות הנתונים`, etc.) act as **layout regions** — cards can be reordered freely WITHIN a section but cannot be dragged across sections. This keeps the page navigable for the user and prevents accidentally hiding all the risk insights under all the trend insights.
- **Hide / show cards.** Each card has a `[…]` menu with "הסתר תובנה זו." Hidden cards land in a "תובנות מוסתרות" collapsed list at the bottom of the page; click to restore. Hide state lives in the same `user_layout_preference` row.

### 3.5 Publish insight to main dashboard

The user can promote any insight from `/insights` to the main dashboard at `/`. Same component, same drill behavior, second surface.

- **Affordance.** Card `[…]` menu gets a new toggle item: **"פרסם ללוח המחוונים"** (with ✓ when published; re-clicking unpublishes). Toast confirms.
- **Where it appears on `/`.** A dedicated section at the bottom of the dashboard called **"תובנות שפורסמו"**, below all existing dashboard widgets (savings, projects, BudgetProgress rows, etc.). The existing dashboard layout is NOT touched — published insights live in their own region. Inside the region: the same `react-grid-layout` from `/insights`, scoped to dashboard surface. Drag/resize/hide work the same way within that region. Empty state: "אין תובנות שפורסמו. עבור ל/insights ובחר 'פרסם ללוח המחוונים' בתובנה כדי שתופיע כאן."
- **Time window per surface.** Each surface owns its own time selector. On `/insights` the published card respects the page's MTD/30D/90D/Custom selector. On `/` it respects the dashboard's existing `MonthSwitcher` (billing-month). Same insight, two contexts, no leakage.
- **Drill-stack on dashboard.** Identical behavior — breadcrumb, click-in/click-out, leaf routes to `/transactions?...&from=insight:<id>&drill=<crumb-path>&surface=dashboard` (the `surface` param tells the back-pill where to return).
- **Naming clarity (binding).** Distinct from the chatbot pin feature:
  - **"מוצמדות"** = chatbot answers pinned to the bottom of `/insights` (snapshot or live). Stored in `pinned_insight` table.
  - **"תובנות שפורסמו"** = static insight cards the user published from `/insights` to `/`. Stored in `user_layout_preference` (surface=dashboard).
  - Different sources, different tables, different surfaces. Do not let the UI labels collide.
- **Hidden vs unpublished.** Independent state. Hiding an insight on `/insights` does NOT unpublish it from `/`; unpublishing from `/` does NOT hide it on `/insights`. Each surface tracks its own visibility.
- **Excel export.** Per-surface. The Excel export on `/insights` exports `/insights` cards. A future dashboard export (out of scope for v1) would mirror that.

---

## 4. Interaction model

| Action | Behavior |
|---|---|
| Change time window | Re-renders all insight cards. URL updates. Cards that can't compute in window show "טווח קצר מדי לתובנה זו". |
| Click chart wedge / bar (drill-in) | Card's drill stack pushes one level. Breadcrumb updates. Sub-chart cross-fades in (200ms). |
| Click breadcrumb crumb | Drill stack pops back to that level. |
| Click `[← חזור]` | Pops one level. |
| Click `[↻ אפס]` | Resets card to root. |
| Click chart at LEAF level | Routes to `/transactions?...&from=insight:<id>&drill=<crumb-path>`. |
| Click "ask about this" | Opens chat drawer (left). Insight context (incl. current drill path) preloaded into the system prompt for THIS turn only. |
| Click "תקן" on data-quality strip | Scrolls smoothly to the Data Integrity section. |
| Click "תקן" on a Data Integrity card | Routes to the relevant remediation page (`/transactions?unmapped=true`, `/installments?highlight=X`, etc.). |
| Inline "adjust target" on insight #14 | Server action updates `category.monthlyTargetIls`. Toast confirms. Card recomputes. |
| Drag a card by its title bar | Reorders within section. On drop, layout persisted via debounced server action. |
| Resize a card via the `↘` handle | Card resizes within section's grid. On end, layout persisted. |
| Click `[…]` → "הסתר תובנה זו" | Card hidden, moves to "תובנות מוסתרות" list. |
| Click `[…]` → "פרסם ללוח המחוונים" | Toggles publish state. Toast confirms. Card appears in / disappears from the dashboard's "תובנות שפורסמו" section. |
| Click `[↻ איפוס פריסה]` | All cards return to default layout + visibility. Confirmation prompt first. Publish state is preserved (reset only affects layout / hide, not publish). |
| Pin chatbot answer | Opens dialog: snapshot vs live. Persists to a new `pinned_insight` table (see §7). |
| Export Excel | Generates a server-rendered XLSX snapshot of the current `/insights` view at the active window. |

**No global "refresh" button.** Server Components re-fetch on navigation; window changes drive new fetches. The chatbot has its own session state, untouched by Insights interactions.

---

## 5. Visual design direction

### 5.1 Tokens (extracted from existing system, do not invent new)

- Surfaces: `bg-card` for tiles, `bg-muted` for hover/stripe, `bg-subtle` for nested expansion bg.
- Text: `text-foreground` for body, `text-muted-foreground` for captions, `tabular-nums` everywhere numeric (already global).
- Tone colors via `text-{primary,accent,success,warning,destructive}` and matching `*-soft` backgrounds.
- Chart colors: `chart.1` through `chart.7` — already wired in Tailwind. Use `chart.1` for primary series, `chart.2` for accent/secondary, `chart.6` (coral) ONLY for negative deltas, `chart.4` (forest) ONLY for positive when income/savings, `chart.3` (amber) for warnings.
- Radius: `rounded-xl` on insight cards (matches `.tile`), `rounded-md` on inline buttons.
- Density: information-dense — `p-4` on cards (not `p-6`), `gap-3` between cards (not `gap-6`), `text-sm` body, `text-xs` captions, `text-2xs` for legends/timestamps.

### 5.2 Chart-type per insight

| Insight | Chart |
|---|---|
| #1 Unusual transaction | None — text + amount + delta pill. Drilldown: scatter of merchant's history with the outlier highlighted. |
| #2 Recurring drift | Tiny sparkline of the last 6 charges. Drilldown: bar chart per cycle. |
| #3 Phantom subscription | None — text + last-seen-date. Drilldown: list of last 5 transactions to merchant. |
| #4 Recurring lapsed | None — text + expected-by date. |
| #5 Category trend | Tiny sparkline (4 months). Drilldown: full bar chart. |
| #6 MoM spike | Two-bar comparison (this month vs trailing median). Drilldown: stacked sub-category bar. |
| #7 Fixed vs variable | Small stacked area (6 months). Drilldown: full stacked area + pct labels. |
| #8 Data-quality | None — strip with icon + count + link. |
| #8a Untagged | Number + delta vs prior period. Drilldown: list grouped by merchant, then `/transactions?unmapped=true`. |
| #8b Low-confidence | Number + breakdown by `categorySource`. Drilldown: same. |
| #8c Suspicious installments | List (up to 3 worst). No chart. |
| #8d Mis-tagged transfers | List of candidate pairs. No chart. |
| #8e Bad recurring patterns | List with each pattern's last 6 charges as a tiny sparkline showing the violation. |
| #9 Category velocity | Pace line (current vs ideal linear pace). |
| #10 Sub-category drill | Two stacked bars (parent vs children, this month vs last). |
| #11 Concentration | Horizontal bar of top 5 merchants. |
| #12 New merchants | Number + delta pill. Drilldown: list. |
| #13 Income drop/spike | Two-bar comparison + pct. |
| #14 Right-sizing | Number (current target) → number (proposed target) + 4-month bar showing actual. |
| #15 Installment cliff | Timeline (next 6 months, vertical bars per ending plan). |
| #16 Project burn | Progress bar (BudgetProgress reused) + per-month tiny bars. |

### 5.3 States — required for every chart

- **Empty state:** centered icon (lucide), one-line Hebrew explanation, optional CTA. No "אין נתונים" alone — always say *why*.
- **Loading state:** `<AppLoader inline />` (not spinner, not gray pulse). Already standardized app-wide.
- **Error state:** small `AlertCircle` icon + "שגיאה בטעינת הנתונים" + "נסה שוב" button (Server Action that re-runs the loader).

---

## 6. Insights chatbot spec

### 6.1 Integration approach

**Extend, do not fork.** The Insights chatbot IS the existing `ChatDrawer` mounted in `(app)/layout.tsx`. Same drawer, same ⌘K, same ` window.dispatchEvent('fba:open-chat')` event, same SSE stream, same tool-call architecture, same persistence. Insights-page-aware behavior is layered on top via:

1. **Page-context detection.** When the drawer opens, if `usePathname() === '/insights'`, the chat passes `pageContext: 'insights'` to the API. Worker reads it and:
   - Augments the system prompt with an Insights-specific addendum (see §6.4).
   - Swaps the empty-state suggestion chips (see §6.7).
2. **Per-turn context injection.** When the user clicks "ask about this insight" on a card, the click dispatches `fba:open-chat` with a `detail` payload `{ insightId, insightName, currentNumbers }`. The drawer caches this on a one-shot ref and, on the next user message, prepends a `<context>...</context>` block to the user's text so the LLM knows what insight prompted the question. Cleared after one turn so subsequent questions don't drag stale context.
3. **Pin-to-dashboard.** New "📌 שמור לתובנות" button next to the assistant message bubble. Click opens the snapshot/live dialog (see §6.6).

### 6.2 Capability scope (binding)

- Chatbot: **READ + RECOMMEND only.** Does not write to any table. Cannot edit budgets, recategorize transactions, or change settings. Suggestions surface as text the user can act on manually via the existing pages.
- Page (insight cards): **may have writes**, executed via Server Actions, NOT via the LLM. Currently:
  - Insight #14 inline "adjust target" → updates `category.monthlyTargetIls`.
  - Pinning a chatbot answer → inserts into `pinned_insight` table.
  - All other writes (recategorize, edit transaction, etc.) deep-link to existing edit pages.
- This split lets the page be useful while keeping the LLM's blast radius zero. **Hard constraint, do not blur.**

### 6.3 Data-access layer

**Tool / function calling** (already in place), NOT raw-SQL-from-LLM. Justification:

- Tools enforce the household scope at the closure level — the LLM never sees a `householdId` and can't escape it.
- Tool return shapes are deterministic JSON the LLM can rely on; SQL would let the LLM compose queries against secondary tables (e.g. `chat_message`) that should be off-limits.
- Tool result rows are masked (account names → `Account 1` etc.) before they reach the LLM.
- Schema migration safety — adding/removing columns doesn't require LLM retraining.

**New tools to add for Insights** (to support the catalog & narrative summary). Now 12 new tools (was 11; +1 for Data Integrity):

| Tool | Purpose |
|---|---|
| `get_data_quality_status` | Backs both insight #8 and the chat's awareness of data freshness ("does the user have stale imports?"). |
| `get_category_trend` | Returns N monthly buckets with delta direction & magnitude per category. Backs insights #5 and #10. |
| `get_outlier_transactions` | Returns transactions whose amount is ≥K stdev from merchant's history mean. Backs #1. |
| `get_recurring_drift` | Returns active patterns whose latest charge differs from `expectedAmountIls` by ≥Y%. Backs #2. |
| `get_dormant_recurring` | Patterns active per schema but with no non-recurring transactions to merchant in N days. Backs #3. |
| `get_lapsed_recurring` | Patterns whose expected charge for the current cycle hasn't fired. Backs #4. |
| `get_merchant_concentration` | Top N merchants and their share of discretionary spend in window. Backs #11. |
| `get_new_merchants` | Merchants first seen in window vs trailing-period average count. Backs #12. |
| `get_fixed_vs_variable_ratio` | Per-month split. Backs #7. |
| `get_installment_cliffs` | Plans ending within N months and the monthly cash freed. Backs #15. |
| `get_project_burn` | Burn vs target per active project. Backs #16. |
| `get_data_integrity_findings` | Returns the active findings from §2.bis Data Integrity insights (untagged, low-confidence, bad installments, unpaired transfers, bad patterns). Lets the chatbot answer "is my data clean?" / "מה לא תקין בנתונים שלי?" Backs #8a–#8e collectively. |

Existing tools (`query_transactions`, `get_category_summary`, `compare_months`, `get_recurring_patterns`, `get_installment_plans`, `get_anomalies`, `get_predicted_balance`, `find_subscription_candidates`, `search_merchants`) stay unchanged.

### 6.4 System-prompt additions when on `/insights`

Appended to the existing system prompt:

> ## Page context: Insights
> The user is on /insights. This is a discovery surface, not a transactional one.
> - Lean toward findings she could not surface manually: drift, dormancy, outliers, concentration shifts.
> - When she asks an open question ("מה מעניין החודש?"), pick the 2-3 most surprising findings — never repeat dashboard tiles she can already see.
> - If asked "why is X up?" use `get_category_trend` then drill with `query_transactions` to identify the specific transactions or merchants driving the change.
> - When the answer is naturally chartable, describe the chart in words and include drill-down references like `→ /transactions?category=X&month=Y` so the UI can render them as links.
> - End every numeric claim with the source: "(based on N transactions in the last X days)".

### 6.5 Answer format contract (binding)

Every chatbot answer that contains numbers must include:

1. **Bottom-line answer** in plain Hebrew (or English if user wrote English) at the top.
2. **Optional chart or table** when the data benefits.
3. **Drill-down references** as inline `→ /transactions?...` links — the drawer renders these as clickable buttons.
4. **Confidence marker** when inferring rather than reporting (e.g., "ייתכן שזה...").
5. **No invented numbers.** Every cited figure traces to a tool result. If a tool returned no data, the answer says so explicitly. Hallucinated financial figures are a critical bug.

### 6.6 Pin-to-dashboard mechanism

- **Trigger:** "📌 שמור" button next to each assistant message bubble (only assistant messages, not user).
- **Dialog (per the user's mockup):**
  - "שמור תשובה זו למרכז התובנות"
  - ○ הקפאה (snapshot) — frozen text + numbers
  - ● חי (live) — re-runs the most recent tool calls of this turn on each visit
  - [שמור] [בטל]
- **Storage:** new `pinned_insight` table.
  - `id`, `householdId`, `userId`, `chatMessageId` (FK), `mode` (`snapshot`/`live`), `snapshotJson` (text + tool results, only set when mode=snapshot), `toolCallsJson` (the recipe to re-run, only set when mode=live), `displayTitle` (auto-generated from message), `pinnedAt`, `archivedAt`.
- **Render:** at the bottom of `/insights` in a "📌 מוצמדות" section. Live pins re-run tools server-side on page load (cached by tool-call signature for 60s). Each pin has an "unpin" affordance.

### 6.7 Suggested question chips on `/insights`

Replace the universal 5 chips with 8 insights-specific chips when `pageContext === 'insights'`:

1. "מה ההפתעה הגדולה החודש?"
2. "אילו הוצאות קבועות עלו בלי שאשים לב?"
3. "האם יש מנויים שאני לא משתמשת בהם?"
4. "באיזו קטגוריה ההוצאה זוחלת לאט?"
5. "אילו 5 בתי עסק לקחו לי הכי הרבה החודש?"
6. "האם ההכנסות החודש חריגות?"
7. "מה השתנה בקטגוריית האוכל החודשים האחרונים?"
8. "אילו תשלומים לפי תוכניות יסתיימו בקרוב?"

### 6.8 LLM provider

- **Model:** `claude-sonnet-4-6` (already configured via `ANTHROPIC_MODEL_CHATBOT` env var). No change for v1.
- **Why:** the existing chatbot is already on Sonnet and works well. Switching to Opus for Insights would 5× cost; switching to Haiku risks the multi-step tool-use chains failing on harder questions. Sonnet is the right rung.
- **Cost estimate** (assumption: avg turn = 3K input tokens with cached system prompt + 1K output): ≈ $0.012 / turn at current pricing. 100 turns / month = $1.20. Negligible at single-user scale.
- **Latency expectation:** first text token within 1.5s, complete answer with 2 tool calls within 6s. Streaming covers the perceived wait.
- **Fallback:** existing error handling shows the user a friendly message ("יתרת הקרדיט נמוכה") if the API fails. No automatic provider failover for v1.

### 6.9 Hallucination & safety

- Tool-call architecture is the primary defense. The LLM's reasoning happens in text, but every cited figure must trace to a `tool_result` block in the same turn.
- The system prompt explicitly says "never invent UUIDs" and "always pass real category IDs." Reaffirmed for Insights.
- Add a post-response sanity check (Phase D, deferred but specced): a worker-side regex scans the LLM's final text for `₪[\d,.]+` figures and verifies each appears in at least one tool-result JSON of the same turn. If not, append a system warning to the message stored in DB (not shown to user) and log to `chat_tool_call_log.error`. Used for offline auditing — does not block the response.
- Explicit "I don't know" behavior: when a tool returns 0 rows, the LLM says "אין לי נתונים לתקופה הזו" and does NOT guess from adjacent periods unless explicitly asked.

### 6.10 Privacy

- LLM provider receives: masked account names (`Account 1`, etc.), category names (Hebrew), merchant names (normalized), amounts in ILS, transaction dates/billing months. No raw account numbers, no user real name (only `userDisplayName` if provided), no email.
- Already implemented via `buildAccountMask()` in `tools/handlers.ts` — applies to all tool results.
- Anthropic API retention: per their default policy (30 days for abuse monitoring; not used for training when you opt out). Document in app's privacy log (`/admin/privacy` already exists).
- Insights does not change this surface area.

### 6.11 Conversation state

- Per the user's bucket-G choice: **continue existing session.** No fresh thread per insight click. The `pageContext` and per-turn insight context are transient and don't fragment the conversation.
- Persistent across sessions (already implemented). "New chat" button continues to work as the explicit reset.

---

## 7. Technical plan

### 7.1 New components (apps/web/src/components/insights/)

- `data-quality-strip.tsx` — Server Component, always-on banner; clicking scrolls to the Data Integrity section.
- `time-window-selector.tsx` — Client island, URL-driven, MTD/30D/90D/Custom (with date pickers).
- `narrative-summary-card.tsx` — Server Component that calls a one-shot LLM endpoint with the same tool layer; cached per (household, window) for 1 hour via `unstable_cache`.
- `insight-card.tsx` — Generic shell (label, value, sparkline slot, action row, drag handle, resize handle, hide menu). Reused by all insights. **Holds the drill-stack state** (array of filter levels) and the breadcrumb renderer.
- `insight-card-breadcrumb.tsx` — Client component, renders `הכל › מזון › מסעדות` with each crumb clickable.
- `insight-section.tsx` — Wrapper for each section header. Hosts the `react-grid-layout` instance for its section's cards.
- `insights-grid.tsx` — Client component wrapping `react-grid-layout`. Reads layout from `user_layout_preference`, persists changes via debounced server action.
- `mobile-reorder-sheet.tsx` — Bottom sheet for mobile reorder via sortable list (no resize).
- `hidden-insights-list.tsx` — Collapsed list at bottom of the page; click to restore.
- `published-insights-section.tsx` — Server Component mounted at the bottom of `/` (the dashboard). Reads the user's `user_layout_preference` row for `surface='dashboard'`, renders the published cards via the same `react-grid-layout` infra as `/insights`. Empty state when no insights published.
- `publish-toggle-menu-item.tsx` — Tiny client island for the `[…]` menu's "פרסם ללוח המחוונים" toggle. Calls a server action.
- `pinned-insights-section.tsx` — Renders `pinned_insight` rows. Live ones re-run tools on the server; snapshots render the stored JSON.
- `pin-dialog.tsx` — Client component, opens from chat drawer. Calls a server action to persist.
- `export-button.tsx` — Client island that triggers the Excel server endpoint and downloads the resulting file.

Each insight gets its own thin component file in `apps/web/src/components/insights/cards/` (e.g. `card-unusual-transaction.tsx`, `card-recurring-drift.tsx`, etc.) — small files, single responsibility, import the shared `insight-card.tsx` shell.

### 7.2 New server actions / API routes

- `app/(app)/insights/actions.ts` — `updateCategoryTarget`, `pinInsight`, `unpinInsight`, `archivePinnedInsight`, `publishInsightToDashboard`, `unpublishInsightFromDashboard`, `updateLayout`, `resetLayout`, `hideInsight`, `showInsight`.
- `app/api/insights/narrative/route.ts` — POST endpoint that returns the narrative summary (streamed). Uses the existing chatbot agent with a fixed prompt; rate-limited to 1 call per (household, window) per hour via cache.
- `app/api/insights/export/xlsx/route.ts` — generates an XLSX with one sheet per section using `exceljs`.

### 7.3 Schema changes

Two new tables:

```ts
// packages/db/src/schema/insights.ts
export const pinnedInsights = pgTable('pinned_insight', {
  id: uuid().defaultRandom().primaryKey(),
  householdId: uuid().notNull().references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  chatMessageId: uuid().references(() => chatMessages.id, { onDelete: 'set null' }),
  mode: text({ enum: ['snapshot', 'live'] }).notNull(),
  displayTitle: text().notNull(),                 // auto-generated, user-editable
  snapshotJson: jsonb(),                          // populated when mode=snapshot
  toolCallsJson: jsonb(),                         // populated when mode=live: [{name, args}]
  pinnedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp({ withTimezone: true }),
}, (t) => ({
  householdIdx: index().on(t.householdId, t.pinnedAt),
}));

export const userLayoutPreferences = pgTable('user_layout_preference', {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  surface: text({ enum: ['insights', 'dashboard'] }).notNull(),
  // layoutJson shape per surface:
  //   insights:  { sections: { risk: { items: [{ id, x, y, w, h }] }, integrity: {...}, ... } }
  //   dashboard: { items: [{ id, x, y, w, h }] }   // single section, no internal grouping
  layoutJson: jsonb().notNull(),
  hiddenInsightIds: jsonb().notNull().default([]),  // surface='insights' only — IDs hidden from /insights
  publishedInsightIds: jsonb().notNull().default([]),// surface='dashboard' only — IDs published to /
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userSurfaceUnique: unique().on(t.userId, t.surface),
}));
```

Two rows per user once both surfaces are in use: one `surface='insights'` (manages /insights layout + hidden state), one `surface='dashboard'` (manages published-to-dashboard list + their layout in the dashboard's "תובנות שפורסמו" section). The publish toggle on a card writes to the dashboard row's `publishedInsightIds`. The unique key prevents duplicate rows per (user, surface).

Optional but cheap: write to the existing `monthly_snapshot.anomaliesJson` column when an insight detects an anomaly, so the chatbot's `get_anomalies` tool surfaces them. Already-modeled, no migration needed. Same pattern works for the new Data-Integrity insights — write detected issues to `anomaly` table with new `kind` enum values: `untagged`, `low_confidence_categorization`, `bad_installment`, `unpaired_transfer_candidate`, `bad_recurring_pattern`. Adds 5 enum values to the existing `anomaly.kind` column — one cheap migration.

### 7.4 Aggregation strategy

| Insight tier | Strategy |
|---|---|
| Per-page-load (cheap) | Insights #5 (trend), #6 (MoM spike), #11 (concentration), #12 (new merchants), #13 (income), #16 (project burn) — direct Drizzle aggregations, ~5-10 queries total. <300ms. |
| Per-page-load (medium) | Insights #1 (outlier z-score), #2 (drift), #7 (fixed/variable). Requires a CTE or a JS post-aggregation. <500ms. |
| Cached on `monthly_snapshot` | Insights #5, #6, #7 results stored in `monthly_snapshot.byCategoryJson` and `anomaliesJson` when a billing month closes. Reads from snapshot for past months, recomputes only for the current month. |
| Worker-side detector | Insights #1, #2, #3, #4 also written to `anomaly` table by a nightly worker job (so the chatbot's `get_anomalies` tool surfaces them too). Phase B+. Until then, computed inline. |

**Performance budget:** `/insights` page TTFB ≤ 800ms server-side, full hydration ≤ 2s on cold cache, ≤ 500ms on warm cache. Monitored via existing Next.js logging.

### 7.5 Chatbot backend changes

- Add 11 new tool definitions and handlers (§6.3). Each follows the existing pattern in `packages/chatbot/src/tools/{definitions,handlers,schemas}.ts`.
- Extend `buildSystemPrompt()` to accept `pageContext?: string` and append the addendum from §6.4 when set.
- Extend `/api/chat` and the worker `/chat` endpoint to forward `pageContext` and per-turn `insightContext` from the request body.
- Extend `ChatDrawer` to listen for `fba:open-chat` events with a `detail` payload and cache the `insightContext` for one turn.

### 7.6 Excel export

- **Library:** `exceljs` (~1MB), server-side. No browser automation, no headless Chromium, no Playwright bloat.
- **File structure:** one sheet per section of the page (`דחוף`, `אמינות הנתונים`, `מגמות`, `דפוסים`, `מעקב`, `מוצמדות`). Inside each sheet, one block per insight: title row, source-period row, the data table that backs the insight (e.g. for category trend: 4 columns of monthly totals + delta).
- **Formatting:** ILS cells use `'#,##0 "₪"'` Excel format (matches `formatIls(... { decimals: false })`). Dates use Israeli locale (`dd/mm/yyyy`). Hebrew text rendered RTL via cell `alignment: { readingOrder: 'rtl' }`.
- **Filename:** `תובנות_<window>_<YYYY-MM-DD>.xlsx` (e.g. `תובנות_30D_2026-05-08.xlsx`).
- **Drill state:** the export uses each card's CURRENT drill level (so if you've drilled into Food → Restaurants, that sheet exports the merchant-level table, not the top-level category table). Predictable: WYSIWYG.
- **Hidden cards:** excluded from export (matches the page).
- **Performance:** generation runs server-side, streams as `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. ~21 cards × small data tables = sub-second generation, no caching needed.

PDF export is **explicitly out of scope** per user decision (see §10).

### 7.7 Performance budget

| Surface | Target | Strategy |
|---|---|---|
| `/insights` initial render | TTFB ≤ 800ms | Server Component aggregations parallelized with `Promise.all`. |
| Time-window change | < 1s perceived | Client routes through with `router.push` + Server Component re-render. |
| Inline expansion | < 100ms | All data already loaded; toggle only. |
| Drill to `/transactions` | < 1.5s | Existing page perf, no Insights-specific work. |
| Chatbot answer | First token ≤ 1.5s, complete ≤ 6s | Existing Sonnet streaming, system prompt cached. |
| Narrative summary | First token ≤ 1.5s, complete ≤ 4s, served from cache for 1hr | `unstable_cache` with key=(household, window). |

---

## 8. Phased implementation plan

**Eight phases**, each independently shippable. After each, I show what landed, what's next, wait for go-ahead. Restructured to accommodate the BI drill-stack (foundational, lives in Phase A), the Data Integrity sub-section (Phase A), layout customization (Phase F), and publish-to-dashboard (Phase H — depends on Phase F's grid infra).

### Phase A — Data aggregation layer + 13 P0 insight cards + drill-stack model

**Scope:** Build all 13 P0 insight cards (8 spending + 5 data-integrity), the data-quality strip, the time-window selector, AND the BI drill-stack interaction model. Drill-stack is foundational — every chart-based card relies on it from day one. No layout customization yet; cards render in fixed default order.

**Deliverables:**
- Replace `apps/web/src/app/(app)/insights/page.tsx` with the new layout.
- Build `time-window-selector.tsx`, `data-quality-strip.tsx`, `insight-card.tsx` (incl. drill-stack state + breadcrumb slot), `insight-card-breadcrumb.tsx`, `insight-section.tsx`.
- 13 P0 insight card components (8 spending + 5 data-integrity) under `components/insights/cards/`.
- 13 server-side aggregation functions in `app/(app)/insights/queries.ts` (each takes a `drillPath: string[]` to compute the right level).
- Cross-fade transition between drill levels (200ms, new keyframe in tailwind config).
- Migration: add 5 new enum values to `anomaly.kind`.
- Skeleton + empty + error states for each card (per §5.3).

**Out of phase:** drill-down out-route to `/transactions` + back-pill (Phase B), layout customization (Phase F), all P1 insights, chatbot integration, pinning, exports, narrative summary.

### Phase B — Drill-out routes + back-pill

**Scope:** Wire up the leaf-level routes to `/transactions` and the return path.

**Deliverables:**
- "drill at leaf" routes from cards → `/transactions?...&from=insight:<id>&drill=<crumb-path>`.
- `/transactions` reads `from=insight:xyz&drill=...` and renders a "← חזרה לתובנה" pill.
- Returning via the pill restores the source card at the same drill depth.
- Inline "adjust target" affordance for #14 — pulled forward as the test case for page-level write actions.
- Hide-card menu (`[…] → הסתר תובנה זו`) and "תובנות מוסתרות" list at bottom (uses transient localStorage until Phase F adds the full layout schema).

### Phase C — Filters + remaining P1 insights

**Scope:** Custom date-range picker; insights #9, #10, #11, #12, #13, #15, #16.

**Deliverables:**
- Custom date-range modal in the time-window selector.
- 7 new aggregation functions, 7 new insight cards (each with drill-stack metadata).
- Per-card empty states tuned to short windows ("טווח קצר מדי...").

### Phase D — Insights chatbot integration

**Scope:** Make the existing chatbot context-aware on `/insights`. No write actions.

**Deliverables:**
- Add 12 new tools (§6.3) — definitions, schemas, handlers.
- Extend `buildSystemPrompt` with page-context support and the §6.4 addendum.
- Extend `/api/chat` and worker `/chat` to forward `pageContext` and per-turn `insightContext` (incl. current drill path of the source card).
- Extend `ChatDrawer` to inject insight context on `fba:open-chat` with detail.
- Swap suggestion chips when on `/insights` (the 8 from §6.7).
- "שאל על תובנה זו" button on each insight card.

### Phase E — Pin-to-dashboard + AI narrative summary

**Scope:** Persistence + the optional narrative card.

**Deliverables:**
- New `pinned_insight` table + Drizzle schema + migration.
- `pin-dialog.tsx`, `pinned-insights-section.tsx`.
- Pin button in chat drawer for assistant messages.
- Live pin re-runs tools server-side (parallel + 60s cache); snapshot renders stored JSON.
- `narrative-summary-card.tsx` + `/api/insights/narrative` route + `unstable_cache` (1 hour by household+window).

### Phase F — Layout customization (drag, drop, resize, persist)

**Scope:** Everything from §3.4. Most behavior-changing phase after A.

**Deliverables:**
- New `user_layout_preference` table + Drizzle schema + migration.
- Add `react-grid-layout` dependency (~70KB gzipped).
- `insights-grid.tsx` wrapping `react-grid-layout` per section.
- Server actions: `updateLayout`, `resetLayout`, `hideInsight`, `showInsight`.
- Mobile: `mobile-reorder-sheet.tsx` (sortable list, no resize).
- Drag handle on card title bar; resize handle on hover (`↘` glyph in bottom-end corner).
- Migrate the temporary localStorage-based hide state from Phase B into the `hiddenInsightIds` jsonb column.
- `[↻ איפוס פריסה]` button at bottom with confirmation.

### Phase G — Publish insight to main dashboard

**Scope:** Everything from §3.5. Lets the user promote any insight from `/insights` to a "תובנות שפורסמו" section on the dashboard at `/`.

**Deliverables:**
- Reuse existing `user_layout_preference` table — add second row per user with `surface='dashboard'`, `publishedInsightIds`, layout for the dashboard region.
- Schema patch: tighten `surface` to `enum: ['insights', 'dashboard']`. Add `publishedInsightIds` jsonb column (single migration).
- Server actions: `publishInsightToDashboard`, `unpublishInsightFromDashboard`.
- New `[…]` menu item: "פרסם ללוח המחוונים" (toggle with ✓ when published).
- New `published-insights-section.tsx` Server Component mounted at the bottom of `/` (the dashboard at `apps/web/src/app/(app)/page.tsx`).
- Reuse `insights-grid.tsx` from Phase F — single section, drag/resize within it.
- Drill-stack works identically on dashboard (same components). Leaf-level routes carry `&surface=dashboard` so the back-pill returns to `/` not `/insights`.
- Empty state on dashboard when no insights published.
- Each published card respects the dashboard's existing `MonthSwitcher` for time window — NOT the `/insights` selector.

**Out of phase:** dashboard-side Excel export (out of scope for v1 entirely), dragging published insights INTO existing dashboard widgets above the section (the section is a closed region by design — see §3.5).

### Phase H — Polish, motion, accessibility, mobile, exports

**Scope:** Everything else. Final polish phase. Covers BOTH `/insights` and the published-insights section on `/`.

**Deliverables:**
- Excel export via `exceljs` per §7.6 (covers `/insights` only — dashboard export out of scope).
- Mobile fine-tuning: card density, time-window selector → bottom sheet, drill-stack chart taps tuned for thumbs. Applies to both surfaces.
- Keyboard nav: tab through cards, Enter to drill in, Backspace to drill out, Esc to drill out to root. Both surfaces.
- ARIA labels on every chart (Recharts has `role="img"` + `aria-label`).
- Breadcrumb is a proper `<nav aria-label="drill path">` with each crumb a `<button>`.
- Color-blind friendly delta indicators (always pair color with arrow icon).
- Subtle motion: card expansion uses `transition-[max-height]` with `cubic-bezier(0.16, 1, 0.3, 1)` (already in tailwind config), 250ms. Drag/drop motion uses `react-grid-layout`'s built-in physics, tuned to 200ms.
- Final design review against Copilot Money / Monarch mockups (Phase H kickoff: build the two style mocks, user picks). Mockups cover the published-insights section visual treatment too.

---

## 9. Open questions & risks

1. **⌘K shortcut collision** — `GlobalHeader` (command palette) and `ChatDrawer` both bind ⌘K. Pre-existing bug, surfaces more on `/insights` since the page text says "press ⌘K." Not in scope but should be fixed before Phase D ships.
2. **Cold-start sparseness with 4 months of data.** Spec says strict mode (Option A). If post-Phase A the page feels sparse, we flip to transparent mode (Option B) with a "מהימנות נמוכה" pill — code path designed in but disabled.
3. **AI narrative summary cost.** $0.012/load × N visitors/day × 30 days. Single-user app: trivial. If turned multi-tenant later, needs per-household rate limiting — add to spec but defer implementation.
4. **Insight #14 (right-sizing) write action and chatbot read-only stance.** Spec is clear that page-writes are OK and chatbot is not. Reaffirm at code review for Phase B that the insight-card's "adjust target" affordance is a Server Action, NOT routed through the chatbot agent.
5. **Live-pin recomputation cost.** A user with 20 live pins triggers 20 tool calls on every `/insights` visit. Mitigation: pin re-execution is parallelized + cached for 60s. If still too slow, force live pins to also cache for 5min (with "last refreshed" timestamp).
6. **Fixed-vs-variable ratio depends on the recurring-pattern detector being current.** If patterns are stale, the ratio is wrong. The data-quality strip should include "pattern detector last ran" so this is visible.
7. **Drill-stack URL-encoding for shareability.** v1 keeps drill state local to the card (refresh resets). Pro: simple, no URL bloat with 21 cards each at depth 0–3. Con: can't share or bookmark "the dining trend drilled into Pizza Hut." Decision deferred to post-Phase A: ship local-state first, evaluate whether URL-encoding is worth the complexity (probably not — most users will drill, look, drill back; sharing is a rare path).
8. **`react-grid-layout` and RTL.** The library supports RTL via the container's `dir` attribute, but resize handles assume LTR by default (handle is bottom-right; in RTL we want bottom-left). Phase F will need a thin patch (CSS override + a custom handle component). Pre-validated but flagged as a known gotcha.
9. **Drill-stack vs drag-drop interaction.** When a user is mid-drill on a card, dragging it to a new layout position must preserve drill state. Tested mentally: state lives in component state which survives DOM moves within the same `react-grid-layout` instance. Should Just Work, but flag for QA in Phase F.
10. **Data-Integrity insights showing 0 issues.** When the data is clean (the happy path the user wants to reach), each Data Integrity card would show "0" which feels like dead space. Resolution: when a Data Integrity card has 0 findings, render a small green check + "תקין" badge instead of a count + drill button. Section becomes a row of green badges when everything's clean — visually rewarding the user for clean data.
11. **Published-insight performance on `/`.** Each published card runs its own server-side aggregation on dashboard load. With 21 insights all published × every dashboard visit, this could meaningfully slow the dashboard. Mitigations: (a) the dashboard already uses `force-dynamic` so we add insights to its existing parallel `Promise.all`; (b) cap published insights at a reasonable max (default 6, configurable later) — the section's "publish" button refuses past the cap with a clear message; (c) the `monthly_snapshot` cache layer planned for §7.4 will absorb most of the cost when the dashboard is showing a closed past month. Flag to revisit after Phase G ships.

---

## 10. Out of scope for v1 (explicit, by user decision)

- ❌ Specific financial product recommendations (chatbot already refuses; reaffirmed).
- ❌ Multi-currency analysis (everything treated as ILS).
- ❌ Email / push notifications for risk alerts (insights live in-app only).
- ❌ Custom user-defined insights / rule builder.
- ❌ YoY comparisons (unlocks at month 12+ — flagged for future).
- ❌ Behavioral nudges / "quiet wins" cards.
- ❌ Cash-flow runway / EOM forecast as static cards (chatbot only).
- ❌ Savings-goal pacing as static cards (chatbot only).
- ❌ Day-of-week / time-of-month spending pattern cards.
- ❌ Family-member breakdowns (single-user app).
- ❌ Dark mode (deferred until a global theme toggle exists).
- ❌ **PDF export** — Excel only. No headless-Chromium / Playwright dependency. Per user decision in this revision.

**In scope (the user explicitly kept these in):**
- ✅ Page-level write actions (edit budget targets, recategorize transactions inline).
- ✅ Excel (XLSX) export via `exceljs` — one sheet per section, ILS / Hebrew / RTL formatted.
- ✅ AI narrative summary at top of page.
- ✅ Inline transaction edits from insight drill-downs (via `/transactions` deep-link, not from the LLM).

**In scope (added in this revision per follow-up):**
- ✅ Drag, drop, resize for insight cards on desktop. Persistent per-user. Mobile: sortable list, no resize.
- ✅ Data-Integrity anomaly insights (5 P0 cards): untagged, low-confidence categorizations, suspicious installments, mis-tagged transfers, bad recurring patterns.
- ✅ BI-tool drill-stack with breadcrumbs on every chart-based card. Click in to descend, breadcrumb crumbs to climb back. Leaf-level drill routes to `/transactions` with crumb-path preserved.
- ✅ **Publish insight to main dashboard.** Per-card toggle in the `[…]` menu. Published insights render in a dedicated "תובנות שפורסמו" section at the bottom of `/`, with the same drill-stack behavior. Each surface owns its own time-window (dashboard `MonthSwitcher` vs `/insights` selector). Default cap of 6 published insights to protect dashboard performance (configurable later).

---

*End of spec. Awaiting Phase 2 review before any code is written for Phase 3.*
