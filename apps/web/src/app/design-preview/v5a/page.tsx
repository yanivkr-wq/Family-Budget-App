/* eslint-disable @next/next/no-head-element */
// V5א (Minimal Soft) — 3 layout variations for the main dashboard.
// All three share the same aesthetic: cream bg, white cards 22px-radius,
// 4px tonal stripe, round pastel icon badges, plum primary, light type.
// What differs is HOW the dashboard is composed — specifically where AI
// recommendations live.
//   ?l=1 → "אסיסטנט קודם"   AI hero at top, KPIs below
//   ?l=2 → "אסיסטנט בצד"   AI as persistent right sidebar (12-col split)
//   ?l=3 → "תובנות שזורות"  AI distributed inline next to relevant data

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
  MessageCircle,
  ArrowLeft,
} from 'lucide-react';

type Layout = '1' | '2' | '3';

const META: Record<Layout, { name: string; tagline: string }> = {
  '1': { name: 'אסיסטנט קודם', tagline: 'מערך 1 · AI ב-hero למעלה, KPIs מתחתיו' },
  '2': { name: 'אסיסטנט בצד', tagline: 'מערך 2 · AI כסרגל-צד קבוע משמאל' },
  '3': { name: 'תובנות שזורות', tagline: 'מערך 3 · AI מפוזר ליד הנתון הרלוונטי' },
};

export default async function V5aLayoutsPreview({
  searchParams,
}: {
  searchParams: Promise<{ l?: string }>;
}) {
  const sp = await searchParams;
  const l: Layout = (sp.l === '2' || sp.l === '3' ? sp.l : '1') as Layout;

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
            V5א · מינימלי — <span style={{ fontWeight: 500 }}>{META[l].name}</span>
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 2 }}>{META[l].tagline}</div>
        </div>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['1', '2', '3'] as Layout[]).map((id) => (
            <Link
              key={id}
              href={`/design-preview/v5a?l=${id}`}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: 'none',
                border: l === id ? '1px solid transparent' : `1px solid ${PALETTE.borderStrong}`,
                background: l === id ? PALETTE.primary : 'transparent',
                color: l === id ? '#fff' : 'inherit',
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
        <DashboardHeader />

        {l === '1' && <Layout1AIHero />}
        {l === '2' && <Layout2Sidebar />}
        {l === '3' && <Layout3Inline />}
      </main>
    </div>
  );
}

/* ============================================================================
   Layout 1 — AI Hero
   ========================================================================== */
function Layout1AIHero() {
  return (
    <>
      <AIHeroBlock />
      <CompactKpiStrip />
      <div style={{ marginTop: 14 }}>
        <ChargeBar />
      </div>
      <SectionTitle marginTop={32}>פיצול הוצאות לפי קטגוריה</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14, marginTop: 14 }}>
        <DonutCard />
        <CategoryList />
      </div>
      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <RecurringCard />
        <SavingsCard />
      </div>
      <SectionTitle marginTop={32}>פרויקטים פעילים</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <ProjectCard name="שיפוץ מטבח" spent="₪ 28,400" budget="₪ 45,000" progress={63} tone="accent" />
        <ProjectCard name="חופשה ביוון · אוגוסט" spent="₪ 4,820" budget="₪ 12,000" progress={40} tone="primary" />
      </div>
      <SectionTitle marginTop={32}>תנועות אחרונות · מאי 2026</SectionTitle>
      <div style={{ marginTop: 14 }}>
        <TxList compact />
      </div>
    </>
  );
}

/* ============================================================================
   Layout 2 — Sidebar AI
   ========================================================================== */
