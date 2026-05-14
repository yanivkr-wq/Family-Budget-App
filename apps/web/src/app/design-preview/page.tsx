/* eslint-disable @next/next/no-head-element */
// Standalone, throwaway design preview. 6 visual variants via ?v=1..6.
// Self-contained: every style is inline so we don't touch globals.css
// or tailwind config until we pick a winner.

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
} from 'lucide-react';

type Variant = '1' | '2' | '3' | '4' | '5' | '6';

const VARIANTS: Record<Variant, { name: string; tagline: string }> = {
  '1': { name: 'מודרני — אינדיגו ומנטה', tagline: 'גרסה 1 · פיינטק מודרני, צבעוני אבל נקי' },
  '2': { name: 'חם — שקיעה וכרטיסים', tagline: 'גרסה 2 · קונבטיבי, אבל עם חום וחיוניות' },
  '3': { name: 'זכוכית — מצב כהה', tagline: 'גרסה 3 · פרימיום, רקע כהה עם זוהר רך' },
  '4': { name: 'נאו-פופ — חצוצרני וכיפי', tagline: 'גרסה 4 · גבולות כהים, צבעים חשמליים, צללים קשים' },
  '5': { name: 'פסטל רך — שקט ונשיים', tagline: 'גרסה 5 · בהשראת Apple Health, פסטלים חמים, אווירה רגועה' },
  '6': { name: 'בנטו — כותרות גדולות', tagline: 'גרסה 6 · עיתונאי, מספרים ענקיים, רשת לא-שווה' },
};

export default async function DesignPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const sp = await searchParams;
  const raw = sp.v ?? '1';
  const v: Variant = (['1', '2', '3', '4', '5', '6'].includes(raw) ? raw : '1') as Variant;

  const shell = SHELL[v];

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        background: shell.bg,
        color: shell.fg,
        fontFamily: 'var(--font-heebo), system-ui, sans-serif',
      }}
    >
      {/* Top bar with variant switcher */}
      <header
        style={{
          padding: '14px 20px',
          borderBottom: shell.headerBorder,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          background: shell.headerBg,
          backdropFilter: 'blur(8px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
            תצוגת עיצוב — {VARIANTS[v].name}
          </div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{VARIANTS[v].tagline}</div>
        </div>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['1', '2', '3', '4', '5', '6'] as Variant[]).map((id) => (
            <Link
              key={id}
              href={`/design-preview?v=${id}`}
              style={{
                padding: '8px 14px',
                borderRadius: shell.navRadius,
                fontSize: 13,
                fontWeight: 700,
                textDecoration: 'none',
                border: v === id ? shell.navActiveBorder : shell.navIdleBorder,
                background: v === id ? shell.navActiveBg : 'transparent',
                color: v === id ? shell.navActiveFg : 'inherit',
                boxShadow: v === id ? shell.navActiveShadow : 'none',
              }}
            >
              גרסה {id}
            </Link>
          ))}
        </nav>
      </header>

      {/* Decorative orbs for V3 only */}
      {v === '3' && (
        <>
          <div style={ORB1} />
          <div style={ORB2} />
        </>
      )}

      <main style={{ position: 'relative', maxWidth: 1080, margin: '0 auto', padding: '28px 20px 60px' }}>
        <SectionTitle variant={v}>תקציר חודשי · מאי 2026</SectionTitle>

        {v === '6' ? (
          /* Bento layout — hero + 3 smaller */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gridTemplateRows: 'auto auto',
              gap: 12,
              marginTop: 14,
            }}
          >
            <div style={{ gridColumn: 'span 3', gridRow: 'span 2' }}>
              <KpiTile variant={v} tone="primary" label="יתרה מצטברת" value="₪ 28,430" caption="צפוי בסוף החודש" Icon={Wallet} hero />
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <KpiTile variant={v} tone="success" label="הכנסות" value="₪ 22,800" caption="3 משכורות" Icon={TrendingUp} />
            </div>
            <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <KpiTile variant={v} tone="destructive" label="הוצאות" value="₪ 17,420" caption="מתוך 20,000" Icon={TrendingDown} />
              <KpiTile variant={v} tone="accent" label="חיסכון" value="₪ 5,380" caption="24% מההכנסה" Icon={PiggyBank} />
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 14,
              marginTop: 14,
            }}
          >
            <KpiTile variant={v} tone="primary" label="יתרה מצטברת" value="₪ 28,430" caption="צפוי בסוף החודש" Icon={Wallet} />
            <KpiTile variant={v} tone="success" label="הכנסות" value="₪ 22,800" caption="3 משכורות" Icon={TrendingUp} />
            <KpiTile variant={v} tone="destructive" label="הוצאות" value="₪ 17,420" caption="מתוך תקציב 20,000" Icon={TrendingDown} />
            <KpiTile variant={v} tone="accent" label="חיסכון" value="₪ 5,380" caption="24% מההכנסה" Icon={PiggyBank} />
          </div>
        )}

        {/* Action row */}
        <div style={{ marginTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <ActionButton variant={v} kind="primary" Icon={Plus}>תנועה חדשה</ActionButton>
          <ActionButton variant={v} kind="secondary" Icon={Sparkles}>תובנות AI</ActionButton>
          <ActionButton variant={v} kind="ghost" Icon={CreditCard}>כרטיסי אשראי</ActionButton>
          <ActionButton variant={v} kind="ghost" Icon={Repeat}>הוראות קבע</ActionButton>
        </div>

        {/* Transactions */}
        <div style={{ marginTop: 28 }}>
          <SectionTitle variant={v}>תנועות אחרונות</SectionTitle>
          <TxList variant={v} />
        </div>

        {/* AI Note */}
        <div style={{ marginTop: 28 }}>
          <NoteCard variant={v} />
        </div>
      </main>
    </div>
  );
}

