# Family Budget App — Design Context for Claude Design / AI Design Tools

> **Upload this single file** to give an AI design tool full context about the existing app:
> layout, color tokens, typography, component inventory, pages, and RTL/Hebrew requirements.

---

## 1. App Overview

A **self-hosted family budget web app** used by two Hebrew-speaking adults (husband + wife).
It replaces a manual Hebrew Excel spreadsheet with a web UI.

- Language: **Hebrew (עברית), RTL layout** — right-to-left reading direction throughout
- Currency: **₪ ILS (Israeli New Shekel)**
- Data density: **high** — users want to see as much data as possible without scrolling
- Tone: **calm banking app** — trustworthy, not flashy. Think bank dashboard, not fintech startup.

---

## 2. Tech Stack (for implementation context)

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript |
| Styling | Tailwind CSS + CSS custom properties (HSL tokens) |
| Components | shadcn/ui (Radix primitives) |
| Icons | Lucide React |
| Charts | Recharts |
| Font | **Heebo** (Google Fonts) — a clean Hebrew-first sans-serif |
| Direction | RTL (`dir="rtl"`) on `<html>`, confirmed throughout |

---

## 3. Current Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  GLOBAL HEADER (sticky, full-width)                  │
│  [Logo] [Search ⌘K] ........... [User avatar]        │
├──────────────┬──────────────────────────────────────┤
│  SIDEBAR     │  MAIN CONTENT                        │
│  (w-64,      │  (max-w-7xl, px-4..8, py-5..8)       │
│  desktop     │                                      │
│  only,       │  Page content renders here           │
│  bg-card,    │                                      │
│  border-l)   │                                      │
│              │                                      │
│  [Nav items] │                                      │
│              │                                      │
│  [Username]  │                                      │
├──────────────┴──────────────────────────────────────┤
│  MOBILE BOTTOM NAV (md:hidden)                       │
└─────────────────────────────────────────────────────┘
│  CHAT DRAWER (fixed, slides in from left, z-50)      │
│  Always available via ⌘K / Ctrl+K                    │
└─────────────────────────────────────────────────────┘
```

**Note: Sidebar is on the RIGHT visually in RTL** — `border-l` in LTR code becomes the right border in RTL rendering.

---

## 4. Navigation Items (Sidebar)

### Main
- לוח מחוונים (Dashboard)
- תנועות (Transactions) ← most-used page
- יום-יום (Day-by-day grid)
- ייבוא תבנית (Import template)
- ייבוא בנק/אשראי (Bank import)
- הוצאות קבועות (Recurring expenses)
- תשלומים (Installment plans) ← just built
- חיסכון ויעדים (Savings & goals)
- תובנות (Insights)
- היסטוריה (History)

### Settings group
- קטגוריות (Categories)
- חשבונות (Accounts)
- כללי קטגוריזציה (Categorization rules)
- היסטוריית ייבוא (Import history)
- יומן ביקורת (Audit log)
- יומן פרטיות (Privacy log)
- סיסמה (Password)

---

## 5. Design Tokens — Colors

### Light Mode (default)

| Token | HSL | Approx Hex | Usage |
|---|---|---|---|
| `--background` | 210 33% 99% | `#F9FAFB` | Page background |
| `--foreground` | 218 30% 12% | `#151D2E` | Body text |
| `--card` | 0 0% 100% | `#FFFFFF` | Card surfaces, table bg |
| `--card-foreground` | 218 30% 12% | `#151D2E` | Text on cards |
| `--muted` | 215 25% 96% | `#EFF1F6` | Table headers, muted bg |
| `--muted-foreground` | 215 14% 42% | `#617083` | Secondary text, labels |
| `--subtle` | 215 25% 98% | `#F5F6FA` | Row hover, stripe |
| `--primary` | 215 65% 30% | `#193D7A` | Primary buttons, active nav |
| `--primary-foreground` | 210 40% 98% | `#F5F9FE` | Text on primary bg |
| `--primary-soft` | 215 50% 92% | `#D4E2F5` | Tinted primary bg |
| `--accent` | 175 55% 35% | `#267C74` | Links, chat drawer, callouts |
| `--accent-foreground` | 210 40% 98% | `#F5F9FE` | Text on accent |
| `--accent-soft` | 175 45% 92% | `#D3EEEc` | Tinted accent bg |
| `--success` | 145 50% 30% | `#246B3C` | Income, on-budget |
| `--success-soft` | 145 40% 92% | `#D3EDDE` | Income row tint |
| `--warning` | 35 80% 45% | `#CC8210` | Approaching budget limit |
| `--warning-soft` | 35 80% 94% | `#FEF3E0` | Warning bg tint |
| `--destructive` | 358 65% 45% | `#BF1E22` | Over budget, errors, delete |
| `--destructive-soft` | 358 65% 96% | `#FEECEC` | Error bg tint |
| `--border` | 215 22% 90% | `#DDE2EC` | Default borders |
| `--border-strong` | 215 22% 80% | `#BFC8D9` | Emphasized borders |
| `--ring` | 215 65% 50% | `#2E64BF` | Focus ring |