function Layout2Sidebar() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)',
        gap: 18,
        alignItems: 'flex-start',
      }}
    >
      {/* Main column */}
      <div>
        <CompactKpiGrid3Col />
        <div style={{ marginTop: 14 }}>
          <ChargeBar />
        </div>
        <SectionTitle marginTop={28}>פיצול הוצאות לפי קטגוריה</SectionTitle>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14 }}>
          <DonutCard />
          <CategoryList />
        </div>
        <SectionTitle marginTop={28}>פרויקטים פעילים</SectionTitle>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ProjectCard name="שיפוץ מטבח" spent="₪ 28,400" budget="₪ 45,000" progress={63} tone="accent" />
          <ProjectCard name="חופשה ביוון · אוגוסט" spent="₪ 4,820" budget="₪ 12,000" progress={40} tone="primary" />
        </div>
        <SectionTitle marginTop={28}>תנועות אחרונות · מאי 2026</SectionTitle>
        <div style={{ marginTop: 14 }}>
          <TxList compact />
        </div>
      </div>

      {/* Sidebar */}
      <aside style={{ position: 'sticky', top: 78 }}>
        <AISidebar />
      </aside>
    </div>
  );
}

/* ============================================================================
   Layout 3 — Inline AI (insights woven into relevant sections)
   ========================================================================== */
function Layout3Inline() {
  return (
    <>
      <KpiGridFull />
      <div style={{ marginTop: 14 }}>
        <ChargeBar />
      </div>

      {/* Single spotlight insight — most important AI recommendation, big */}
      <SectionTitle marginTop={28}>תובנת השבוע</SectionTitle>
      <div style={{ marginTop: 14 }}>
        <SpotlightInsight />
      </div>

      {/* Categories — with inline AI flags on noteworthy rows */}
      <SectionTitle marginTop={32}>פיצול הוצאות לפי קטגוריה</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14, marginTop: 14 }}>
        <DonutCard />
        <CategoryListWithAI />
      </div>

      {/* Recurring + Savings — each card has an inline AI nudge */}
      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <RecurringCardWithAI />
        <SavingsCardWithAI />
      </div>

      <SectionTitle marginTop={32}>פרויקטים פעילים</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <ProjectCard name="שיפוץ מטבח" spent="₪ 28,400" budget="₪ 45,000" progress={63} tone="accent" />
        <ProjectCard name="חופשה ביוון · אוגוסט" spent="₪ 4,820" budget="₪ 12,000" progress={40} tone="primary" />
      </div>

      <SectionTitle marginTop={32}>תנועות אחרונות · מאי 2026</SectionTitle>
      <div style={{ marginTop: 14 }}>
        <TxList compact />
      </div>
    </>
  );
}

/* ============================================================================
   Shared V5א palette + tones
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
};

type Tone = 'primary' | 'success' | 'destructive' | 'accent' | 'warning';

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

const TONE_BAR: Record<Tone, string> = {
  primary: '#d4b8e3',
  success: '#b8d6a3',
  destructive: '#eeb5a4',
  accent: '#f4cf94',
  warning: '#f4cf94',
};

/* ============================================================================
   Top controls
   ========================================================================== */
function DashboardHeader() {
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
        <ActionBtn kind="primary" Icon={Plus}>תנועה חדשה</ActionBtn>
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

function SectionTitle({ children, marginTop }: { children: React.ReactNode; marginTop?: number }) {
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
      {children}
    </h2>
  );
}

/* ============================================================================
   KPI variants
   ========================================================================== */
const KPI_DATA: Array<{ tone: Tone; label: string; value: string; caption: string; Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }> }> = [
  { tone: 'destructive', label: 'הוצאות עד כה', value: '₪ 17,420', caption: 'יום 12 מתוך 31', Icon: TrendingDown },
  { tone: 'success', label: 'הכנסות', value: '₪ 22,800', caption: '3 משכורות', Icon: TrendingUp },
  { tone: 'success', label: 'מאזן החודש', value: '₪ 5,380', caption: 'הכנסות פחות הוצאות', Icon: Wallet },
  { tone: 'primary', label: 'יתרה מצטברת', value: '₪ 28,430', caption: 'לסוף מאי 2026', Icon: Banknote },
  { tone: 'warning', label: 'תחזית סוף חודש', value: '₪ 3,940', caption: '19 ימים נותרו', Icon: TrendingUp },
  { tone: 'accent', label: 'הוצאות קבועות', value: '₪ 6,820', caption: '30% מההכנסות', Icon: Repeat },
];

