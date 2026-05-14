/* eslint-disable @next/next/no-head-element */
// Full-dashboard mock styled in V2 (warm sunset) or V5 (soft pastel).
// Mirrors the real dashboard's structure: header + 6-tile KPI grid +
// charge-date bar + insights row + donut + recurring/savings + tx list +
// AI note. Throwaway preview — fully inline styles.

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

type Variant = '2' | '5';

const META: Record<Variant, { name: string }> = {
  '2': { name: 'חם — שקיעה וכרטיסים' },
  '5': { name: 'פסטל רך' },
};

export default async function FullDashboardPreview({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const sp = await searchParams;
  const v: Variant = (sp.v === '5' ? '5' : '2') as Variant;
  const t = THEME[v];

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        background: t.bg,
        color: t.fg,
        fontFamily: 'var(--font-heebo), system-ui, sans-serif',
      }}
    >
      {/* Top variant switcher */}
      <header
        style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${t.borderSoft}`,
          background: t.headerBg,
          backdropFilter: 'blur(8px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13, opacity: 0.75 }}>
          תצוגה: <strong>{META[v].name}</strong> · דשבורד מלא (mock)
        </div>
        <nav style={{ display: 'flex', gap: 8 }}>
          {(['2', '5'] as Variant[]).map((id) => (
            <Link
              key={id}
              href={`/design-preview/full?v=${id}`}
              style={{
                padding: '7px 14px',
                borderRadius: t.btnRadius,
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: 'none',
                border: v === id ? '1px solid transparent' : `1px solid ${t.borderStrong}`,
                background: v === id ? t.primaryBg : 'transparent',
                color: v === id ? t.primaryFg : 'inherit',
              }}
            >
              גרסה {id}
            </Link>
          ))}
          <Link
            href="/design-preview?v=2"
            style={{
              padding: '7px 14px',
              borderRadius: t.btnRadius,
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: 'none',
              border: `1px solid ${t.borderStrong}`,
              color: 'inherit',
            }}
          >
            ← תצוגה מקוצרת
          </Link>
        </nav>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px 80px' }}>
        {/* View stripe — anchors current view */}
        <div
          style={{
            height: 3,
            background: t.primaryBg,
            borderRadius: 2,
            marginBottom: 18,
            opacity: v === '5' ? 0.6 : 0.8,
          }}
        />

        {/* Dashboard header — title + month + view tabs + month switcher + CTA */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: v === '5' ? 600 : 700,
                letterSpacing: '-0.02em',
              }}
            >
              בית
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.65 }}>
              מאי 2026 <span style={{ opacity: 0.55, marginInlineStart: 6 }}>(11/04 – 10/05)</span>
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <ViewTabs variant={v} />
            <MonthSwitcher variant={v} />
            <ActionBtn variant={v} kind="primary" Icon={Plus}>תנועה חדשה</ActionBtn>
          </div>
        </div>

        {/* 6-tile KPI grid (real dashboard has 5 cols at lg) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 12,
          }}
        >
          <KpiTile variant={v} tone="destructive" label="הוצאות עד כה" value="₪ 17,420" caption="יום 12 מתוך 31" Icon={TrendingDown} />
          <KpiTile variant={v} tone="success" label="הכנסות" value="₪ 22,800" caption="3 משכורות" Icon={TrendingUp} />
          <KpiTile variant={v} tone="success" label="מאזן החודש" value="₪ 5,380" caption="הכנסות פחות הוצאות" Icon={Wallet} />
          <KpiTile variant={v} tone="primary" label="יתרה מצטברת" value="₪ 28,430" caption="לסוף מאי 2026" Icon={Banknote} />
          <KpiTile variant={v} tone="warning" label="תחזית סוף חודש" value="₪ 3,940" caption="19 ימים נותרו · 42 תנועות" Icon={TrendingUp} />
          <KpiTile variant={v} tone="accent" label="הוצאות קבועות" value="₪ 6,820" caption="30% מההכנסות" Icon={Repeat} />
        </div>

        {/* Charge-date cash-flow bar */}
        <div
          style={{
            marginTop: 12,
            background: t.cardBg,
            border: `1px solid ${t.borderSoft}`,
            borderRadius: t.cardRadius,
            padding: '12px 16px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 24,
            fontSize: 13,
            boxShadow: t.cardShadow,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Banknote size={14} color={t.successFg} strokeWidth={2.2} />
            <span style={{ opacity: 0.7 }}>כבר חויב:</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>₪ 12,840</strong>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CreditCard size={14} color={t.warningFg} strokeWidth={2.2} />
            <span style={{ opacity: 0.7 }}>עוד יחויב:</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: t.warningFg }}>₪ 4,580</strong>
          </span>
          <span style={{ marginInlineStart: 'auto', fontSize: 11, opacity: 0.5 }}>לפי תאריכי חיוב</span>
        </div>

        {/* AI Insights widget */}
        <Section variant={v} title="תובנות AI · מה כדאי לדעת השבוע" marginTop={28}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <InsightCard
              variant={v}
              tone="warning"
              Icon={BadgeAlert}
              title="בידור: 37% מעל הממוצע"
              body="הוצאת ₪ 412 על שירותי סטרימינג החודש לעומת ממוצע ₪ 300. שתי כפילויות (Netflix + Apple TV) זוהו."
            />
            <InsightCard
              variant={v}
              tone="success"
              Icon={Lightbulb}
              title="הזדמנות לחיסכון"
              body="התשלום החודשי על ביטוח רכב גבוה ב-22% מהממוצע באזורך. הצעת מחיר חדשה תחסוך כ-₪ 180 לחודש."
            />
            <InsightCard
              variant={v}
              tone="accent"
              Icon={Sparkles}
              title="3 תשלומים מסתיימים"
              body="תוכניות התשלומים: רהיטים (3/12), טלוויזיה (10/12), נסיעה (4/6). תשחרר ₪ 1,240 חודשי בסוף השנה."
            />
          </div>
        </Section>

        {/* Donut + categories breakdown */}
        <Section variant={v} title="פיצול הוצאות לפי קטגוריה" marginTop={28}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14 }}>
            <DonutCard variant={v} />
            <CategoryList variant={v} />
          </div>
        </Section>

        {/* Recurring + Savings paired row */}
        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <RecurringCard variant={v} />
          <SavingsCard variant={v} />
        </div>

        {/* Projects */}
        <Section variant={v} title="פרויקטים פעילים" marginTop={28}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <ProjectCard
              variant={v}
              name="שיפוץ מטבח"
              spent="₪ 28,400"
              budget="₪ 45,000"
              progress={63}
              color={t.accentBg}
            />
            <ProjectCard
              variant={v}
              name="חופשה ביוון · אוגוסט"
              spent="₪ 4,820"
              budget="₪ 12,000"
              progress={40}
              color={t.primaryBg}
            />
          </div>
        </Section>

        {/* Transactions */}
        <Section variant={v} title="תנועות אחרונות · מאי 2026" marginTop={28}>
          <TxList variant={v} />
        </Section>

        {/* AI Note */}
        <div style={{ marginTop: 24 }}>
          <NoteCard variant={v} />
        </div>
      </main>
    </div>
  );
}

/* ============================================================================
   Theme tokens
   ========================================================================== */
const THEME: Record<
  Variant,
  {
    bg: string;
    fg: string;
    headerBg: string;
    cardBg: string;
    cardRadius: number;
    cardShadow: string;
    borderSoft: string;
    borderStrong: string;
    primaryBg: string;
    primaryFg: string;
    accentBg: string;
    accentFg: string;
    successBg: string;
    successFg: string;
    warningBg: string;
    warningFg: string;
    destructiveBg: string;
    destructiveFg: string;
    mutedFg: string;
    btnRadius: number;
  }
> = {
  '2': {
    bg: '#fcfbf8',
    fg: '#0f172a',
    headerBg: 'rgba(255,255,255,0.85)',
    cardBg: '#ffffff',
    cardRadius: 18,
    cardShadow: '0 4px 14px -8px rgba(15, 23, 42, 0.12)',
    borderSoft: '#ececf4',
    borderStrong: '#d8dbe5',
    primaryBg: 'linear-gradient(135deg, #ff7a59 0%, #ffb347 100%)',
    primaryFg: '#fff',
    accentBg: 'linear-gradient(135deg, #ff7a59 0%, #ffb347 100%)',
    accentFg: '#b14f00',
    successBg: 'linear-gradient(135deg, #2ecc71 0%, #7ed957 100%)',
    successFg: '#0b7a4f',
    warningBg: 'linear-gradient(135deg, #ffc857 0%, #ffd97a 100%)',
    warningFg: '#a85e00',
    destructiveBg: 'linear-gradient(135deg, #ff5e62 0%, #ff9966 100%)',
    destructiveFg: '#b8364a',
    mutedFg: '#7a7a87',
    btnRadius: 12,
  },
  '5': {
    bg: '#fbf7f4',
    fg: '#2a2530',
    headerBg: 'rgba(255,255,255,0.85)',
    cardBg: '#ffffff',
    cardRadius: 22,
    cardShadow: 'none',
    borderSoft: '#efe7df',
    borderStrong: '#e7ddd2',
    primaryBg: '#5b3f70',
    primaryFg: '#fff',
    accentBg: '#fae6c8',
    accentFg: '#8a5a1c',
    successBg: '#d9ead0',
    successFg: '#3f6d40',
    warningBg: '#fae6c8',
    warningFg: '#8a5a1c',
    destructiveBg: '#f7d6cf',
    destructiveFg: '#9c4a3a',
    mutedFg: '#7a6a85',
    btnRadius: 999,
  },
};

/* ============================================================================
   View tabs + month switcher (top-bar controls)
   ========================================================================== */
function ViewTabs({ variant }: { variant: Variant }) {
  const t = THEME[variant];
  const tabs = [
    { id: 'combined', label: 'משולב', active: true },
    { id: 'personal', label: 'אישי', active: false },
    { id: 'business', label: 'עסקי', active: false },
  ];
  return (
    <div
      style={{
        display: 'inline-flex',
        background: variant === '5' ? '#f3eee8' : '#f1f1f7',
        borderRadius: variant === '5' ? 999 : 10,
        padding: 3,
        gap: 2,
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          style={{
            padding: '7px 14px',
            borderRadius: variant === '5' ? 999 : 8,
            border: 'none',
            cursor: 'pointer',
            fontSize: 12.5,
            fontWeight: tab.active ? 700 : 500,
            background: tab.active ? '#fff' : 'transparent',
            color: tab.active ? t.fg : t.mutedFg,
            boxShadow: tab.active && variant === '2' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function MonthSwitcher({ variant }: { variant: Variant }) {
  const t = THEME[variant];
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
        border: `1px solid ${t.borderStrong}`,
        borderRadius: variant === '5' ? 999 : 10,
        overflow: 'hidden',
        background: t.cardBg,
      }}
    >
      <button type="button" style={navBtn(t)}>
        <ChevronRight size={15} />
      </button>
      <span style={{ padding: '0 12px', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        מאי 2026
      </span>
      <button type="button" style={navBtn(t)}>
        <ChevronLeft size={15} />
      </button>
    </div>
  );
}

function navBtn(t: (typeof THEME)['2']): React.CSSProperties {
  return {
    width: 32,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: t.mutedFg,
  };
}

/* ============================================================================
   KPI tile
   ========================================================================== */
type Tone = 'primary' | 'success' | 'destructive' | 'accent' | 'warning';

function KpiTile({
  variant,
  tone,
  label,
  value,
  caption,
  Icon,
}: {
  variant: Variant;
  tone: Tone;
  label: string;
  value: string;
  caption?: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}) {
  const t = THEME[variant];
  const toneBg = ({ primary: t.primaryBg, success: t.successBg, destructive: t.destructiveBg, accent: t.accentBg, warning: t.warningBg } as const)[tone];
  const toneFg = ({ primary: '#1f3a8a', success: t.successFg, destructive: t.destructiveFg, accent: t.accentFg, warning: t.warningFg } as const)[tone];

  if (variant === '2') {
    // Sunset cards — white + colored icon-badge + corner gradient blob
    return (
      <div
        style={{
          background: t.cardBg,
          border: `1px solid ${t.borderSoft}`,
          borderRadius: t.cardRadius,
          padding: '14px 14px 16px',
          position: 'relative',
          boxShadow: t.cardShadow,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -40,
            insetInlineStart: -40,
            width: 130,
            height: 130,
            borderRadius: '50%',
            background: toneBg,
            opacity: 0.16,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: toneBg,
              color: '#fff',
            }}
          >
            <Icon size={14} color="#fff" strokeWidth={2.4} />
          </span>
          <span style={{ fontSize: 11.5, opacity: 0.65, fontWeight: 600 }}>{label}</span>
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: toneFg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
        {caption && <div style={{ marginTop: 4, fontSize: 10.5, opacity: 0.55 }}>{caption}</div>}
      </div>
    );
  }

  // V5 — pastel
  return (
    <div
      style={{
        background: t.cardBg,
        border: `1px solid ${t.borderSoft}`,
        borderRadius: t.cardRadius,
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
          background: toneBg,
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
            background: toneBg,
            color: toneFg,
          }}
        >
          <Icon size={13} color={toneFg} strokeWidth={2} />
        </span>
        <span style={{ fontSize: 11.5, color: t.mutedFg, fontWeight: 500 }}>{label}</span>
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: toneFg,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {caption && <div style={{ marginTop: 4, fontSize: 10.5, color: '#9a8aa5' }}>{caption}</div>}
    </div>
  );
}

/* ============================================================================
   Section header
   ========================================================================== */
function Section({
  variant,
  title,
  children,
  marginTop,
}: {
  variant: Variant;
  title: string;
  children: React.ReactNode;
  marginTop?: number;
}) {
  const t = THEME[variant];
  return (
    <section style={{ marginTop }}>
      <h2
        style={{
          margin: '0 0 12px',
          fontSize: variant === '5' ? 14 : 13,
          fontWeight: variant === '5' ? 500 : 600,
          letterSpacing: variant === '5' ? '0.02em' : '0.04em',
          textTransform: variant === '5' ? 'none' : 'uppercase',
          color: t.mutedFg,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ============================================================================
   AI insight card
   ========================================================================== */
function InsightCard({
  variant,
  tone,
  Icon,
  title,
  body,
}: {
  variant: Variant;
  tone: 'warning' | 'success' | 'accent';
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  body: string;
}) {
  const t = THEME[variant];
  const toneBg = ({ warning: t.warningBg, success: t.successBg, accent: t.accentBg } as const)[tone];
  const toneFg = ({ warning: t.warningFg, success: t.successFg, accent: t.accentFg } as const)[tone];
  return (
    <div
      style={{
        background: t.cardBg,
        border: `1px solid ${t.borderSoft}`,
        borderRadius: t.cardRadius,
        padding: '14px 14px 16px',
        boxShadow: t.cardShadow,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: variant === '5' ? 999 : 10,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: toneBg,
          color: toneFg,
          flexShrink: 0,
        }}
      >
        <Icon size={15} color={variant === '5' ? toneFg : '#fff'} strokeWidth={2.2} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: variant === '5' ? 600 : 700, color: toneFg }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7, lineHeight: 1.45 }}>{body}</div>
      </div>
    </div>
  );
}

/* ============================================================================
   Donut + category list
   ========================================================================== */
function DonutCard({ variant }: { variant: Variant }) {
  const t = THEME[variant];
  // 5-slice donut via conic-gradient
  const slices =
    variant === '2'
      ? [
          { color: '#ff7a59', pct: 32 },
          { color: '#ffb347', pct: 22 },
          { color: '#5b8cff', pct: 18 },
          { color: '#2ecc71', pct: 16 },
          { color: '#a06bff', pct: 12 },
        ]
      : [
          { color: '#d4b8e3', pct: 32 },
          { color: '#f4cf94', pct: 22 },
          { color: '#a4c2e0', pct: 18 },
          { color: '#b8d6a3', pct: 16 },
          { color: '#eeb5a4', pct: 12 },
        ];
  let acc = 0;
  const stops = slices
    .map((s) => {
      const start = acc;
      acc += s.pct;
      return `${s.color} ${start}% ${acc}%`;
    })
    .join(', ');

  return (
    <div
      style={{
        background: t.cardBg,
        border: `1px solid ${t.borderSoft}`,
        borderRadius: t.cardRadius,
        padding: '20px',
        boxShadow: t.cardShadow,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
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
            background: t.cardBg,
            borderRadius: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6 }}>סה"כ</div>
          <div style={{ fontSize: 20, fontWeight: variant === '5' ? 600 : 700, fontVariantNumeric: 'tabular-nums' }}>
            ₪ 17,420
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryList({ variant }: { variant: Variant }) {
  const t = THEME[variant];
  const rows =
    variant === '2'
      ? [
          { name: 'מזון וצרכים', amount: '₪ 5,580', pct: 32, color: '#ff7a59' },
          { name: 'דיור', amount: '₪ 3,830', pct: 22, color: '#ffb347' },
          { name: 'תחבורה', amount: '₪ 3,130', pct: 18, color: '#5b8cff' },
          { name: 'בריאות', amount: '₪ 2,790', pct: 16, color: '#2ecc71' },
          { name: 'בידור', amount: '₪ 2,090', pct: 12, color: '#a06bff' },
        ]
      : [
          { name: 'מזון וצרכים', amount: '₪ 5,580', pct: 32, color: '#d4b8e3' },
          { name: 'דיור', amount: '₪ 3,830', pct: 22, color: '#f4cf94' },
          { name: 'תחבורה', amount: '₪ 3,130', pct: 18, color: '#a4c2e0' },
          { name: 'בריאות', amount: '₪ 2,790', pct: 16, color: '#b8d6a3' },
          { name: 'בידור', amount: '₪ 2,090', pct: 12, color: '#eeb5a4' },
        ];

  return (
    <div
      style={{
        background: t.cardBg,
        border: `1px solid ${t.borderSoft}`,
        borderRadius: t.cardRadius,
        padding: '14px 16px',
        boxShadow: t.cardShadow,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 4,
              background: r.color,
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: variant === '5' ? 500 : 600 }}>{r.name}</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.amount}</span>
            </div>
            <div
              style={{
                marginTop: 6,
                height: 4,
                borderRadius: 2,
                background: variant === '5' ? '#f3eee8' : '#f1f1f7',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${r.pct}%`,
                  height: '100%',
                  background: r.color,
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
   Recurring + Savings cards
   ========================================================================== */
