/* eslint-disable @next/next/no-head-element */
// L3 (תובנות שזורות / Inline AI) — 3 less-colorful refinements.
// Same layout, same V5א palette. Only the color *intensity* drops.
//   ?r=a → "צבע מאופק"    soft step — colored icon badges + neutral bars
//   ?r=b → "צבע כחתימה"   minimal — color reserved for icons + AI signals
//   ?r=c → "כמעט מונוכרום" near-mono — black/cream chrome, color only on data dots

import Link from 'next/link';
import {
  Wallet,
  TrendingDown,
  TrendingUp,
  PiggyBank,
  Plus,
  Sparkles,
  CreditCard,
  Repeat,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  BadgeAlert,
  Briefcase,
} from 'lucide-react';

type Ref = 'a' | 'b' | 'c' | 'd';

const META: Record<Ref, { name: string; tagline: string }> = {
  a: { name: 'צבע מאופק', tagline: 'גרסה א · ללא פסי-עליון, ברים אפורים, אייקונים בפסטל' },
  b: { name: 'צבע כחתימה', tagline: 'גרסה ב · צבע רק לאייקונים וסיגנלי AI — שאר הממשק לבן' },
  c: { name: 'כמעט מונוכרום', tagline: 'גרסה ג · קרם/לבן/שחור — צבע רק לנקודות נתון' },
  d: { name: 'גוונים אמיתיים', tagline: 'גרסה ד · אותה פריסה כמו "צבע מאופק" + צבעי הפלטה הקיימת באפליקציה (ירוק יער, ענבר, נייבי)' },
};