### Dark Mode

| Token | HSL | Approx Hex |
|---|---|---|
| `--background` | 218 25% 9% | `#111720` |
| `--foreground` | 210 25% 96% | `#F1F4F8` |
| `--card` | 218 22% 12% | `#171E2B` |
| `--primary` | 215 70% 65% | `#5E96E8` |
| `--accent` | 175 55% 55% | `#3DB5AB` |
| `--success` | 145 50% 55% | `#4EAD71` |

### Chart Palette (7 colors)

| Name | HSL | Usage |
|---|---|---|
| chart-1 | 215 65% 35% | Primary blue |
| chart-2 | 175 50% 38% | Teal |
| chart-3 | 35 70% 50% | Amber |
| chart-4 | 145 40% 38% | Forest green |
| chart-5 | 280 35% 45% | Deep purple |
| chart-6 | 358 55% 50% | Coral |
| chart-7 | 195 50% 40% | Sky |

---

## 6. Typography

- **Font family:** Heebo (Google Fonts) — Hebrew-first, modern, very legible at small sizes
- **Body:** 14px (`text-sm`), line-height 1.5
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere (finance app requirement)
- **Headings:** `font-semibold`, sizes from `text-base` to `text-2xl`
- **Small labels:** `text-xs` (12px) for metadata, badges, table headers
- **Micro text:** `text-2xs` = 11px for dense badges

---

## 7. Spacing & Shape

- **Border radius:** `--radius: 0.625rem` (10px) default; `md` = 8px; `sm` = 6px; `xl` = 12px; `2xl` = 16px
- **Card padding:** `p-4` (16px) standard, `p-5` (20px) for modals
- **Table cells:** `px-3 py-2` (12px / 8px)
- **Tile (KPI card) padding:** `p-4` with `rounded-xl border bg-card`
- **Button height:** 40px minimum tap target (`min-height: 2.5rem`)
- **Sidebar width:** 256px (`w-64`)
- **Max content width:** 1280px (`max-w-7xl`)

---

## 8. Core Component Patterns

### KPI Tile
```
┌─────────────────────┐
│ 🏷 Label text (xs)  │
│                     │
│ ₪12,450  (2xl bold)│
│                     │
│ Sub-label (11px)    │
└─────────────────────┘
rounded-xl border bg-card p-4
```

### Section Header (in table — groups transactions)
```
┌─────────────────────────────────────────────┐
│ 🕐 יחויב ב-10/05 · ימים 1–10  [4]  הוצאות: ₪470  הכנסות: ₪1,000 │
└─────────────────────────────────────────────┘
Amber bg for current cycle, Blue bg for next cycle
```

### Status Badge (pill)
- **פעיל** (active): primary/10 bg + primary text + Clock icon
- **הושלם** (complete): success/10 + success text + CheckCircle icon
- **בוטל** (cancelled): muted bg + muted text + XCircle icon

### Progress Bar (installment plans)
```
[████████░░] 8/10
```
Height: 6px, rounded-full, primary fill, muted bg

