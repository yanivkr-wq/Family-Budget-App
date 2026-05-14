/* eslint-disable @next/next/no-head-element */
// V5 (Soft Pastel) — 3 refinement sub-variants of the full dashboard.
// ?s=a → "מינימלי"   (white cards, tonal stripe — restrained)
// ?s=b → "פסטל מלא"  (each tile fully tinted — warmer, more color)
// ?s=c → "מספרים צפים" (editorial / airy — no boxy tiles on KPIs)
// All sub-variants share the same V5 palette (cream bg, soft pastels,
// plum primary, light type weights, generous whitespace).

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

type Sub = 'a' | 'b' | 'c';

const META: Record<Sub, { name: string; tagline: string }> = {
  a: { name: 'מינימלי', tagline: 'גרסה 5א · כרטיסים לבנים עם פס פסטל דק' },
  b: { name: 'פסטל מלא', tagline: 'גרסה 5ב · כל כרטיס בצבע פסטל מלא — מקרון' },
  c: { name: 'מספרים צפים', tagline: 'גרסה 5ג · עיתונאי-אוורירי, ללא תיבות סביב המספרים' },
};

export default async function V5DashboardPreview({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const sp = await searchParams;
  const s: Sub = (sp.s === 'b' || sp.s === 'c' ? sp.s : 'a') as Sub;

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        background: PALETTE.bg,
        color: PALETTE.fg,
        fontFamily: 'var(--font-heebo), system-ui, sans-serif',
      }}
    >
      {/* Top sub-variant switcher */}
      <header
        style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${PALETTE.borderSoft}`,
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            V5 · פסטל רך — <span style={{ fontWeight: 500 }}>{META[s].name}</span>
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 2 }}>{META[s].tagline}</div>
        </div>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['a', 'b', 'c'] as Sub[]).map((id) => (
            <Link
              key={id}
              href={`/design-preview/v5?s=${id}`}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: 'none',
                border: s === id ? '1px solid transparent' : `1px solid ${PALETTE.borderStrong}`,
                background: s === id ? PALETTE.primary : 'transparent',
                color: s === id ? '#fff' : 'inherit',
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
            background: PALETTE.primary,
            borderRadius: 2,
            marginBottom: 18,
            opacity: 0.55,
          }}
        />

        {/* Dashboard header */}
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
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em' }}>
              בית
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: PALETTE.mutedFg }}>
              מאי 2026 <span style={{ opacity: 0.7, marginInlineStart: 6 }}>(11/04 – 10/05)</span>
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <ViewTabs />
            <MonthSwitcher />
            <ActionBtn kind="primary" Icon={Plus}>תנועה חדשה</ActionBtn>
          </div>
        </div>

        {/* KPI row — layout differs per sub-variant */}
        {s === 'a' && <KpiGridA />}
        {s === 'b' && <KpiGridB />}
        {s === 'c' && <KpiGridC />}

        {/* Charge-date bar — shared, neutral */}
        <ChargeBar sub={s} />

        {/* Insights */}
        <SectionTitle sub={s} title="תובנות AI · מה כדאי לדעת השבוע" marginTop={32} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
          <InsightCard
            sub={s}
            tone="warning"
            Icon={BadgeAlert}
            title="בידור: 37% מעל הממוצע"
            body="הוצאת ₪ 412 על שירותי סטרימינג החודש לעומת ממוצע ₪ 300. שתי כפילויות (Netflix + Apple TV) זוהו."
          />
          <InsightCard
            sub={s}
            tone="success"
            Icon={Lightbulb}
            title="הזדמנות לחיסכון"
            body="התשלום החודשי על ביטוח רכב גבוה ב-22% מהממוצע באזורך. הצעת מחיר חדשה תחסוך כ-₪ 180 לחודש."
          />
          <InsightCard
            sub={s}
            tone="accent"
            Icon={Sparkles}
            title="3 תשלומים מסתיימים"
            body="תוכניות התשלומים: רהיטים (3/12), טלוויזיה (10/12), נסיעה (4/6). תשחרר ₪ 1,240 חודשי בסוף השנה."
          />
        </div>

        {/* Donut + categories */}
        <SectionTitle sub={s} title="פיצול הוצאות לפי קטגוריה" marginTop={32} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14, marginTop: 14 }}>
          <DonutCard sub={s} />
          <CategoryList sub={s} />
        </div>

        {/* Recurring + Savings */}
        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <RecurringCard sub={s} />
          <SavingsCard sub={s} />
        </div>

        {/* Projects */}
        <SectionTitle sub={s} title="פרויקטים פעילים" marginTop={32} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <ProjectCard
            sub={s}
            name="שיפוץ מטבח"
            spent="₪ 28,400"
            budget="₪ 45,000"
            progress={63}
            tone="accent"
          />
          <ProjectCard
            sub={s}
            name="חופשה ביוון · אוגוסט"
            spent="₪ 4,820"
            budget="₪ 12,000"
            progress={40}
            tone="primary"
          />
        </div>

        {/* Transactions */}
        <SectionTitle sub={s} title="תנועות אחרונות · מאי 2026" marginTop={32} />
        <div style={{ marginTop: 14 }}>
          <TxList sub={s} />
        </div>

        {/* AI Note */}
        <div style={{ marginTop: 24 }}>
          <NoteCard sub={s} />
        </div>
      </main>
    </div>
  );
}

/* ============================================================================
   Shared V5 palette
   ========================================================================== */
const PALETTE = {
  bg: '#fbf7f4',
  fg: '#2a2530',
  cardBg: '#ffffff',
  borderSoft: '#efe7df',
  borderStrong: '#e7ddd2',
  mutedFg: '#7a6a85',
  hairline: '#e7ddd2',
  primary: '#5b3f70', // deep plum
  primaryFg: '#fff',
};

type Tone = 'primary' | 'success' | 'destructive' | 'accent' | 'warning';

const TONE_BG: Record<Tone, string> = {
  primary: '#d8c7e2',     // lavender
  success: '#cfe0c1',     // sage
  destructive: '#f2c8c0', // peach
  accent: '#f4dab5',      // butter
  warning: '#f4dab5',
};

const TONE_FG: Record<Tone, string> = {
  primary: '#5b3f70',
  success: '#3f6d40',
  destructive: '#9c4a3a',
  accent: '#8a5a1c',
  warning: '#8a5a1c',
};

const TONE_FILL: Record<Tone, string> = {
  primary: '#e8d8f0',
  success: '#d9ead0',
  destructive: '#f7d6cf',
  accent: '#fae6c8',
  warning: '#fae6c8',
};

/* ============================================================================
   Top controls (shared)
   ========================================================================== */
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
        gap: 0,
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
  kind,
  Icon,
  children,
}: {
  kind: 'primary' | 'secondary' | 'ghost';
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  const isPrimary = kind === 'primary';
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
        border: isPrimary ? '1px solid transparent' : `1px solid ${PALETTE.borderStrong}`,
        background: isPrimary ? PALETTE.primary : PALETTE.cardBg,
        color: isPrimary ? PALETTE.primaryFg : PALETTE.fg,
      }}
    >
      <Icon size={14} strokeWidth={2.2} />
      {children}
    </button>
  );
}

function SectionTitle({ sub, title, marginTop }: { sub: Sub; title: string; marginTop?: number }) {
  if (sub === 'c') {
    // Editorial — thin top rule + small caption
    return (
      <div style={{ marginTop }}>
        <div style={{ height: 1, background: PALETTE.hairline }} />
        <h2
          style={{
            margin: '12px 0 0',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: PALETTE.mutedFg,
          }}
        >
          {title}
        </h2>
      </div>
    );
  }
  return (
    <h2
      style={{
        margin: 0,
        marginTop,
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: '0.02em',
        color: PALETTE.mutedFg,
      }}
    >
      {title}
    </h2>
  );
}

/* ============================================================================
   KPI grids — three sub-variant layouts
   ========================================================================== */
const KPI_DATA: Array<{ tone: Tone; label: string; value: string; caption: string; Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }> }> = [
  { tone: 'destructive', label: 'הוצאות עד כה', value: '₪ 17,420', caption: 'יום 12 מתוך 31', Icon: TrendingDown },
  { tone: 'success', label: 'הכנסות', value: '₪ 22,800', caption: '3 משכורות', Icon: TrendingUp },
  { tone: 'success', label: 'מאזן החודש', value: '₪ 5,380', caption: 'הכנסות פחות הוצאות', Icon: Wallet },
  { tone: 'primary', label: 'יתרה מצטברת', value: '₪ 28,430', caption: 'לסוף מאי 2026', Icon: Banknote },
  { tone: 'warning', label: 'תחזית סוף חודש', value: '₪ 3,940', caption: '19 ימים נותרו · 42 תנועות', Icon: TrendingUp },
  { tone: 'accent', label: 'הוצאות קבועות', value: '₪ 6,820', caption: '30% מההכנסות', Icon: Repeat },
];

/* ---- 5A — Minimal Soft: white cards, top tonal stripe, round icon badge ---- */
function KpiGridA() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
      {KPI_DATA.map((k, i) => (
        <div
          key={i}
          style={{
            background: PALETTE.cardBg,
            border: `1px solid ${PALETTE.borderSoft}`,
            borderRadius: 22,
            padding: '14px 14px 16px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              height: 4,
              background: TONE_FILL[k.tone],
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: TONE_FILL[k.tone],
                color: TONE_FG[k.tone],
              }}
            >
              <k.Icon size={13} color={TONE_FG[k.tone]} strokeWidth={2} />
            </span>
            <span style={{ fontSize: 11.5, color: PALETTE.mutedFg, fontWeight: 500 }}>{k.label}</span>
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.015em',
              color: TONE_FG[k.tone],
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {k.value}
          </div>
          <div style={{ marginTop: 4, fontSize: 10.5, color: '#9a8aa5' }}>{k.caption}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- 5B — Full Pastel: each tile fully tinted, white circular icon badge ---- */
function KpiGridB() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
      {KPI_DATA.map((k, i) => (
        <div
          key={i}
          style={{
            background: TONE_FILL[k.tone],
            border: 'none',
            borderRadius: 28,
            padding: '16px 14px 18px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 12,
              insetInlineEnd: 12,
              width: 28,
              height: 28,
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
              color: TONE_FG[k.tone],
            }}
          >
            <k.Icon size={13} color={TONE_FG[k.tone]} strokeWidth={2.2} />
          </div>
          <span style={{ display: 'block', fontSize: 11.5, color: TONE_FG[k.tone], fontWeight: 600, opacity: 0.8 }}>
            {k.label}
          </span>
          <div
            style={{
              marginTop: 16,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: TONE_FG[k.tone],
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {k.value}
          </div>
          <div style={{ marginTop: 4, fontSize: 10.5, color: TONE_FG[k.tone], opacity: 0.7 }}>{k.caption}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- 5C — Floating Numbers: no card outline, hairline dividers, big light type ---- */
function KpiGridC() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 24,
        overflow: 'hidden',
      }}
    >
      {KPI_DATA.map((k, i) => (
        <div
          key={i}
          style={{
            padding: '20px 16px 22px',
            borderInlineStart: i === 0 ? 'none' : `1px solid ${PALETTE.borderSoft}`,
            position: 'relative',
          }}
        >
          {/* tone dot — small chromatic anchor */}
          <span
            style={{
              position: 'absolute',
              top: 16,
              insetInlineEnd: 16,
              width: 8,
              height: 8,
              borderRadius: 999,
              background: TONE_FG[k.tone],
              opacity: 0.7,
            }}
          />
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: PALETTE.mutedFg,
            }}
          >
            {k.label}
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 30,
              fontWeight: 300,
              letterSpacing: '-0.04em',
              color: PALETTE.fg,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            {k.value}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: PALETTE.mutedFg,
              fontWeight: 400,
            }}
          >
            {k.caption}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   Charge bar
   ========================================================================== */
function ChargeBar({ sub }: { sub: Sub }) {
  return (
    <div
      style={{
        marginTop: 14,
        background: sub === 'c' ? 'transparent' : PALETTE.cardBg,
        border: sub === 'c' ? `1px dashed ${PALETTE.borderStrong}` : `1px solid ${PALETTE.borderSoft}`,
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
        <Banknote size={14} color={TONE_FG.success} strokeWidth={2.2} />
        <span style={{ color: PALETTE.mutedFg }}>כבר חויב:</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>₪ 12,840</strong>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CreditCard size={14} color={TONE_FG.warning} strokeWidth={2.2} />
        <span style={{ color: PALETTE.mutedFg }}>עוד יחויב:</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums', color: TONE_FG.warning }}>₪ 4,580</strong>
      </span>
      <span style={{ marginInlineStart: 'auto', fontSize: 11, color: PALETTE.mutedFg, opacity: 0.7 }}>
        לפי תאריכי חיוב
      </span>
    </div>
  );
}

/* ============================================================================
   Insight card
   ========================================================================== */
function InsightCard({
  sub,
  tone,
  Icon,
  title,
  body,
}: {
  sub: Sub;
  tone: 'warning' | 'success' | 'accent';
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  body: string;
}) {
  const isB = sub === 'b';
  const isC = sub === 'c';
  return (
    <div
      style={{
        background: isB ? TONE_FILL[tone] : PALETTE.cardBg,
        border: isC ? `1px solid ${PALETTE.borderSoft}` : isB ? 'none' : `1px solid ${PALETTE.borderSoft}`,
        borderRadius: isB ? 22 : 22,
        padding: '14px 14px 16px',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isB ? '#fff' : TONE_FILL[tone],
          color: TONE_FG[tone],
          flexShrink: 0,
        }}
      >
        <Icon size={15} color={TONE_FG[tone]} strokeWidth={2.2} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: TONE_FG[tone] }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: PALETTE.mutedFg, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

/* ============================================================================
   Donut + category list
   ========================================================================== */
function DonutCard({ sub }: { sub: Sub }) {
  const slices = [
    { color: '#d4b8e3', pct: 32 },
    { color: '#f4cf94', pct: 22 },
    { color: '#a4c2e0', pct: 18 },
    { color: '#b8d6a3', pct: 16 },
    { color: '#eeb5a4', pct: 12 },
  ];
  let acc = 0;
  const stops = slices
    .map((sl) => {
      const start = acc;
      acc += sl.pct;
      return `${sl.color} ${start}% ${acc}%`;
    })
    .join(', ');

  return (
    <div
      style={{
        background: sub === 'b' ? '#f3eee8' : PALETTE.cardBg,
        border: sub === 'b' ? 'none' : `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
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
            background: sub === 'b' ? '#f3eee8' : PALETTE.cardBg,
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

