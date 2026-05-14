# Family Budget App — Brand Book

> The authoritative design system for the app. Everything here is implemented in
> `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`, and the
> `apps/web/src/components/ui/*` shared components. When designing or editing a
> page, this document is the source of truth — if you find code that diverges,
> fix the code, not the doc.
>
> Last brand-book revision: 2026-05-12 (Phase 1–3 of the V5א "גוונים אמיתיים"
> design system migration).

---

## 0. Brief

A self-hosted Hebrew family budget app for two adults. Hebrew RTL throughout.
The visual identity is **calm production-banking palette** in a **soft, rounded
container system**. Every screen should feel:

- **Trustworthy** — banking-app calm, not fintech-startup loud
- **Soft** — generous radius, pill buttons, tonal-soft tints
- **Information-dense but scannable** — high data per screen, but with
  hierarchy provided by colored icon-badges, eyebrow labels, and tone-soft cards
- **Hebrew-first** — RTL is the default reading direction, never an
  afterthought. Logical properties (`ms-`, `me-`, `inset-inline-start`) are
  preferred over physical (`ml-`, `mr-`, `left`).

---

## 1. Color tokens

All colors live as HSL CSS custom properties on `:root` in `globals.css` and
are exposed to Tailwind via `tailwind.config.ts`. **Never hard-code a hex** in
component code — use the semantic token. Three reasons: dark-mode swap,
brand-wide tweaks in one place, and accessibility audits.

### Surfaces
| Token | HSL | Hex | Use |
|---|---|---|---|
| `--background` | `210 33% 99%` | `#fbfcfe` | Page bg (cool near-white) |
| `--foreground` | `218 30% 12%` | `#16202c` | Body text, KPI numbers (neutral tone) |
| `--card` | `0 0% 100%` | `#ffffff` | Card / tile surface, modal bg |
| `--card-foreground` | `218 30% 12%` | `#16202c` | Text on card |
| `--muted` | `215 25% 96%` | `#eff1f6` | Table header bg, subtle fills |
| `--muted-foreground` | `215 14% 42%` | `#617083` | Secondary text, labels, captions |
| `--subtle` | `215 25% 98%` | `#f5f6fa` | Row hover stripe |
| `--border` | `215 22% 90%` | `#dde2ec` | Default card / input border |
| `--border-strong` | `215 22% 80%` | `#bfc8d9` | Emphasized borders |

### Semantic tones — six tones, each with `-soft` variant for backgrounds
| Tone | Token | HSL | Hex | Meaning |
|---|---|---|---|---|
| **primary** | `--primary` | `215 65% 30%` | `#193d7a` | Cumulative position, neutral high-level numbers, primary CTAs |
| primary-soft | `--primary-soft` | `215 50% 92%` | `#d4e2f5` | Tinted primary bg (badges, cards) |
| **success** | `--success` | `145 50% 30%` | `#246b3c` | Income, balance-positive, savings progress |
| success-soft | `--success-soft` | `145 40% 92%` | `#d3edde` | Tinted success bg |
| **warning** | `--warning` | `35 80% 45%` | `#cc8210` | Forecast, "look ahead", attention without alarm |
| warning-soft | `--warning-soft` | `35 80% 94%` | `#fef3e0` | Tinted warning bg |
| **destructive** | `--destructive` | `358 65% 45%` | `#bf1e22` | Expenses, errors, deletions, critical alerts |
| destructive-soft | `--destructive-soft` | `358 65% 96%` | `#feecec` | Tinted destructive bg |
| **accent** | `--accent` | `175 55% 35%` | `#267c74` | Future / planned / projects (teal), links, chat |
| accent-soft | `--accent-soft` | `175 45% 92%` | `#d3eeec` | Tinted accent bg |

### Tone semantics — when to pick which
| Situation | Tone |
|---|---|
| Money going out (expense, deletion, over budget) | `destructive` |
| Money coming in (income), this month's net positive | `success` |
| Looking ahead (forecast, prediction, MoM comparison) | `warning` |
| Long-term standing (cumulative balance, total holdings) | `primary` |
| Future / planned / scoped (projects, "next month") | `accent` |
| No semantic meaning (just a label, count, neutral metric) | `neutral` |