function RecurringCard({ variant }: { variant: Variant }) {
  const t = THEME[variant];
  const rows = [
    { name: 'משכנתא', amount: '₪ 4,200' },
    { name: 'ארנונה', amount: '₪ 780' },
    { name: 'חשמל וגז', amount: '₪ 510' },
    { name: 'אינטרנט + טלפון', amount: '₪ 290' },
  ];
  return (
    <div
      style={{
        background: t.cardBg,
        border: `1px solid ${t.borderSoft}`,
        borderRadius: t.cardRadius,
        padding: '16px 18px',
        boxShadow: t.cardShadow,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: variant === '5' ? 500 : 600 }}>
          הוצאות קבועות חודשיות
        </h3>
        <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: t.accentFg }}>
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
              borderTop: i === 0 ? 'none' : `1px solid ${variant === '5' ? '#f5ede5' : '#f5f5fa'}`,
            }}
          >
            <span style={{ opacity: 0.75 }}>{r.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavingsCard({ variant }: { variant: Variant }) {
  const t = THEME[variant];
  const goals = [
    { name: 'קרן חירום', current: 18500, target: 24000 },
    { name: 'דירה חדשה', current: 142000, target: 280000 },
    { name: 'חופשה 2026', current: 4200, target: 12000 },
  ];
  return (
    <div
      style={{
        background: t.cardBg,
        border: `1px solid ${t.borderSoft}`,
        borderRadius: t.cardRadius,
        padding: '16px 18px',
        boxShadow: t.cardShadow,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: variant === '5' ? 500 : 600 }}>
          מטרות חיסכון
        </h3>
        <PiggyBank size={16} color={t.successFg} strokeWidth={2} />
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {goals.map((g, i) => {
          const pct = Math.min(100, Math.round((g.current / g.target) * 100));
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: variant === '5' ? 500 : 600 }}>{g.name}</span>
                <span style={{ fontSize: 11.5, opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>
                  ₪ {g.current.toLocaleString('he-IL')} / ₪ {g.target.toLocaleString('he-IL')}
                </span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  height: 5,
                  borderRadius: 3,
                  background: variant === '5' ? '#f3eee8' : '#f1f1f7',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: t.successBg,
                    borderRadius: 3,
                  }}
                />
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
  variant,
  name,
  spent,
  budget,
  progress,
  color,
}: {
  variant: Variant;
  name: string;
  spent: string;
  budget: string;
  progress: number;
  color: string;
}) {
  const t = THEME[variant];
  return (
    <div
      style={{
        background: t.cardBg,
        border: `1px solid ${t.borderSoft}`,
        borderRadius: t.cardRadius,
        padding: '14px 16px',
        boxShadow: t.cardShadow,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: variant === '5' ? 999 : 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: color,
            color: '#fff',
          }}
        >
          <Briefcase size={14} color="#fff" strokeWidth={2.2} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: variant === '5' ? 500 : 700 }}>{name}</div>
          <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 2 }}>
            {spent} מתוך {budget}
          </div>
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {progress}%
        </span>
      </div>
      <div
        style={{
          marginTop: 10,
          height: 5,
          borderRadius: 3,
          background: variant === '5' ? '#f3eee8' : '#f1f1f7',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: color,
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  );
}