export default async function RefinedL3Preview({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const sp = await searchParams;
  const r: Ref = (sp.r === 'b' || sp.r === 'c' || sp.r === 'd' ? sp.r : 'a') as Ref;

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        background: r === 'd' ? '#fbfcfe' : PALETTE.bg,
        color: r === 'd' ? '#16202c' : PALETTE.fg,
        fontFamily: 'var(--font-heebo), system-ui, sans-serif',
      }}
    >
      {/* Switcher */}
      <header
        style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${PALETTE.borderSoft}`,
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            תובנות שזורות · עידון צבע — <span style={{ fontWeight: 500 }}>{META[r].name}</span>
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 2 }}>{META[r].tagline}</div>
        </div>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['a', 'b', 'c', 'd'] as Ref[]).map((id) => (
            <Link
              key={id}
              href={`/design-preview/v5a/refined?r=${id}`}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: 'none',
                border: r === id ? '1px solid transparent' : `1px solid ${PALETTE.borderStrong}`,
                background: r === id ? (id === 'd' ? PROD_TONE_FG.primary : PALETTE.primary) : 'transparent',
                color: r === id ? '#fff' : 'inherit',
              }}
            >
              {META[id].name}
            </Link>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px 80px' }}>
        {/* View stripe */}
        <div
          style={{
            height: 3,
            background:
              r === 'c' ? PALETTE.fg :
              r === 'd' ? PROD_TONE_FG.primary :
              PALETTE.primary,
            borderRadius: 2,
            marginBottom: 18,
            opacity: r === 'c' ? 0.85 : 0.55,
          }}
        />

        <DashboardHeader r={r} />

        <KpiGrid r={r} />

        <div style={{ marginTop: 14 }}>
          <ChargeBar r={r} />
        </div>

        <SectionTitle r={r} marginTop={28}>תובנת השבוע</SectionTitle>
        <div style={{ marginTop: 14 }}>
          <SpotlightInsight r={r} />
        </div>

        <SectionTitle r={r} marginTop={32}>פיצול הוצאות לפי קטגוריה</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14, marginTop: 14 }}>
          <DonutCard r={r} />
          <CategoryListWithAI r={r} />
        </div>

        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <RecurringCardWithAI r={r} />
          <SavingsCardWithAI r={r} />
        </div>

        <SectionTitle r={r} marginTop={32}>פרויקטים פעילים</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <ProjectCard r={r} name="שיפוץ מטבח" spent="₪ 28,400" budget="₪ 45,000" progress={63} tone="accent" />
          <ProjectCard r={r} name="חופשה ביוון · אוגוסט" spent="₪ 4,820" budget="₪ 12,000" progress={40} tone="primary" />
        </div>

        <SectionTitle r={r} marginTop={32}>תנועות אחרונות · מאי 2026</SectionTitle>
        <div style={{ marginTop: 14 }}>
          <TxList r={r} />
        </div>
      </main>
    </div>
  );
}

/* ============================================================================
   Palette — fixed (V5א pastel base)
   ========================================================================== */
const PALETTE = {
  bg: '#fbf7f4',
  fg: '#2a2530',
  cardBg: '#ffffff',
  borderSoft: '#efe7df',
  borderStrong: '#e7ddd2',
  mutedFg: '#7a6a85',
  hairline: '#e7ddd2',
  primary: '#5b3f70',
  primaryFg: '#fff',
  neutralBar: '#e7ddd2',
  neutralBarFill: '#5b3f70',
};

type Tone = 'primary' | 'success' | 'destructive' | 'accent' | 'warning';

// Pastel fills (used in level A only; reduced in B; absent in C)
const TONE_FILL: Record<Tone, string> = {
  primary: '#e8d8f0',
  success: '#d9ead0',
  destructive: '#f7d6cf',
  accent: '#fae6c8',
  warning: '#fae6c8',
};

const TONE_FG: Record<Tone, string> = {
  primary: '#5b3f70',
  success: '#3f6d40',
  destructive: '#9c4a3a',
  accent: '#8a5a1c',
  warning: '#8a5a1c',
};

// Category colors — kept across all refinement levels (data distinguisher)
// but desaturated for c.
const CATEGORY_COLORS: Record<Ref, string[]> = {
  a: ['#d4b8e3', '#f4cf94', '#a4c2e0', '#b8d6a3', '#eeb5a4'],
  b: ['#c9bdd5', '#e3cfa7', '#b3c4d6', '#bccfb1', '#dcb7ab'],
  c: ['#a89cb4', '#b8a587', '#9eaabc', '#a8b6a0', '#b89e95'],
  d: ['#d4b8e3', '#f4cf94', '#a4c2e0', '#b8d6a3', '#eeb5a4'],
};

// Progress-bar mid-tone fills (used to color project bars per-tone)
const TONE_BAR: Record<Tone, string> = {
  primary: '#d4b8e3',
  success: '#b8d6a3',
  destructive: '#eeb5a4',
  accent: '#f4cf94',
  warning: '#f4cf94',
};

// PRODUCTION palette ('d' refinement) — matches the existing app's globals.css
// (deep ink fg, forest-green success, amber warning, navy primary, teal accent).
const PROD_TONE_FG: Record<Tone, string> = {
  primary: '#1c3e7d',      // deep navy (from --primary 215 65% 30%)
  success: '#266340',      // forest green (from --success 145 50% 30%)
  destructive: '#be2730',  // dark red (from --destructive 358 65% 45%)
  accent: '#287574',       // teal (from --accent 175 55% 35%)
  warning: '#cf8214',      // amber (from --warning 35 80% 45%)
};
const PROD_TONE_FILL: Record<Tone, string> = {
  primary: '#dfe7f4',      // --primary-soft
  success: '#e1f1e8',      // --success-soft
  destructive: '#fbe9eb',  // --destructive-soft
  accent: '#dff0ef',       // --accent-soft
  warning: '#fdf2dd',      // --warning-soft
};
const PROD_TONE_BAR: Record<Tone, string> = {
  primary: '#7591ba',
  success: '#7baa8a',
  destructive: '#d3727a',
  accent: '#7baba9',
  warning: '#e3a35a',
};

/* ============================================================================
   Helpers that vary with refinement level
   ========================================================================== */

// KPI tile look
function kpiIconBg(r: Ref, tone: Tone): string {
  if (r === 'a') return TONE_FILL[tone];
  if (r === 'd') return PROD_TONE_FILL[tone]; // production light tints
  if (r === 'b') return '#f6f1ec'; // single cream-warm wash
  return 'transparent';
}
function kpiIconFg(r: Ref, tone: Tone): string {
  if (r === 'a') return TONE_FG[tone];
  if (r === 'd') return PROD_TONE_FG[tone]; // production deep colors
  if (r === 'b') return TONE_FG[tone];
  return PALETTE.mutedFg; // c: no tone in icon
}
function kpiNumberColor(r: Ref, tone: Tone): string {
  if (r === 'd') return PROD_TONE_FG[tone]; // production tone color (e.g. forest green)
  return PALETTE.fg;
}
function kpiStripeColor(r: Ref, _tone: Tone): string | null {
  // No tonal stripe in any refinement — matches the production app, which uses
  // plain white cards and lets the green number be the visual hook.
  return null;
}

// AI nudge look
function nudgeStyle(r: Ref, tone: Tone): React.CSSProperties {
  if (r === 'd') {
    // production tints — light bg, deep fg, hairline border
    return {
      background: PROD_TONE_FILL[tone],
      color: PROD_TONE_FG[tone],
      border: `1px solid ${PROD_TONE_FG[tone]}26`,
    };
  }
  if (r === 'a') {
    // soft tinted bg, lower saturation than original L3
    return {
      background: '#f9f4ee', // unified cream wash regardless of tone
      color: TONE_FG[tone],
      border: `1px solid ${PALETTE.borderSoft}`,
    };
  }
  if (r === 'b') {
    return {
      background: '#ffffff',
      color: TONE_FG[tone],
      borderInlineStart: `3px solid ${TONE_FG[tone]}`,
      border: `1px solid ${PALETTE.borderSoft}`,
    };
  }
  // c — near mono
  return {
    background: '#ffffff',
    color: PALETTE.fg,
    border: `1px solid ${PALETTE.borderSoft}`,
    borderInlineStart: `3px solid ${PALETTE.fg}`,
  };
}

// Inline chip (e.g. category warning)
function chipStyle(r: Ref, tone: Tone): React.CSSProperties {
  if (r === 'a') {
    return {
      background: TONE_FILL[tone],
      color: TONE_FG[tone],
      border: 'none',
    };
  }
  if (r === 'd') {
    return {
      background: PROD_TONE_FILL[tone],
      color: PROD_TONE_FG[tone],
      border: `1px solid ${PROD_TONE_FG[tone]}26`,
    };
  }
  if (r === 'b') {
    return {
      background: '#ffffff',
      color: TONE_FG[tone],
      border: `1px solid ${TONE_FG[tone]}33`,
    };
  }
  return {
    background: '#ffffff',
    color: PALETTE.fg,
    border: `1px solid ${PALETTE.borderStrong}`,
  };
}

// Category bar fill
function categoryBarFill(r: Ref, color: string): string {
  if (r === 'a' || r === 'd') return color; // colored bars
  if (r === 'b') return PALETTE.borderStrong;
  return PALETTE.borderStrong;
}

// Goal/progress bar fill — optional tone
function progressBarFill(r: Ref, tone: Tone = 'success'): string {
  if (r === 'd') return PROD_TONE_BAR[tone]; // production mid-tones
  if (r === 'a') return '#b8d6a3'; // soft sage
  if (r === 'b') return PALETTE.primary; // single plum
  return PALETTE.fg;
}

// Project icon badge bg
function projectIconBg(r: Ref, tone: Tone): string {
  if (r === 'a') return TONE_FILL[tone];
  if (r === 'd') return PROD_TONE_FILL[tone];
  if (r === 'b') return '#f6f1ec';
  return '#f3eee8';
}

// Tx icon badge bg
function txIconBg(r: Ref, positive: boolean): string {
  if (r === 'a') return positive ? TONE_FILL.success : TONE_FILL.destructive;
  if (r === 'd') return positive ? PROD_TONE_FILL.success : PROD_TONE_FILL.destructive;
  if (r === 'b') return '#f6f1ec';
  return '#f3eee8';
}
function txAmountColor(r: Ref, positive: boolean): string {
  if (r === 'a' || r === 'b') return positive ? TONE_FG.success : TONE_FG.destructive;
  if (r === 'd') return positive ? PROD_TONE_FG.success : PROD_TONE_FG.destructive;
  return PALETTE.fg; // c: foreground only
}

/* ============================================================================
   Header & controls (shared)
   ========================================================================== */
function DashboardHeader({ r }: { r: Ref }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 22,
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em' }}>בית</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: PALETTE.mutedFg }}>
          מאי 2026 <span style={{ opacity: 0.7, marginInlineStart: 6 }}>(11/04 – 10/05)</span>
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <ViewTabs />
        <MonthSwitcher />
        <ActionBtn r={r} kind="primary" Icon={Plus}>תנועה חדשה</ActionBtn>
      </div>
    </div>
  );
}

function ViewTabs() {
  const tabs = [
    { id: 'combined', label: 'משולב', active: true },
    { id: 'personal', label: 'אישי', active: false },
    { id: 'business', label: 'עסקי', active: false },
  ];
  return (
    <div style={{ display: 'inline-flex', background: '#f3eee8', borderRadius: 999, padding: 3, gap: 2 }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          style={{
            padding: '7px 16px',
            borderRadius: 999,
            border: 'none',
            cursor: 'pointer',
            fontSize: 12.5,
            fontWeight: tab.active ? 600 : 500,
            background: tab.active ? '#fff' : 'transparent',
            color: tab.active ? PALETTE.fg : PALETTE.mutedFg,
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function MonthSwitcher() {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: `1px solid ${PALETTE.borderStrong}`,
        borderRadius: 999,
        overflow: 'hidden',
        background: PALETTE.cardBg,
      }}
    >
      <button type="button" style={navBtn()}>
        <ChevronRight size={15} />
      </button>
      <span style={{ padding: '0 14px', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        מאי 2026
      </span>
      <button type="button" style={navBtn()}>
        <ChevronLeft size={15} />
      </button>
    </div>
  );
}

function navBtn(): React.CSSProperties {
  return {
    width: 32,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: PALETTE.mutedFg,
  };
}

function ActionBtn({
  r,
  kind,
  Icon,
  children,
}: {
  r: Ref;
  kind: 'primary';
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  const bg = r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG.primary : PALETTE.primary;
  return (
    <button
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 18px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        border: '1px solid transparent',
        background: bg,
        color: '#fff',
      }}
    >
      <Icon size={14} strokeWidth={2.2} />
      {children}
    </button>
  );
}

function SectionTitle({ r, children, marginTop }: { r: Ref; children: React.ReactNode; marginTop?: number }) {
  return (
    <h2
      style={{
        margin: 0,
        marginTop,
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: r === 'c' ? '0.06em' : '0.02em',
        textTransform: r === 'c' ? 'uppercase' : 'none',
        color: PALETTE.mutedFg,
      }}
    >
      {children}
    </h2>
  );
}

/* ============================================================================
   KPI tile + grid
   ========================================================================== */
const KPI_DATA: Array<{ tone: Tone; label: string; value: string; caption: string; Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }> }> = [
  { tone: 'destructive', label: 'הוצאות עד כה', value: '₪ 17,420', caption: 'יום 12 מתוך 31', Icon: TrendingDown },
  { tone: 'success', label: 'הכנסות', value: '₪ 22,800', caption: '3 משכורות', Icon: TrendingUp },
  { tone: 'success', label: 'מאזן החודש', value: '₪ 5,380', caption: 'הכנסות פחות הוצאות', Icon: Wallet },
  { tone: 'primary', label: 'יתרה מצטברת', value: '₪ 28,430', caption: 'לסוף מאי 2026', Icon: Banknote },
  { tone: 'warning', label: 'תחזית סוף חודש', value: '₪ 3,940', caption: '19 ימים נותרו', Icon: TrendingUp },
  { tone: 'accent', label: 'הוצאות קבועות', value: '₪ 6,820', caption: '30% מההכנסות', Icon: Repeat },
];

function KpiGrid({ r }: { r: Ref }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
      {KPI_DATA.map((k, i) => (
        <KpiTile key={i} r={r} {...k} />
      ))}
    </div>
  );
}

function KpiTile({
  r,
  tone,
  label,
  value,
  caption,
  Icon,
}: {
  r: Ref;
  tone: Tone;
  label: string;
  value: string;
  caption: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}) {
  const stripeColor = kpiStripeColor(r, tone);
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '14px 14px 16px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {stripeColor && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            insetInlineStart: 0,
            insetInlineEnd: 0,
            height: 4,
            background: stripeColor,
          }}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: kpiIconBg(r, tone),
            border: r === 'c' ? `1px solid ${PALETTE.borderStrong}` : 'none',
            color: kpiIconFg(r, tone),
          }}
        >
          <Icon size={13} color={kpiIconFg(r, tone)} strokeWidth={2} />
        </span>
        <span style={{ fontSize: 11.5, color: PALETTE.mutedFg, fontWeight: 500 }}>{label}</span>
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: kpiNumberColor(r, tone),
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: '#9a8aa5' }}>{caption}</div>
    </div>
  );
}

/* ============================================================================
   Charge bar
   ========================================================================== */
function ChargeBar({ r }: { r: Ref }) {
  const successColor = r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG.success : TONE_FG.success;
  const warningColor = r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG.warning : TONE_FG.warning;
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 18,
        padding: '12px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 24,
        fontSize: 13,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Banknote size={14} color={successColor} strokeWidth={2.2} />
        <span style={{ color: PALETTE.mutedFg }}>כבר חויב:</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>₪ 12,840</strong>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CreditCard size={14} color={warningColor} strokeWidth={2.2} />
        <span style={{ color: PALETTE.mutedFg }}>עוד יחויב:</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums', color: warningColor }}>₪ 4,580</strong>
      </span>
      <span style={{ marginInlineStart: 'auto', fontSize: 11, color: PALETTE.mutedFg }}>לפי תאריכי חיוב</span>
    </div>
  );
}

/* ============================================================================
   Spotlight + inline AI nudges
   ========================================================================== */
function SpotlightInsight({ r }: { r: Ref }) {
  const iconBg =
    r === 'a' ? TONE_FILL.success :
    r === 'd' ? PROD_TONE_FILL.success :
    r === 'b' ? '#f6f1ec' : '#f3eee8';
  const iconFg =
    r === 'c' ? PALETTE.fg :
    r === 'd' ? PROD_TONE_FG.success :
    TONE_FG.success;
  const eyebrowColor =
    r === 'c' ? PALETTE.mutedFg :
    r === 'd' ? PROD_TONE_FG.success :
    TONE_FG.success;
  const ctaBg = r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG.primary : PALETTE.primary;
  // Only stripe-on-start for b/c. 'd' is plain white card matching production.
  const stripeOnStart = r === 'b' || r === 'c';
  const showTopStripe = false;
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '20px 22px',
        display: 'flex',
        gap: 18,
        alignItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        borderInlineStart: stripeOnStart ? `3px solid ${iconFg}` : `1px solid ${PALETTE.borderSoft}`,
      }}
    >
      {showTopStripe && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            insetInlineStart: 0,
            insetInlineEnd: 0,
            height: 4,
            background: TONE_FILL.success,
          }}
        />
      )}
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: iconBg,
          color: iconFg,
          flexShrink: 0,
          border: r === 'c' ? `1px solid ${PALETTE.borderStrong}` : 'none',
        }}
      >
        <Lightbulb size={22} color={iconFg} strokeWidth={2} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: eyebrowColor, letterSpacing: r === 'c' ? '0.1em' : '0.04em', textTransform: r === 'c' ? 'uppercase' : 'none' }}>
            הזדמנות לחיסכון
          </span>
          <span style={{ fontSize: 11, color: PALETTE.mutedFg }}>· 3 דק׳ פעולה</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
          חיסכון פוטנציאלי של ₪ 180/חודש על ביטוח רכב
        </div>
        <div style={{ fontSize: 13, color: PALETTE.mutedFg, marginTop: 4, lineHeight: 1.5 }}>
          התשלום שלך גבוה ב-22% מהממוצע באזורך. שתי חברות פתוחות להצעת מחיר עכשיו.
        </div>
      </div>
      <button
        type="button"
        style={{
          padding: '10px 18px',
          borderRadius: 999,
          background: ctaBg,
          color: '#fff',
          border: 'none',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        ראה הצעה
      </button>
    </div>
  );
}

/* ============================================================================
   Donut + Categories
   ========================================================================== */
function DonutCard({ r }: { r: Ref }) {
  const colors = CATEGORY_COLORS[r];
  const pcts = [32, 22, 18, 16, 12];
  let acc = 0;
  const stops = colors
    .map((c, i) => {
      const start = acc;
      acc += pcts[i];
      return `${c} ${start}% ${acc}%`;
    })
    .join(', ');
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 160,
          height: 160,
          borderRadius: '50%',
          background: `conic-gradient(${stops})`,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 24,
            background: PALETTE.cardBg,
            borderRadius: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 11, color: PALETTE.mutedFg }}>סה"כ</div>
          <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>₪ 17,420</div>
        </div>
      </div>
    </div>
  );
}

function CategoryListWithAI({ r }: { r: Ref }) {
  const colors = CATEGORY_COLORS[r];
  const rows = [
    { name: 'מזון וצרכים', amount: '₪ 5,580', pct: 32, color: colors[0], flag: null as string | null },
    { name: 'דיור', amount: '₪ 3,830', pct: 22, color: colors[1], flag: null },
    { name: 'תחבורה', amount: '₪ 3,130', pct: 18, color: colors[2], flag: null },
    { name: 'בריאות', amount: '₪ 2,790', pct: 16, color: colors[3], flag: null },
    { name: 'בידור', amount: '₪ 2,090', pct: 12, color: colors[4], flag: '37% מעל הממוצע' },
  ];
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: row.color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {row.name}
                {row.flag && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 10.5,
                      fontWeight: 600,
                      ...chipStyle(r, 'warning'),
                    }}
                  >
                    <BadgeAlert size={10} color={r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG.warning : TONE_FG.warning} strokeWidth={2.4} />
                    {row.flag}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row.amount}</span>
            </div>
            <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: '#f3eee8', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${row.pct}%`,
                  height: '100%',
                  background: categoryBarFill(r, row.color),
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   Recurring + Savings (with AI nudge)
   ========================================================================== */