function CategoryList({ sub }: { sub: Sub }) {
  const rows = [
    { name: 'מזון וצרכים', amount: '₪ 5,580', pct: 32, color: '#d4b8e3' },
    { name: 'דיור', amount: '₪ 3,830', pct: 22, color: '#f4cf94' },
    { name: 'תחבורה', amount: '₪ 3,130', pct: 18, color: '#a4c2e0' },
    { name: 'בריאות', amount: '₪ 2,790', pct: 16, color: '#b8d6a3' },
    { name: 'בידור', amount: '₪ 2,090', pct: 12, color: '#eeb5a4' },
  ];
  return (
    <div
      style={{
        background: sub === 'b' ? '#f3eee8' : PALETTE.cardBg,
        border: sub === 'b' ? 'none' : `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: r.color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</span>
              <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.amount}</span>
            </div>
            <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: '#f3eee8', overflow: 'hidden' }}>
              <div style={{ width: `${r.pct}%`, height: '100%', background: r.color, borderRadius: 2 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   Recurring + Savings
   ========================================================================== */
function RecurringCard({ sub }: { sub: Sub }) {
  const rows = [
    { name: 'משכנתא', amount: '₪ 4,200' },
    { name: 'ארנונה', amount: '₪ 780' },
    { name: 'חשמל וגז', amount: '₪ 510' },
    { name: 'אינטרנט + טלפון', amount: '₪ 290' },
  ];
  return (
    <div
      style={{
        background: sub === 'b' ? TONE_FILL.accent : PALETTE.cardBg,
        border: sub === 'b' ? 'none' : `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: sub === 'b' ? TONE_FG.accent : PALETTE.fg }}>
          הוצאות קבועות חודשיות
        </h3>
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: TONE_FG.accent,
          }}
        >
          ₪ 6,820
        </span>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12.5,
              padding: '6px 0',
              borderTop: i === 0 ? 'none' : `1px solid ${sub === 'b' ? 'rgba(255,255,255,0.4)' : '#f5ede5'}`,
            }}
          >
            <span style={{ color: sub === 'b' ? TONE_FG.accent : PALETTE.mutedFg, opacity: 0.85 }}>{r.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: sub === 'b' ? TONE_FG.accent : PALETTE.fg }}>
              {r.amount}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavingsCard({ sub }: { sub: Sub }) {
  const goals = [
    { name: 'קרן חירום', current: 18500, target: 24000 },
    { name: 'דירה חדשה', current: 142000, target: 280000 },
    { name: 'חופשה 2026', current: 4200, target: 12000 },
  ];
  return (
    <div
      style={{
        background: sub === 'b' ? TONE_FILL.success : PALETTE.cardBg,
        border: sub === 'b' ? 'none' : `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: sub === 'b' ? TONE_FG.success : PALETTE.fg }}>
          מטרות חיסכון
        </h3>
        <PiggyBank size={16} color={TONE_FG.success} strokeWidth={2} />
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {goals.map((g, i) => {
          const pct = Math.min(100, Math.round((g.current / g.target) * 100));
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: sub === 'b' ? TONE_FG.success : PALETTE.fg }}>
                  {g.name}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: sub === 'b' ? TONE_FG.success : PALETTE.mutedFg,
                    fontVariantNumeric: 'tabular-nums',
                    opacity: 0.8,
                  }}
                >
                  ₪ {g.current.toLocaleString('he-IL')} / ₪ {g.target.toLocaleString('he-IL')}
                </span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  height: 5,
                  borderRadius: 3,
                  background: sub === 'b' ? 'rgba(255,255,255,0.4)' : '#f3eee8',
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: `${pct}%`, height: '100%', background: TONE_BG.success, borderRadius: 3 }} />
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
  sub,
  name,
  spent,
  budget,
  progress,
  tone,
}: {
  sub: Sub;
  name: string;
  spent: string;
  budget: string;
  progress: number;
  tone: Tone;
}) {
  return (
    <div
      style={{
        background: sub === 'b' ? TONE_FILL[tone] : PALETTE.cardBg,
        border: sub === 'b' ? 'none' : `1px solid ${PALETTE.borderSoft}`,
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
            background: sub === 'b' ? '#fff' : TONE_FILL[tone],
            color: TONE_FG[tone],
          }}
        >
          <Briefcase size={14} color={TONE_FG[tone]} strokeWidth={2.2} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: sub === 'b' ? TONE_FG[tone] : PALETTE.fg }}>
            {name}
          </div>
          <div style={{ fontSize: 11.5, color: sub === 'b' ? TONE_FG[tone] : PALETTE.mutedFg, marginTop: 2, opacity: 0.8 }}>
            {spent} מתוך {budget}
          </div>
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: sub === 'b' ? TONE_FG[tone] : PALETTE.fg }}>
          {progress}%
        </span>
      </div>
      <div
        style={{
          marginTop: 10,
          height: 5,
          borderRadius: 3,
          background: sub === 'b' ? 'rgba(255,255,255,0.4)' : '#f3eee8',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${progress}%`, height: '100%', background: TONE_BG[tone], borderRadius: 3 }} />
      </div>
    </div>
  );
}