**Never** use a tone for decoration. Tone signals meaning. If two adjacent tiles
have the same tone for different reasons, one of them is wrong.

### Chart palette
For donuts/bars/lines that need distinct, non-semantic categorical colors:
`--chart-1` through `--chart-7` — see `globals.css`. Charts use these in order;
they're **not** tied to tone semantics (chart-1 isn't "primary").

### Dark mode
Defined in `globals.css` under `.dark`. Every token has a dark-mode value.
Components should use the semantic class (`text-foreground`, `bg-card`) not the
hardcoded hex — that's how dark mode works for free.

---

## 2. Radius

The base radius is `--radius: 1rem` (16px). It cascades:
- `rounded-lg` → 16px (uses `var(--radius)`)
- `rounded-md` → 14px (`calc(var(--radius) - 2px)`)
- `rounded-sm` → 12px (`calc(var(--radius) - 4px)`)

Plus the fixed Tailwind sizes still apply: `rounded-xl` = 12px, `rounded-2xl` =
16px, `rounded-3xl` = 24px, `rounded-full` = 9999px.

### Standard radii by element
| Element | Class | Px |
|---|---|---|
| Cards / tiles | `rounded-2xl` | 16 |
| Buttons | `rounded-full` (pill) | 9999 |
| Form inputs | `rounded-md` | 14 |
| Pills / badges | `rounded-full` | 9999 |
| Modals / dialogs | `rounded-2xl` | 16 |
| Big banner cards (insights spotlight) | `rounded-2xl` | 16 |
| Compact list rows inside a card | `rounded-xl` outer | 12 |
| Progress bars | `rounded-full` | 9999 |
| Icon badges | `rounded-full` (always circles) | 9999 |

**Never** mix `rounded-md` and `rounded-xl` on the same hierarchy level — the
visual language gets noisy.

---

## 3. Spacing

We use Tailwind's default 4px scale. Conventions:

| Context | Class |
|---|---|
| Card padding | `p-4` (16px) standard, `p-3` for compact, `p-5` for hero/spotlight |
| Section gap (between unrelated sections) | `space-y-6` (24px) |
| Card stack within a section | `space-y-3` or `gap-3` (12px) |
| Compact list (e.g. tx rows in a card) | `space-y-2` or `divide-y` |
| Inline gap (icon + text) | `gap-2` (8px) for badges, `gap-1.5` for compact pills |
| Modal inner padding | `p-5` to `p-6` |

---

## 4. Typography

- **Font**: Heebo, loaded as `var(--font-heebo)` in `layout.tsx`. Hebrew-first.
- **Numbers**: `font-variant-numeric: tabular-nums` is applied globally to
  tables and `.tabular` — finance app requirement. Always tabular in KPIs and
  transaction amounts.
- **Body**: `text-sm` (14px), normal weight.
- **Section headings (`<h2>`)**: `text-sm font-medium text-muted-foreground`
  — soft, not bold. The icon-badge in the heading row carries the visual
  weight, not the type.
- **KPI labels**: `text-xs text-muted-foreground` (12px).
- **KPI numbers**: `tile-value` class (`text-3xl font-semibold tracking-tight
  tabular-nums`).
- **Captions**: `text-xs text-muted-foreground`.
- **Micro text** (severity pills, "11/04 · קטגוריה"): `text-[10px]` or
  `text-2xs` (11px).
- **Uppercase eyebrow** (severity label in spotlight insight): `text-[10px]
  font-semibold uppercase tracking-wider` in tone color.

**Never** use `font-bold` for general headings — `font-semibold` is the maximum
weight for headings. `font-bold` is reserved for KPI numbers and money amounts.

---

## 5. Components

### 5.1 Tile (`.tile` class + `<Tile />` React component)
The KPI card. Defined in `globals.css` as:
```css
.tile { @apply rounded-2xl border bg-card p-4 transition-shadow hover:shadow-sm; }
```