function RecurringCardWithAI({ r }: { r: Ref }) {
  const nudge = nudgeStyle(r, 'success');
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>הוצאות קבועות חודשיות</h3>
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color:
              r === 'a' ? TONE_FG.accent :
              r === 'd' ? PROD_TONE_FG.accent :
              PALETTE.fg,
          }}
        >
          ₪ 6,820
        </span>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 14,
          fontSize: 12,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          ...nudge,
        }}
      >
        <Lightbulb size={13} color={r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG.success : TONE_FG.success} strokeWidth={2.4} />
        <span>נטפליקס + Apple TV — האם שתיהן בשימוש פעיל? אפשר לחסוך ₪ 35/חודש.</span>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { name: 'משכנתא', amount: '₪ 4,200' },
          { name: 'ארנונה', amount: '₪ 780' },
          { name: 'חשמל וגז', amount: '₪ 510' },
          { name: 'אינטרנט + טלפון', amount: '₪ 290' },
        ].map((row, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12.5,
              padding: '6px 0',
              borderTop: i === 0 ? 'none' : `1px solid #f5ede5`,
            }}
          >
            <span style={{ color: PALETTE.mutedFg }}>{row.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{row.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavingsCardWithAI({ r }: { r: Ref }) {
  const nudge = nudgeStyle(r, 'primary');
  const goals = [
    { name: 'קרן חירום', current: 18500, target: 24000 },
    { name: 'דירה חדשה', current: 142000, target: 280000 },
    { name: 'חופשה 2026', current: 4200, target: 12000 },
  ];
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>מטרות חיסכון</h3>
        <PiggyBank size={16} color={r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG.success : TONE_FG.success} strokeWidth={2} />
      </div>

      <div
        style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 14,
          fontSize: 12,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          ...nudge,
        }}
      >
        <Sparkles size={13} color={r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG.primary : TONE_FG.primary} strokeWidth={2.4} />
        <span>קרן חירום קרובה ל-77% — בקצב הזה תושלם ב-מרץ 2027.</span>
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {goals.map((g, i) => {
          const pct = Math.min(100, Math.round((g.current / g.target) * 100));
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{g.name}</span>
                <span style={{ fontSize: 11.5, color: PALETTE.mutedFg, fontVariantNumeric: 'tabular-nums' }}>
                  ₪ {g.current.toLocaleString('he-IL')} / ₪ {g.target.toLocaleString('he-IL')}
                </span>
              </div>
              <div style={{ marginTop: 6, height: 5, borderRadius: 3, background: '#f3eee8', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: progressBarFill(r), borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
   Project cards
   ========================================================================== */
function ProjectCard({
  r,
  name,
  spent,
  budget,
  progress,
  tone,
}: {
  r: Ref;
  name: string;
  spent: string;
  budget: string;
  progress: number;
  tone: Tone;
}) {
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: projectIconBg(r, tone),
            color: r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG[tone] : TONE_FG[tone],
            border: r === 'c' ? `1px solid ${PALETTE.borderStrong}` : 'none',
          }}
        >
          <Briefcase size={14} color={r === 'c' ? PALETTE.fg : r === 'd' ? PROD_TONE_FG[tone] : TONE_FG[tone]} strokeWidth={2.2} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 11.5, color: PALETTE.mutedFg, marginTop: 2 }}>
            {spent} מתוך {budget}
          </div>
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{progress}%</span>
      </div>
      <div style={{ marginTop: 10, height: 5, borderRadius: 3, background: '#f3eee8', overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: progressBarFill(r, tone), borderRadius: 3 }} />
      </div>
    </div>
  );
}

/* ============================================================================
   Transactions list
   ========================================================================== */
function TxList({ r }: { r: Ref }) {
  const rows = [
    { d: '12/05', t: 'סופר אסום', a: -342, cat: 'מזון וצרכים' },
    { d: '11/05', t: 'משכורת — יניב', a: 14800, cat: 'הכנסה' },
    { d: '10/05', t: 'דלק פז', a: -287, cat: 'תחבורה' },
    { d: '09/05', t: 'נטפליקס', a: -49.9, cat: 'בידור' },
    { d: '08/05', t: 'גן עירוני', a: -1450, cat: 'ילדים' },
    { d: '07/05', t: 'שופרסל אונליין', a: -612, cat: 'מזון וצרכים' },
  ];
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        overflow: 'hidden',
      }}
    >
      {rows.map((row, i) => {
        const positive = row.a > 0;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderTop: i === 0 ? 'none' : `1px solid #f5ede5`,
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: txIconBg(r, positive),
                  color:
                    r === 'c' ? PALETTE.fg :
                    r === 'd' ? (positive ? PROD_TONE_FG.success : PROD_TONE_FG.destructive) :
                    positive ? TONE_FG.success : TONE_FG.destructive,
                  fontSize: 13.5,
                  fontWeight: 700,
                  border: r === 'c' ? `1px solid ${PALETTE.borderStrong}` : 'none',
                }}
              >
                {positive ? '+' : '−'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{row.t}</div>
                <div style={{ fontSize: 11.5, color: PALETTE.mutedFg, marginTop: 2 }}>
                  {row.d} · {row.cat}
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: txAmountColor(r, positive),
              }}
            >
              {positive ? '+' : '−'}₪ {Math.abs(row.a).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