/* ============================================================================
   Shell palettes
   ========================================================================== */
const SHELL: Record<
  Variant,
  {
    bg: string;
    fg: string;
    headerBg: string;
    headerBorder: string;
    navRadius: number;
    navActiveBg: string;
    navActiveFg: string;
    navActiveBorder: string;
    navIdleBorder: string;
    navActiveShadow: string;
  }
> = {
  '1': {
    bg: '#f6f7fb',
    fg: '#0f172a',
    headerBg: 'rgba(255,255,255,0.85)',
    headerBorder: '1px solid #e6e8ee',
    navRadius: 999,
    navActiveBg: 'linear-gradient(135deg, #5b6cff 0%, #21d4a0 100%)',
    navActiveFg: '#fff',
    navActiveBorder: '1px solid transparent',
    navIdleBorder: '1px solid #d8dbe5',
    navActiveShadow: 'none',
  },
  '2': {
    bg: '#fcfbf8',
    fg: '#0f172a',
    headerBg: 'rgba(255,255,255,0.85)',
    headerBorder: '1px solid #ececdf',
    navRadius: 12,
    navActiveBg: 'linear-gradient(135deg, #ff7a59 0%, #ffb347 100%)',
    navActiveFg: '#fff',
    navActiveBorder: '1px solid transparent',
    navIdleBorder: '1px solid #d8dbe5',
    navActiveShadow: 'none',
  },
  '3': {
    bg: '#0b1020',
    fg: '#e6e8f2',
    headerBg: 'rgba(255,255,255,0.02)',
    headerBorder: '1px solid rgba(255,255,255,0.06)',
    navRadius: 12,
    navActiveBg: 'linear-gradient(135deg, #7c5cff 0%, #45e2c5 100%)',
    navActiveFg: '#fff',
    navActiveBorder: '1px solid transparent',
    navIdleBorder: '1px solid rgba(255,255,255,0.12)',
    navActiveShadow: 'none',
  },
  '4': {
    // Neo-Pop: cream bg, ink-black borders, electric accents
    bg: '#fef9ed',
    fg: '#0a0a0a',
    headerBg: '#fffbef',
    headerBorder: '3px solid #0a0a0a',
    navRadius: 8,
    navActiveBg: '#ffe05c',
    navActiveFg: '#0a0a0a',
    navActiveBorder: '2px solid #0a0a0a',
    navIdleBorder: '2px solid #0a0a0a',
    navActiveShadow: '3px 3px 0 0 #0a0a0a',
  },
  '5': {
    // Soft pastel: warm cream bg, calm tonal pastels
    bg: '#fbf7f4',
    fg: '#2a2530',
    headerBg: 'rgba(255,255,255,0.85)',
    headerBorder: '1px solid #efe7df',
    navRadius: 999,
    navActiveBg: '#e8dcef', // soft lavender
    navActiveFg: '#5b3f70',
    navActiveBorder: '1px solid transparent',
    navIdleBorder: '1px solid #e7ddd2',
    navActiveShadow: 'none',
  },
  '6': {
    // Bento magazine: warm off-white, very strong typography, one accent
    bg: '#f1ede4',
    fg: '#1a1a1a',
    headerBg: 'rgba(241,237,228,0.92)',
    headerBorder: '1px solid #d9d4c6',
    navRadius: 4,
    navActiveBg: '#1a1a1a',
    navActiveFg: '#f1ede4',
    navActiveBorder: '1px solid #1a1a1a',
    navIdleBorder: '1px solid #c5beac',
    navActiveShadow: 'none',
  },
};