### Dual-Cycle Banner (transactions page)
```
┌─────────────────────┬───────────────────────┐
│ ⏰ יחויב ב-10 במאי  │ 📅 חיוב הבא — 10 ביוני│
│ (עוד 7 ימים)        │                       │
│ הוצאות: ₪770        │ הוצאות: ₪1,220        │
│ הכנסות: ₪1,000      │ 3 עסקאות              │
│ 5 עסקאות            │                       │
└─────────────────────┴───────────────────────┘
Amber/green for current, Blue for next
```

---

## 9. Page Inventory

### `/` — Dashboard (לוח מחוונים)
KPI tiles row + charts + anomalies + predicted balance

### `/transactions` — Transactions (תנועות)
- **Month switcher** (prev/next arrows) at top right
- **Dual-cycle banner** (below add-form)
- **Add transaction form** (collapsible form at top)
- **Table with 3 groups:**
  1. מחודש קודם — אותו חיוב (carry-over from prev month, bills this cycle)
  2. יחויב ב-10/05 · ימים 1–10 (current cycle)
  3. חיוב הבא — 10/06 · ימים 11+ (next cycle)
- **Columns:** Date | Merchant | Account | Source | Category | הוצאה (expense) | הכנסה (income) | Notes | Actions

### `/installments` — Installments (תשלומים)
- 4 KPI tiles (monthly commitment, total remaining, completed count, soonest ending)
- Filter tabs: הכל / פעיל / הושלם / בוטל
- Table with progress bar per row
- Add/Edit modal

### `/recurring` — Recurring Expenses (הוצאות קבועות)
Fixed monthly charges: mortgage, subscriptions, insurance

### `/savings` — Savings & Goals (חיסכון ויעדים)
Goal cards with progress

### `/grid` — Day-by-Day Grid (יום-יום)
Rows = days 1–31, Columns = categories. Like the Excel table.

### `/insights` — Insights (תובנות)
Anomaly detection, MoM comparison, subscription suggestions

### `/history` — History (היסטוריה)
Past months as tiles

---

## 10. RTL / Hebrew Requirements — CRITICAL

1. **All text is right-to-left.** The reading eye starts from the RIGHT side.
2. **`dir="rtl"` on `<html>`** — Tailwind's `ms-` (margin-start) = margin-right in RTL, `me-` = margin-left.
3. **Sidebar is on the RIGHT** in the visual layout (even though code says `left`).
4. **Chevrons are flipped** — `ChevronRight` points LEFT in RTL navigation (back), `ChevronLeft` points RIGHT (forward).
5. **Amount columns align RIGHT** — numbers flow from right. Minus sign appears on the right of the number: `-₪300`
6. **Table columns** read right-to-left: Date (right-most) → Merchant → ... → Amount (left area) → Actions (left-most).
7. **Form fields** label on the right, input grows to the left.
8. **No purely English UI** — all labels, buttons, headers in Hebrew.

---

## 11. Current Pain Points / Redesign Goals

These are the known UX issues to address:
- The transactions table is **data-dense** but could use clearer visual hierarchy between the 3 groups
- The **billing cycle concept** (10th of month cutoff) needs to be more visually prominent — users need to instantly see "what charges this month" vs "what charges next month"
- **Month navigation** should feel more like a calendar navigation
- **Amount columns** (הוצאה/הכנסה side-by-side) need to be visually distinct — green for income, default for expense
- The **add transaction form** collapses poorly on mobile
- **Installment progress** could use a more visual timeline approach

---

## 12. Design Inspirations / References

- **Tone:** Like a calm Israeli bank app (Discount, Hapoalim) — conservative, data-first
- **Density:** Like Bloomberg terminal or a finance spreadsheet — information maximalist
- **Cards:** Like Notion or Linear — clean card surfaces with subtle borders
- **Hebrew typography:** Heebo is already correct. Avoid fonts that don't support Hebrew.

---

*Generated from live codebase — `apps/web/tailwind.config.ts`, `apps/web/src/app/globals.css`, `apps/web/src/app/(app)/layout.tsx`*