`<Tile />` props:
- `label` (string) — required
- `value` (ReactNode) — the headline number, formatted via `formatIls`
- `caption` (ReactNode, optional) — small text under the number
- `tone` (one of `neutral | success | warning | destructive | accent | primary`) — drives both the number color AND the icon-badge color
- `badge` (ReactNode, optional) — appears top-end
- `icon` (ReactNode, optional) — automatically wrapped in a 28px round
  tone-soft icon-badge
- `info` (string, optional) — clickable "i" icon that opens a modal with the
  calculation breakdown

When you use `<Tile />`, **always pass a `tone`** — even if it's `neutral`. The
tone is what gives the dashboard its visual rhythm.

### 5.2 Buttons (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-destructive`)
All pill-shaped (`rounded-full`), 40px tall minimum, `px-4 py-2`. The variants
only change colors:
- `.btn-primary` — navy bg, white text. The single canonical CTA per page.
- `.btn-secondary` — white bg + border, foreground text. Most-common action.
- `.btn-ghost` — transparent, hover bg-muted. Tertiary action.
- `.btn-destructive` — destructive text, hover destructive/10 bg. For
  delete/remove actions.

**Never** use multiple primary buttons on one page. If you have several CTAs of
equal weight, they should all be secondary; the page gets at most one primary.

### 5.3 Pill / chip (`.pill` class)
Defined as:
```css
.pill { @apply inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium; }
```
The class is just shape. **You must add the color classes** (e.g.
`bg-success-soft text-success` for a success pill).

### 5.4 Icon-badge pattern
A small round circle holding a lucide icon. Used in:
- KPI tile labels (auto-applied via `<Tile icon={...} />`)
- Insight spotlight (40px white-bg, icon in tone color)
- Insight list rows (28px tone-soft bg, icon in tone color)
- Heading rows (when the section has a strong identity, e.g. AI insights)
- Transaction rows (28px, success or destructive tone)

Sizing:
- Compact list/row: `size-7` (28px) with a `size-3.5` icon inside
- Heading or hero: `size-10` (40px) with a `size-5` icon inside
- Always `rounded-full`, always centered (`inline-flex items-center justify-center`)
- Background: `bg-{tone}-soft text-{tone}` (or `bg-card text-{tone}` for a
  white badge against a tone-soft card)

### 5.5 Section heading
A consistent rhythm for every section title:
```jsx
<h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
  <Icon className="size-4" />
  Section name
</h2>
```
Optional: wrap the icon in a tone-soft icon-badge for sections with strong
identity (e.g. תובנות חכמות gets a `bg-primary-soft size-7` badge with the
Sparkles icon in `text-primary`).

### 5.6 Form input (`.form-input` class)
```css
.form-input { @apply w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm transition-colors focus:border-ring focus:shadow-md; }
```
14px radius (after token bump), 12px horizontal padding. Focus state is the
ring color from tokens, not a hard-coded blue.

---

## 6. Patterns

### 6.1 AI insight section (the `<InsightsWidget>` pattern)
Two visual treatments to avoid the "stack of tonal bars" problem when many
insights fire:

**Spotlight** (first / highest-priority insight): full-width tone-soft card
(`rounded-2xl p-4 bg-{tone}-soft`) with a 40px white-bg icon-badge, an uppercase
eyebrow label (`text-[10px] uppercase tracking-wider text-{tone}`), and the
title at `text-[15px] font-semibold`. No severity pill — the eyebrow already
communicates it.

**Rest**: a single bordered card (`rounded-xl border bg-card`) containing
divided rows (`divide-y`). Each row gets a 3px tone-colored start-edge stripe
(absolute-positioned `inset-y-2 start-0 w-[3px]`), a 28px tone-soft icon-badge,
title, body, and a small severity pill on the end. Severity is communicated
through accents, not full color fill.

### 6.2 KPI grid
6 tiles in a `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` (or `lg:grid-cols-6`)
layout with `gap-3`. Each tile gets a `tone` matching its semantic meaning (see
§1). The 6-tone palette across 6 tiles gives the dashboard its color identity
in a glance.

### 6.3 Empty state
When a section has no data:
```jsx
<div className="rounded-xl bg-muted/30 px-4 py-6 text-center">
  <p className="text-sm text-muted-foreground">[message]</p>
  <p className="mt-1 text-xs text-muted-foreground/70">[hint]</p>
</div>
```