const ORB1: React.CSSProperties = {
  position: 'absolute',
  top: 60,
  right: -100,
  width: 400,
  height: 400,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(124,92,255,0.25) 0%, transparent 60%)',
  pointerEvents: 'none',
};
const ORB2: React.CSSProperties = {
  position: 'absolute',
  top: 300,
  left: -120,
  width: 500,
  height: 500,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(69,226,197,0.18) 0%, transparent 60%)',
  pointerEvents: 'none',
};

/* ============================================================================
   Section title
   ========================================================================== */
function SectionTitle({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: Variant;
}) {
  if (variant === '4') {
    return (
      <h2
        style={{
          margin: 0,
          display: 'inline-block',
          padding: '4px 10px',
          background: '#0a0a0a',
          color: '#ffe05c',
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          borderRadius: 4,
        }}
      >
        {children}
      </h2>
    );
  }
  if (variant === '6') {
    return (
      <h2
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#1a1a1a',
          opacity: 0.7,
          borderTop: '1px solid #1a1a1a',
          paddingTop: 6,
        }}
      >
        {children}
      </h2>
    );
  }
  if (variant === '5') {
    return (
      <h2
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: '0.04em',
          color: '#7a6a85',
          textTransform: 'none',
        }}
      >
        {children}
      </h2>
    );
  }
  return (
    <h2
      style={{
        margin: 0,
        fontSize: 14,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        opacity: variant === '3' ? 0.6 : 0.55,
      }}
    >
      {children}
    </h2>
  );
}

/* ============================================================================
   KPI Tile
   ========================================================================== */
type Tone = 'primary' | 'success' | 'destructive' | 'accent';