function KpiTile({
  tone,
  label,
  value,
  caption,
  Icon,
  compact,
}: {
  tone: Tone;
  label: string;
  value: string;
  caption: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: compact ? '12px 12px 14px' : '14px 14px 16px',
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
          background: TONE_FILL[tone],
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: compact ? 26 : 30,
            height: compact ? 26 : 30,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: TONE_FILL[tone],
            color: TONE_FG[tone],
          }}
        >
          <Icon size={compact ? 12 : 13} color={TONE_FG[tone]} strokeWidth={2} />
        </span>
        <span style={{ fontSize: compact ? 11 : 11.5, color: PALETTE.mutedFg, fontWeight: 500 }}>{label}</span>
      </div>
      <div
        style={{
          marginTop: compact ? 10 : 12,
          fontSize: compact ? 18 : 22,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: TONE_FG[tone],
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: '#9a8aa5' }}>{caption}</div>
    </div>
  );
}

function KpiGridFull() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
      {KPI_DATA.map((k, i) => (
        <KpiTile key={i} {...k} />
      ))}
    </div>
  );
}

function CompactKpiStrip() {
  return (
    <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
      {KPI_DATA.map((k, i) => (
        <KpiTile key={i} {...k} compact />
      ))}
    </div>
  );
}

function CompactKpiGrid3Col() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {KPI_DATA.map((k, i) => (
        <KpiTile key={i} {...k} />
      ))}
    </div>
  );
}

/* ============================================================================
   AI: Hero block (Layout 1)
   ========================================================================== */