### 6.4 Inline warning chip (e.g. "37% above average" on a category)
```jsx
<span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning">
  <BadgeAlert className="size-3" />
  37% מעל הממוצע
</span>
```

---

## 7. RTL rules — non-negotiable

1. `<html dir="rtl">` is set in `layout.tsx`. Never wrap a sub-tree in
   `dir="ltr"` unless you have a very specific reason (e.g. embedding LTR
   content like an English receipt).
2. **Use logical properties**:
   - `ms-` / `me-` (margin-start / margin-end), not `ml-` / `mr-`
   - `ps-` / `pe-` (padding-start / padding-end)
   - `start-0` / `end-0`, not `left-0` / `right-0`
   - `border-s` / `border-e`
3. **Lucide chevrons**: `ChevronRight` points LEFT visually in RTL (back),
   `ChevronLeft` points RIGHT (forward). Apply `.rtl-flip` only when you
   explicitly want a chevron to point against reading direction.
4. **Amount alignment**: amounts in tables go on the **end** side
   (`text-end`), the sign appears before the digits in reading order: `-₪300`
   reads "minus 300 shekels" right-to-left.
5. **Form labels** sit on the start side (right in RTL); inputs grow toward
   the end (left).

---

## 8. Acceptance checklist (before merging any page change)

When you've edited a page or component, check each of these. If you can't tick
all five, fix what's missing before merging:

- [ ] **No hard-coded hex/HSL** in JSX — every color is a token or a
      tone-soft/tone class
- [ ] **Cards are `rounded-2xl`** (or `rounded-xl` for compact nested cards
      inside an already-rounded container)
- [ ] **Buttons are pill-shaped** (`rounded-full` via `.btn`)
- [ ] **Icons in headings or KPIs are wrapped in a tonal icon-badge** — no
      bare inline icons sitting next to text labels
- [ ] **Tone is semantically meaningful** — not "I picked green because green is
      nice". If you can't articulate why a tile is green, it's wrong.

---

## 9. Page inventory & status

Tracks which pages have been audited & brought up to the brand book. Update
this list when you migrate a page.

| Page | Status | Notes |
|---|---|---|
| `/` (dashboard) | ✅ audited | Phase 1–3 + tone polish complete |
| `/transactions` | ⏳ pending | Most-used page; priority for next sweep |
| `/installments` | ⏳ pending | |
| `/recurring` | ⏳ pending | |
| `/savings` | ⏳ pending | |
| `/projects` | ⏳ pending | |
| `/history` | ⏳ pending | |
| `/insights` | ⏳ pending | |
| `/grid` | ⏳ pending | |
| `/import` | ⏳ pending | |
| `/admin/*` | ⏳ pending | Categories, accounts, rules, etc. |
| `/sign-in` | ⏳ pending | Public page — needs the new button style too |

---

## 10. Explicit exceptions to "no hard-coded hex"

Two places in the codebase legitimately use hard-coded hex values. These are
**not** brand-book violations — they're user data, not design tokens:

1. **User color pickers** for categories, projects, and savings goals. The
   user picks one of ~8–10 distinct colors as visual metadata for their own
   entity. These are stored in the DB and rendered via `style={{
   backgroundColor: entity.color }}`. The pickable palette is intentionally
   from the Tailwind hex range so picked colors stay vivid and categorical.
   Affected files: `savings/client.tsx`, `projects/project-modal.tsx`.

2. **Default seeded category colors** in `import/actions.ts`. When the
   importer auto-creates a new category, it seeds a default color so the
   user has something to start with. These end up in the DB as user data.

Everything *else* — every UI surface, every state indicator, every
data-attached row, every page chrome element — must use a token.

---

## 11. How to extend / change the brand book

If you need a new color, a new component, or a new pattern:

1. **Don't add it inline**. Add it here first, with a `Why` line. The brand
   book exists so future contributors (and you in six months) understand
   what each color/component is *for*.
2. **Add the token** to `globals.css` and `tailwind.config.ts` if it's a color.
3. **Add the component** to `apps/web/src/components/ui/*` if it's reusable.
4. **Update §9 above** when you migrate a page so the inventory stays accurate.