function KpiTile({
  variant,
  tone,
  label,
  value,
  caption,
  Icon,
  hero,
}: {
  variant: Variant;
  tone: Tone;
  label: string;
  value: string;
  caption?: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  hero?: boolean;
}) {
  const palette = TILE_PALETTE[variant][tone];

  /* ---- V1 — Modern indigo (gradient bg, big number) ---- */
  if (variant === '1') {
    return (
      <div
        style={{
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          borderRadius: 16,
          padding: '16px 16px 18px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.75 }}>
          <Icon size={14} color={palette.fg} strokeWidth={2.2} />
          <span style={{ fontSize: 12, color: palette.fg, fontWeight: 600 }}>{label}</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: palette.fg, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        {caption && <div style={{ marginTop: 4, fontSize: 11.5, opacity: 0.6 }}>{caption}</div>}
      </div>
    );
  }

  /* ---- V2 — Sunset cards (white + icon badge + corner blob) ---- */
  if (variant === '2') {
    return (
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #ececf4',
          borderRadius: 18,
          padding: '16px 16px 18px',
          position: 'relative',
          boxShadow: '0 4px 14px -8px rgba(15, 23, 42, 0.12)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -40,
            insetInlineStart: -40,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: palette.gradient,
            opacity: 0.18,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: palette.gradient, color: '#fff' }}>
            <Icon size={16} color="#fff" strokeWidth={2.4} />
          </span>
          <span style={{ fontSize: 12.5, opacity: 0.7, fontWeight: 600 }}>{label}</span>
        </div>
        <div style={{ marginTop: 14, fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em', color: palette.fg, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        {caption && <div style={{ marginTop: 4, fontSize: 11.5, opacity: 0.6 }}>{caption}</div>}
      </div>
    );
  }

  /* ---- V3 — Glass dark ---- */
  if (variant === '3') {
    return (
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
          border: `1px solid ${palette.border}`,
          borderRadius: 18,
          padding: '16px 16px 18px',
          position: 'relative',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={14} color={palette.fg} strokeWidth={2.2} />
          <span style={{ fontSize: 12, color: '#a5acc7', fontWeight: 600 }}>{label}</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: palette.fg, fontVariantNumeric: 'tabular-nums', textShadow: `0 0 24px ${palette.glow}` }}>
          {value}
        </div>
        {caption && <div style={{ marginTop: 4, fontSize: 11.5, color: '#8088a8' }}>{caption}</div>}
      </div>
    );
  }

  /* ---- V4 — Neo-Pop — chunky borders, hard offset shadow ---- */
  if (variant === '4') {
    return (
      <div
        style={{
          background: palette.bg,
          border: '2.5px solid #0a0a0a',
          borderRadius: 12,
          padding: '14px 14px 16px',
          position: 'relative',
          boxShadow: '4px 4px 0 0 #0a0a0a',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#0a0a0a',
              color: palette.bg,
              border: '2px solid #0a0a0a',
            }}
          >
            <Icon size={15} color={palette.fg} strokeWidth={2.6} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#0a0a0a', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            {label}
          </span>
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            color: '#0a0a0a',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
        {caption && (
          <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: '#0a0a0a', opacity: 0.7 }}>{caption}</div>
        )}
      </div>
    );
  }

  /* ---- V5 — Soft Pastel ---- */
  if (variant === '5') {
    return (
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #efe7df',
          borderRadius: 22,
          padding: '20px 18px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* soft tonal stripe on top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            insetInlineStart: 0,
            insetInlineEnd: 0,
            height: 4,
            background: palette.bg,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: palette.bg,
              color: palette.fg,
            }}
          >
            <Icon size={15} color={palette.fg} strokeWidth={2} />
          </span>
          <span style={{ fontSize: 12.5, color: '#7a6a85', fontWeight: 500 }}>{label}</span>
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: palette.fg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
        {caption && (
          <div style={{ marginTop: 4, fontSize: 11.5, color: '#9a8aa5', fontWeight: 400 }}>{caption}</div>
        )}
      </div>
    );
  }

  /* ---- V6 — Bento Magazine ---- */
  // Hero: massive number takes the whole tile.
  const isHero = hero;
  return (
    <div
      style={{
        background: isHero ? '#1a1a1a' : '#ffffff',
        color: isHero ? '#f1ede4' : '#1a1a1a',
        border: isHero ? '1px solid #1a1a1a' : '1px solid #d9d4c6',
        borderRadius: 6,
        padding: isHero ? '22px 22px 24px' : '14px 14px 16px',
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: isHero ? 200 : 110,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: isHero ? 0.7 : 0.6 }}>
        <Icon size={isHero ? 16 : 13} color={isHero ? '#f1ede4' : '#1a1a1a'} strokeWidth={1.8} />
        <span style={{ fontSize: isHero ? 12 : 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      <div>
        <div
          style={{
            fontSize: isHero ? 56 : 26,
            fontWeight: 700,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
        {caption && (
          <div
            style={{
              marginTop: isHero ? 10 : 4,
              fontSize: isHero ? 13 : 11,
              opacity: isHero ? 0.65 : 0.55,
              fontWeight: 500,
            }}
          >
            {caption}
            {isHero && (
              <span
                style={{
                  display: 'inline-block',
                  marginInlineStart: 10,
                  padding: '2px 8px',
                  background: '#ff6b35',
                  color: '#fff',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                LIVE
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const TILE_PALETTE: Record<
  Variant,
  Record<Tone, { bg: string; border: string; fg: string; gradient: string; glow: string }>
> = {
  '1': {
    primary: { bg: 'linear-gradient(135deg, #eef0ff 0%, #f4f6ff 100%)', border: '#dde1ff', fg: '#3d4bd8', gradient: 'linear-gradient(135deg, #5b6cff 0%, #8b9cff 100%)', glow: '#5b6cff66' },
    success: { bg: 'linear-gradient(135deg, #e6faf2 0%, #f0fcf6 100%)', border: '#c9f0dd', fg: '#0f9b6e', gradient: 'linear-gradient(135deg, #21d4a0 0%, #5be3b9 100%)', glow: '#21d4a066' },
    destructive: { bg: 'linear-gradient(135deg, #fff0ee 0%, #fff5f3 100%)', border: '#ffd9d1', fg: '#d63b48', gradient: 'linear-gradient(135deg, #ff5a72 0%, #ff8a8a 100%)', glow: '#ff5a7266' },
    accent: { bg: 'linear-gradient(135deg, #f3edff 0%, #f8f3ff 100%)', border: '#e3d6ff', fg: '#7a3fd6', gradient: 'linear-gradient(135deg, #a06bff 0%, #c89bff 100%)', glow: '#a06bff66' },
  },
  '2': {
    primary: { bg: '#fff', border: '#ececf4', fg: '#1f3a8a', gradient: 'linear-gradient(135deg, #3461ff 0%, #5b8cff 100%)', glow: '#3461ff66' },
    success: { bg: '#fff', border: '#ececf4', fg: '#0b7a4f', gradient: 'linear-gradient(135deg, #2ecc71 0%, #7ed957 100%)', glow: '#2ecc7166' },
    destructive: { bg: '#fff', border: '#ececf4', fg: '#b8364a', gradient: 'linear-gradient(135deg, #ff5e62 0%, #ff9966 100%)', glow: '#ff5e6266' },
    accent: { bg: '#fff', border: '#ececf4', fg: '#b14f00', gradient: 'linear-gradient(135deg, #ff7a59 0%, #ffb347 100%)', glow: '#ff7a5966' },
  },
  '3': {
    primary: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(124,92,255,0.35)', fg: '#c7c2ff', gradient: 'linear-gradient(135deg, #7c5cff 0%, #b6a1ff 100%)', glow: '#7c5cff80' },
    success: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(69,226,197,0.35)', fg: '#7af0d0', gradient: 'linear-gradient(135deg, #45e2c5 0%, #7af0d0 100%)', glow: '#45e2c580' },
    destructive: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,108,138,0.35)', fg: '#ff8aa1', gradient: 'linear-gradient(135deg, #ff6c8a 0%, #ffa1b8 100%)', glow: '#ff6c8a80' },
    accent: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,176,99,0.35)', fg: '#ffc99a', gradient: 'linear-gradient(135deg, #ffb063 0%, #ffd5a0 100%)', glow: '#ffb06380' },
  },
  '4': {
    // Neo-Pop: each KPI has a solid pop fill behind it
    primary: { bg: '#a8e6ff', border: '#0a0a0a', fg: '#0a0a0a', gradient: '#a8e6ff', glow: 'transparent' },
    success: { bg: '#c8f04b', border: '#0a0a0a', fg: '#0a0a0a', gradient: '#c8f04b', glow: 'transparent' },
    destructive: { bg: '#ff9ab4', border: '#0a0a0a', fg: '#0a0a0a', gradient: '#ff9ab4', glow: 'transparent' },
    accent: { bg: '#ffe05c', border: '#0a0a0a', fg: '#0a0a0a', gradient: '#ffe05c', glow: 'transparent' },
  },
  '5': {
    // Soft Pastel: warm pastel tints
    primary: { bg: '#e8d8f0', border: '#e2d2ea', fg: '#5b3f70', gradient: 'linear-gradient(135deg, #d4b8e3 0%, #e8d8f0 100%)', glow: '#d4b8e366' },
    success: { bg: '#d9ead0', border: '#cfe1c5', fg: '#3f6d40', gradient: 'linear-gradient(135deg, #b8d6a3 0%, #d9ead0 100%)', glow: '#b8d6a366' },
    destructive: { bg: '#f7d6cf', border: '#f0c8be', fg: '#9c4a3a', gradient: 'linear-gradient(135deg, #eeb5a4 0%, #f7d6cf 100%)', glow: '#eeb5a466' },
    accent: { bg: '#fae6c8', border: '#f3dab5', fg: '#8a5a1c', gradient: 'linear-gradient(135deg, #f4cf94 0%, #fae6c8 100%)', glow: '#f4cf9466' },
  },
  '6': {
    primary: { bg: '#1a1a1a', border: '#1a1a1a', fg: '#f1ede4', gradient: '#1a1a1a', glow: 'transparent' },
    success: { bg: '#fff', border: '#d9d4c6', fg: '#1a1a1a', gradient: '#1a1a1a', glow: 'transparent' },
    destructive: { bg: '#fff', border: '#d9d4c6', fg: '#1a1a1a', gradient: '#1a1a1a', glow: 'transparent' },
    accent: { bg: '#ff6b35', border: '#ff6b35', fg: '#1a1a1a', gradient: '#ff6b35', glow: 'transparent' },
  },
};

/* ============================================================================
   Action button
   ========================================================================== */
function ActionButton({
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
  const styles = BUTTON_STYLES[variant][kind];
  return (
    <button
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: styles.padding,
        borderRadius: styles.radius,
        fontSize: 13.5,
        fontWeight: styles.fontWeight,
        cursor: 'pointer',
        border: styles.border,
        background: styles.bg,
        color: styles.fg,
        boxShadow: styles.shadow,
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        textTransform: styles.textTransform,
        letterSpacing: styles.letterSpacing,
      }}
    >
      <Icon size={15} strokeWidth={2.4} />
      {children}
    </button>
  );
}

type BtnStyle = {
  bg: string;
  fg: string;
  border: string;
  shadow: string;
  padding: string;
  radius: number;
  fontWeight: number;
  textTransform: React.CSSProperties['textTransform'];
  letterSpacing: string;
};

const BUTTON_STYLES: Record<Variant, Record<'primary' | 'secondary' | 'ghost', BtnStyle>> = {
  '1': {
    primary: { bg: 'linear-gradient(135deg, #5b6cff 0%, #21d4a0 100%)', fg: '#fff', border: '1px solid transparent', shadow: '0 6px 16px -6px rgba(91,108,255,0.55)', padding: '10px 18px', radius: 999, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
    secondary: { bg: '#fff', fg: '#3d4bd8', border: '1px solid #dde1ff', shadow: 'none', padding: '10px 16px', radius: 999, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
    ghost: { bg: 'transparent', fg: '#3a3f59', border: '1px solid transparent', shadow: 'none', padding: '10px 16px', radius: 999, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
  },
  '2': {
    primary: { bg: 'linear-gradient(135deg, #ff7a59 0%, #ffb347 100%)', fg: '#fff', border: '1px solid transparent', shadow: '0 6px 16px -6px rgba(255,122,89,0.55)', padding: '10px 16px', radius: 12, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
    secondary: { bg: '#fff', fg: '#b14f00', border: '1px solid #ffd9c2', shadow: 'none', padding: '10px 16px', radius: 12, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
    ghost: { bg: 'transparent', fg: '#3a3f59', border: '1px solid transparent', shadow: 'none', padding: '10px 16px', radius: 12, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
  },
  '3': {
    primary: { bg: 'linear-gradient(135deg, #7c5cff 0%, #45e2c5 100%)', fg: '#fff', border: '1px solid transparent', shadow: '0 8px 22px -8px rgba(124,92,255,0.6)', padding: '10px 16px', radius: 12, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
    secondary: { bg: 'rgba(255,255,255,0.06)', fg: '#c7c2ff', border: '1px solid rgba(255,255,255,0.12)', shadow: 'none', padding: '10px 16px', radius: 12, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
    ghost: { bg: 'transparent', fg: '#a5acc7', border: '1px solid transparent', shadow: 'none', padding: '10px 16px', radius: 12, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
  },
  '4': {
    primary: { bg: '#ffe05c', fg: '#0a0a0a', border: '2.5px solid #0a0a0a', shadow: '4px 4px 0 0 #0a0a0a', padding: '10px 18px', radius: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
    secondary: { bg: '#a8e6ff', fg: '#0a0a0a', border: '2.5px solid #0a0a0a', shadow: '4px 4px 0 0 #0a0a0a', padding: '10px 16px', radius: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
    ghost: { bg: '#fffbef', fg: '#0a0a0a', border: '2.5px solid #0a0a0a', shadow: '4px 4px 0 0 #0a0a0a', padding: '10px 16px', radius: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
  },
  '5': {
    primary: { bg: '#5b3f70', fg: '#fff', border: '1px solid transparent', shadow: '0 6px 18px -6px rgba(91,63,112,0.45)', padding: '11px 22px', radius: 999, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal' },
    secondary: { bg: '#fff', fg: '#5b3f70', border: '1px solid #e2d2ea', shadow: 'none', padding: '11px 22px', radius: 999, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal' },
    ghost: { bg: 'transparent', fg: '#7a6a85', border: '1px solid transparent', shadow: 'none', padding: '11px 22px', radius: 999, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal' },
  },
  '6': {
    primary: { bg: '#1a1a1a', fg: '#f1ede4', border: '1px solid #1a1a1a', shadow: 'none', padding: '11px 22px', radius: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' },
    secondary: { bg: 'transparent', fg: '#1a1a1a', border: '1px solid #1a1a1a', shadow: 'none', padding: '11px 22px', radius: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' },
    ghost: { bg: 'transparent', fg: '#1a1a1a', border: '1px solid transparent', shadow: 'none', padding: '11px 22px', radius: 4, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' },
  },
};

/* ============================================================================
   Sample transactions list
   ========================================================================== */
function TxList({ variant }: { variant: Variant }) {
  const rows = [
    { d: '12/05', t: 'סופר אסום', a: -342, cat: 'מזון' },
    { d: '11/05', t: 'משכורת — יניב', a: 14800, cat: 'הכנסה' },
    { d: '10/05', t: 'דלק פז', a: -287, cat: 'רכב' },
    { d: '09/05', t: 'נטפליקס', a: -49.9, cat: 'בידור' },
    { d: '08/05', t: 'גן עירוני', a: -1450, cat: 'ילדים' },
  ];

  const isDark = variant === '3';
  const isPop = variant === '4';
  const isPastel = variant === '5';
  const isMag = variant === '6';

  const wrapper: React.CSSProperties = {
    marginTop: 14,
    background: isDark
      ? 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)'
      : isPop
        ? '#fff'
        : isMag
          ? '#fff'
          : '#fff',
    border: isDark
      ? '1px solid rgba(255,255,255,0.08)'
      : isPop
        ? '2.5px solid #0a0a0a'
        : isPastel
          ? '1px solid #efe7df'
          : isMag
            ? '1px solid #d9d4c6'
            : '1px solid #ececf4',
    borderRadius: isPop ? 12 : isMag ? 6 : variant === '2' ? 18 : isPastel ? 22 : 16,
    overflow: 'hidden',
    boxShadow: variant === '2' ? '0 4px 14px -8px rgba(15, 23, 42, 0.12)' : isPop ? '4px 4px 0 0 #0a0a0a' : 'none',
  };

  return (
    <div style={wrapper}>
      {rows.map((r, i) => {
        const positive = r.a > 0;
        const sepColor = isDark
          ? 'rgba(255,255,255,0.05)'
          : isPop
            ? '#0a0a0a'
            : isPastel
              ? '#f5ede5'
              : isMag
                ? '#e5dfd2'
                : '#f1f1f7';
        const sepWidth = isPop ? '2px' : '1px';

        const amountColor = positive
          ? isDark
            ? '#7af0d0'
            : isPop
              ? '#1f7d3a'
              : isPastel
                ? '#3f6d40'
                : isMag
                  ? '#1a1a1a'
                  : '#0f9b6e'
          : isDark
            ? '#ff8aa1'
            : isPop
              ? '#c5253f'
              : isPastel
                ? '#9c4a3a'
                : isMag
                  ? '#1a1a1a'
                  : '#d63b48';

        const iconBg = positive
          ? variant === '4'
            ? '#c8f04b'
            : variant === '5'
              ? '#d9ead0'
              : variant === '6'
                ? '#1a1a1a'
                : variant === '3'
                  ? 'linear-gradient(135deg, #45e2c5 0%, #7af0d0 100%)'
                  : variant === '2'
                    ? 'linear-gradient(135deg, #2ecc71 0%, #7ed957 100%)'
                    : 'linear-gradient(135deg, #21d4a0 0%, #5be3b9 100%)'
          : variant === '4'
            ? '#ff9ab4'
            : variant === '5'
              ? '#f7d6cf'
              : variant === '6'
                ? '#fff'
                : variant === '3'
                  ? 'linear-gradient(135deg, #ff6c8a 0%, #ffa1b8 100%)'
                  : variant === '2'
                    ? 'linear-gradient(135deg, #ff5e62 0%, #ff9966 100%)'
                    : 'linear-gradient(135deg, #ff5a72 0%, #ff8a8a 100%)';

        const iconBorder = isPop ? '2px solid #0a0a0a' : isMag ? '1px solid #1a1a1a' : 'none';
        const iconColor = isPop ? '#0a0a0a' : isPastel ? (positive ? '#3f6d40' : '#9c4a3a') : isMag ? (positive ? '#f1ede4' : '#1a1a1a') : '#fff';

        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderTop: i === 0 ? 'none' : `${sepWidth} solid ${sepColor}`,
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: isPop ? 8 : isMag ? 4 : 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: iconBg,
                  border: iconBorder,
                  color: iconColor,
                  fontSize: 14,
                  fontWeight: isPop ? 900 : 700,
                }}
              >
                {positive ? '+' : '−'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: isPop ? 800 : isMag ? 600 : 600 }}>{r.t}</div>
                <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 2 }}>{r.d} · {r.cat}</div>
              </div>
            </div>
            <div
              style={{
                fontSize: isMag ? 16 : 14.5,
                fontWeight: isPop ? 900 : isMag ? 700 : 700,
                fontVariantNumeric: 'tabular-nums',
                color: amountColor,
                letterSpacing: isMag ? '-0.02em' : 'normal',
              }}
            >
              {positive ? '+' : '−'}₪{' '}
              {Math.abs(r.a).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
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
  const isDark = variant === '3';
  const isPop = variant === '4';
  const isPastel = variant === '5';
  const isMag = variant === '6';

  const grad =
    variant === '1'
      ? 'linear-gradient(135deg, #eef0ff 0%, #e6faf2 100%)'
      : variant === '2'
        ? 'linear-gradient(135deg, #fff5e6 0%, #ffeae0 100%)'
        : variant === '3'
          ? 'linear-gradient(135deg, rgba(124,92,255,0.18) 0%, rgba(69,226,197,0.14) 100%)'
          : isPop
            ? '#ffe05c'
            : isPastel
              ? 'linear-gradient(135deg, #e8d8f0 0%, #fae6c8 100%)'
              : '#1a1a1a';

  const iconBadge =
    variant === '1'
      ? 'linear-gradient(135deg, #5b6cff 0%, #21d4a0 100%)'
      : variant === '2'
        ? 'linear-gradient(135deg, #ff7a59 0%, #ffb347 100%)'
        : variant === '3'
          ? 'linear-gradient(135deg, #7c5cff 0%, #45e2c5 100%)'
          : isPop
            ? '#0a0a0a'
            : isPastel
              ? '#5b3f70'
              : '#ff6b35';

  return (
    <div
      style={{
        background: grad,
        color: isMag ? '#f1ede4' : 'inherit',
        border: isDark
          ? '1px solid rgba(255,255,255,0.08)'
          : isPop
            ? '2.5px solid #0a0a0a'
            : isMag
              ? '1px solid #1a1a1a'
              : '1px solid transparent',
        borderRadius: isPop ? 12 : isMag ? 6 : 16,
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: isPop ? '4px 4px 0 0 #0a0a0a' : 'none',
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: isPop ? 8 : isMag ? 4 : 12,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: iconBadge,
          border: isPop ? '2px solid #0a0a0a' : 'none',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        <Sparkles size={18} color={isPop ? '#ffe05c' : '#fff'} strokeWidth={2.4} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: isPop ? 900 : isMag ? 700 : 700, letterSpacing: isMag ? '-0.01em' : 'normal' }}>
          הצעת חיסכון של 240 ₪ החודש
        </div>
        <div style={{ fontSize: 12, opacity: isMag ? 0.75 : 0.7, marginTop: 2 }}>
          הוצאה על שירותי סטרימינג גבוהה ב-37% מהממוצע — בדוק אילו כפילויות אפשר לבטל.
        </div>
      </div>
    </div>
  );
}