/* ============================================================================
   Transactions list
   ========================================================================== */
function TxList({ sub }: { sub: Sub }) {
  const rows = [
    { d: '12/05', t: 'סופר אסום', a: -342, cat: 'מזון וצרכים' },
    { d: '11/05', t: 'משכורת — יניב', a: 14800, cat: 'הכנסה' },
    { d: '10/05', t: 'דלק פז', a: -287, cat: 'תחבורה' },
    { d: '09/05', t: 'נטפליקס', a: -49.9, cat: 'בידור' },
    { d: '08/05', t: 'גן עירוני', a: -1450, cat: 'ילדים' },
    { d: '07/05', t: 'שופרסל אונליין', a: -612, cat: 'מזון וצרכים' },
    { d: '06/05', t: 'ביטוח בריאות', a: -380, cat: 'בריאות' },
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
      {rows.map((r, i) => {
        const positive = r.a > 0;
        const tone: Tone = positive ? 'success' : 'destructive';
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
                  background: TONE_FILL[tone],
                  color: TONE_FG[tone],
                  fontSize: 13.5,
                  fontWeight: 700,
                }}
              >
                {positive ? '+' : '−'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.t}</div>
                <div style={{ fontSize: 11.5, color: PALETTE.mutedFg, marginTop: 2 }}>
                  {r.d} · {r.cat}
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: TONE_FG[tone],
              }}
            >
              {positive ? '+' : '−'}₪ {Math.abs(r.a).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================================
   AI Note card
   ========================================================================== */
function NoteCard({ sub }: { sub: Sub }) {
  const grad = 'linear-gradient(135deg, #e8d8f0 0%, #fae6c8 100%)';
  return (
    <div
      style={{
        background: grad,
        borderRadius: 22,
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: PALETTE.primary,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        <Sparkles size={18} color="#fff" strokeWidth={2.2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>הצעת חיסכון של ₪ 240 החודש</div>
        <div style={{ fontSize: 12, color: PALETTE.mutedFg, marginTop: 2 }}>
          הוצאה על שירותי סטרימינג גבוהה ב-37% מהממוצע — בדוק אילו כפילויות אפשר לבטל.
        </div>
      </div>
    </div>
  );
}