function AIHeroBlock() {
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${TONE_FILL.primary} 0%, ${TONE_FILL.accent} 100%)`,
        borderRadius: 24,
        padding: '22px 24px 20px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: PALETTE.primary,
            color: '#fff',
          }}
        >
          <Sparkles size={15} color="#fff" strokeWidth={2.2} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: PALETTE.primary, letterSpacing: '0.02em' }}>
          תובנות AI · מאי 2026
        </span>
      </div>

      <div style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.01em', maxWidth: 700, lineHeight: 1.4 }}>
        בוקר טוב, יניב 👋 החודש הוצאת ₪ 17,420 — צפוי שתחסוך כ-₪ 5,400.
        מצאתי <strong>הזדמנות לחיסכון של ₪ 180/חודש</strong> שכדאי לבדוק היום.
      </div>

      {/* Primary recommendation card */}
      <div
        style={{
          marginTop: 16,
          background: '#ffffff',
          border: `1px solid ${PALETTE.borderSoft}`,
          borderRadius: 18,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: TONE_FILL.success,
            color: TONE_FG.success,
            flexShrink: 0,
          }}
        >
          <Lightbulb size={16} color={TONE_FG.success} strokeWidth={2.2} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>הזדמנות לחיסכון על ביטוח רכב</div>
          <div style={{ fontSize: 12, color: PALETTE.mutedFg, marginTop: 2 }}>
            התשלום שלך גבוה ב-22% מהממוצע באזורך. שתי חברות פתוחות להצעה.
          </div>
        </div>
        <button
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 999,
            border: `1px solid ${PALETTE.primary}`,
            background: 'transparent',
            color: PALETTE.primary,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ראה הצעה
          <ArrowLeft size={12} strokeWidth={2.4} />
        </button>
      </div>

      {/* Secondary insight chips */}
      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <InsightChip tone="warning" Icon={BadgeAlert}>בידור: 37% מעל ממוצע (₪ 412)</InsightChip>
        <InsightChip tone="accent" Icon={Sparkles}>3 תשלומים מסתיימים השנה — ישחררו ₪ 1,240/חודש</InsightChip>
        <InsightChip tone="primary" Icon={MessageCircle}>שאל את ה-AI</InsightChip>
      </div>
    </div>
  );
}

function InsightChip({
  tone,
  Icon,
  children,
}: {
  tone: Tone;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 12px 6px 10px',
        borderRadius: 999,
        background: '#ffffff',
        border: `1px solid ${PALETTE.borderSoft}`,
        fontSize: 12,
        fontWeight: 500,
        color: TONE_FG[tone],
      }}
    >
      <Icon size={12} color={TONE_FG[tone]} strokeWidth={2.2} />
      {children}
    </span>
  );
}

/* ============================================================================
   AI: Sidebar (Layout 2)
   ========================================================================== */
function AISidebar() {
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '18px 16px',
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
          background: `linear-gradient(90deg, ${TONE_FILL.primary} 0%, ${TONE_FILL.accent} 100%)`,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: PALETTE.primary,
            color: '#fff',
          }}
        >
          <Sparkles size={13} color="#fff" strokeWidth={2.2} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: PALETTE.primary }}>תובנות AI</span>
      </div>
      <div style={{ fontSize: 11.5, color: PALETTE.mutedFg, marginBottom: 14, marginInlineStart: 38 }}>
        4 דברים שכדאי לדעת השבוע
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SidebarInsight
          tone="success"
          Icon={Lightbulb}
          title="חיסכון של ₪ 180/חודש"
          body="ביטוח רכב גבוה ב-22% מהממוצע באזורך."
        />
        <SidebarInsight
          tone="warning"
          Icon={BadgeAlert}
          title="בידור 37% מעל הממוצע"
          body="נטפליקס + Apple TV — כפילות?"
        />
        <SidebarInsight
          tone="accent"
          Icon={Sparkles}
          title="3 תשלומים מסתיימים"
          body="ישחררו ₪ 1,240/חודש בסוף השנה."
        />
        <SidebarInsight
          tone="primary"
          Icon={TrendingUp}
          title="חיסכון על קוד מסלול נכון"
          body="המסלול שלך בבנק לא הכי משתלם."
        />
      </div>

      <button
        type="button"
        style={{
          marginTop: 16,
          width: '100%',
          padding: '10px 14px',
          borderRadius: 999,
          background: PALETTE.primary,
          color: '#fff',
          border: 'none',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <MessageCircle size={14} strokeWidth={2.2} />
        שיחה עם העוזר
      </button>
    </div>
  );
}

function SidebarInsight({
  tone,
  Icon,
  title,
  body,
}: {
  tone: Tone;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 12px',
        background: '#fbf7f4',
        borderRadius: 14,
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: TONE_FILL[tone],
          color: TONE_FG[tone],
          flexShrink: 0,
        }}
      >
        <Icon size={12} color={TONE_FG[tone]} strokeWidth={2.2} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: TONE_FG[tone] }}>{title}</div>
        <div style={{ fontSize: 11.5, color: PALETTE.mutedFg, marginTop: 2, lineHeight: 1.4 }}>{body}</div>
      </div>
    </div>
  );
}

/* ============================================================================
   AI: Spotlight + inline pieces (Layout 3)
   ========================================================================== */
function SpotlightInsight() {
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        padding: '20px 22px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        gap: 18,
        alignItems: 'center',
      }}
    >
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
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: TONE_FILL.success,
          color: TONE_FG.success,
          flexShrink: 0,
        }}
      >
        <Lightbulb size={22} color={TONE_FG.success} strokeWidth={2} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: TONE_FG.success, letterSpacing: '0.04em' }}>
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
          background: PALETTE.primary,
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

/* AI-augmented category list — flags rows with insights */
function CategoryListWithAI() {
  const rows = [
    { name: 'מזון וצרכים', amount: '₪ 5,580', pct: 32, color: '#d4b8e3', flag: null },
    { name: 'דיור', amount: '₪ 3,830', pct: 22, color: '#f4cf94', flag: null },
    { name: 'תחבורה', amount: '₪ 3,130', pct: 18, color: '#a4c2e0', flag: null },
    { name: 'בריאות', amount: '₪ 2,790', pct: 16, color: '#b8d6a3', flag: null },
    { name: 'בידור', amount: '₪ 2,090', pct: 12, color: '#eeb5a4', flag: '37% מעל הממוצע' },
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
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: r.color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {r.name}
                {r.flag && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: TONE_FILL.warning,
                      color: TONE_FG.warning,
                      fontSize: 10.5,
                      fontWeight: 600,
                    }}
                  >
                    <BadgeAlert size={10} color={TONE_FG.warning} strokeWidth={2.4} />
                    {r.flag}
                  </span>
                )}
              </span>
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

function RecurringCardWithAI() {
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
        <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: TONE_FG.accent }}>
          ₪ 6,820
        </span>
      </div>

      {/* AI nudge */}
      <div
        style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 14,
          background: TONE_FILL.success,
          color: TONE_FG.success,
          fontSize: 12,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Lightbulb size={13} color={TONE_FG.success} strokeWidth={2.4} />
        <span>נטפליקס + Apple TV — האם שתיהן בשימוש פעיל? אפשר לחסוך ₪ 35/חודש.</span>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { name: 'משכנתא', amount: '₪ 4,200' },
          { name: 'ארנונה', amount: '₪ 780' },
          { name: 'חשמל וגז', amount: '₪ 510' },
          { name: 'אינטרנט + טלפון', amount: '₪ 290' },
        ].map((r, i) => (
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
            <span style={{ color: PALETTE.mutedFg }}>{r.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavingsCardWithAI() {
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
        <PiggyBank size={16} color={TONE_FG.success} strokeWidth={2} />
      </div>

      <div
        style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 14,
          background: TONE_FILL.primary,
          color: TONE_FG.primary,
          fontSize: 12,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Sparkles size={13} color={TONE_FG.primary} strokeWidth={2.4} />
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
              <div
                style={{
                  marginTop: 6,
                  height: 5,
                  borderRadius: 3,
                  background: '#f3eee8',
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: `${pct}%`, height: '100%', background: TONE_BAR.success, borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
   Shared body components
   ========================================================================== */
function ChargeBar() {
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
        <Banknote size={14} color={TONE_FG.success} strokeWidth={2.2} />
        <span style={{ color: PALETTE.mutedFg }}>כבר חויב:</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>₪ 12,840</strong>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CreditCard size={14} color={TONE_FG.warning} strokeWidth={2.2} />
        <span style={{ color: PALETTE.mutedFg }}>עוד יחויב:</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums', color: TONE_FG.warning }}>₪ 4,580</strong>
      </span>
      <span style={{ marginInlineStart: 'auto', fontSize: 11, color: PALETTE.mutedFg }}>לפי תאריכי חיוב</span>
    </div>
  );
}

function DonutCard() {
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

function CategoryList() {
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
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
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

function RecurringCard() {
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
        <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: TONE_FG.accent }}>
          ₪ 6,820
        </span>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { name: 'משכנתא', amount: '₪ 4,200' },
          { name: 'ארנונה', amount: '₪ 780' },
          { name: 'חשמל וגז', amount: '₪ 510' },
          { name: 'אינטרנט + טלפון', amount: '₪ 290' },
        ].map((r, i) => (
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
            <span style={{ color: PALETTE.mutedFg }}>{r.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavingsCard() {
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
        <PiggyBank size={16} color={TONE_FG.success} strokeWidth={2} />
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
                <div style={{ width: `${pct}%`, height: '100%', background: TONE_BAR.success, borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectCard({
  name,
  spent,
  budget,
  progress,
  tone,
}: {
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
            background: TONE_FILL[tone],
            color: TONE_FG[tone],
          }}
        >
          <Briefcase size={14} color={TONE_FG[tone]} strokeWidth={2.2} />
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
        <div style={{ width: `${progress}%`, height: '100%', background: TONE_BAR[tone], borderRadius: 3 }} />
      </div>
    </div>
  );
}

function TxList({ compact }: { compact?: boolean }) {
  const rows = [
    { d: '12/05', t: 'סופר אסום', a: -342, cat: 'מזון וצרכים' },
    { d: '11/05', t: 'משכורת — יניב', a: 14800, cat: 'הכנסה' },
    { d: '10/05', t: 'דלק פז', a: -287, cat: 'תחבורה' },
    { d: '09/05', t: 'נטפליקס', a: -49.9, cat: 'בידור' },
    { d: '08/05', t: 'גן עירוני', a: -1450, cat: 'ילדים' },
    { d: '07/05', t: 'שופרסל אונליין', a: -612, cat: 'מזון וצרכים' },
    { d: '06/05', t: 'ביטוח בריאות', a: -380, cat: 'בריאות' },
  ];
  const shown = compact ? rows.slice(0, 5) : rows;
  return (
    <div
      style={{
        background: PALETTE.cardBg,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 22,
        overflow: 'hidden',
      }}
    >
      {shown.map((r, i) => {
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