/* ============================================================================
   Action button
   ========================================================================== */
function ActionBtn({
  variant,
  kind,
  Icon,
  children,
}: {
  variant: Variant;
  kind: 'primary' | 'secondary' | 'ghost';
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  const t = THEME[variant];
  const isPrimary = kind === 'primary';
  return (
    <button
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: variant === '5' ? '9px 18px' : '9px 16px',
        borderRadius: t.btnRadius,
        fontSize: 13,
        fontWeight: variant === '5' ? 500 : 600,
        cursor: 'pointer',
        border: isPrimary ? '1px solid transparent' : `1px solid ${t.borderStrong}`,
        background: isPrimary ? t.primaryBg : t.cardBg,
        color: isPrimary ? t.primaryFg : t.fg,
        boxShadow: isPrimary && variant === '2' ? '0 6px 16px -6px rgba(255,122,89,0.55)' : 'none',
      }}
    >
      <Icon size={14} strokeWidth={2.4} />
      {children}
    </button>
  );
}

/* ============================================================================
   Transactions list
   ========================================================================== */
function TxList({ variant }: { variant: Variant }) {
  const t = THEME[variant];
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
        background: t.cardBg,
        border: `1px solid ${t.borderSoft}`,
        borderRadius: t.cardRadius,
        boxShadow: t.cardShadow,
        overflow: 'hidden',
      }}
    >
      {rows.map((r, i) => {
        const positive = r.a > 0;
        const iconBg = positive ? t.successBg : t.destructiveBg;
        const amountColor = positive ? t.successFg : t.destructiveFg;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderTop: i === 0 ? 'none' : `1px solid ${variant === '5' ? '#f5ede5' : '#f1f1f7'}`,
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: variant === '5' ? 999 : 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: iconBg,
                  color: variant === '5' ? amountColor : '#fff',
                  fontSize: 13.5,
                  fontWeight: 700,
                }}
              >
                {positive ? '+' : '−'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: variant === '5' ? 500 : 600 }}>{r.t}</div>
                <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 2 }}>
                  {r.d} · {r.cat}
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: amountColor,
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
function NoteCard({ variant }: { variant: Variant }) {
  const t = THEME[variant];
  const grad =
    variant === '2'
      ? 'linear-gradient(135deg, #fff5e6 0%, #ffeae0 100%)'
      : 'linear-gradient(135deg, #e8d8f0 0%, #fae6c8 100%)';
  const badgeBg = variant === '2' ? t.primaryBg : t.primaryBg;
  return (
    <div
      style={{
        background: grad,
        borderRadius: t.cardRadius,
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
          borderRadius: variant === '5' ? 999 : 12,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: badgeBg,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        <Sparkles size={18} color="#fff" strokeWidth={2.2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: variant === '5' ? 600 : 700 }}>
          הצעת חיסכון של ₪ 240 החודש
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
          הוצאה על שירותי סטרימינג גבוהה ב-37% מהממוצע — בדוק אילו כפילויות אפשר לבטל.
        </div>
      </div>
    </div>
  );
}
