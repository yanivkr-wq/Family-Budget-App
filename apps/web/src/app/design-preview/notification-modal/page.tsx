'use client';

/**
 * Static design mockup for the "הוספת התראה" modal redesign.
 *
 * Shows three layout options stacked so you can scroll-compare them in
 * the real app's brand styling. No actual modal infrastructure, no real
 * state — every value is static. Switch between options visually, then
 * tell me which to wire into the real modal.
 *
 * Live at: /design-preview/notification-modal
 */

import { useState } from 'react';
import {
  X,
  Send,
  Trash2,
  Plus,
  Clock,
  Smartphone,
  Mail,
  MessageCircle,
  CalendarCheck,
  Sparkles,
  Settings2,
  CheckCircle2,
  Circle,
} from 'lucide-react';

const DEMO_DUE_DATE = '10/04/2026';
const DEMO_TITLE = 'דיינרס קלוב-י · ₪41,349';

export default function NotificationModalMockupPage() {
  const [activeOption, setActiveOption] = useState<'A' | 'B' | 'C'>('A');

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8" dir="rtl">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            עיצוב חדש למודאל &ldquo;הוספת התראה&rdquo;
          </h1>
          <p className="text-sm text-muted-foreground">
            שלוש גרסאות לבחירה. השוואה ויזואלית של אזור התזכורות.
          </p>
          {/* Quick-jump tabs */}
          <div className="inline-flex rounded-full border bg-card p-1 shadow-sm">
            {(['A', 'B', 'C'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setActiveOption(opt)}
                className={
                  activeOption === opt
                    ? 'rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm'
                    : 'rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
                }
              >
                {opt === 'A'
                  ? 'A · פריסט-דריבן'
                  : opt === 'B'
                  ? 'B · ציר זמן ויזואלי'
                  : 'C · קלפים קומפקטיים'}
              </button>
            ))}
          </div>
        </header>

        {activeOption === 'A' && <OptionAPresets />}
        {activeOption === 'B' && <OptionBTimeline />}
        {activeOption === 'C' && <OptionCCards />}

        <footer className="border-t pt-4 text-xs text-muted-foreground">
          הערה: זה Mockup סטטי בלבד. הכפתורים והבחירות בתוך כל גרסה לא משנים נתונים אמיתיים.
        </footer>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Shared header (the modal top — same across all 3 mockups)
// ═══════════════════════════════════════════════════════════════════════

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b bg-muted/20 px-5 py-3">
        <h2 className="text-base font-semibold">הוספת התראה</h2>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          aria-label="סגור"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Top section — same on every option (kept compact) */}
      <div className="space-y-3 border-b bg-muted/10 px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="כותרת המשימה *">
            <input
              type="text"
              defaultValue={DEMO_TITLE}
              className="form-input w-full"
            />
          </Field>
          <Field label="תאריך יעד *">
            <input
              type="text"
              defaultValue={DEMO_DUE_DATE}
              className="form-input w-full text-start"
              dir="ltr"
            />
          </Field>
        </div>

        <Field label="תיאור">
          <textarea
            rows={1}
            placeholder="פרטים נוספים שיוצגו בהתראה"
            className="form-input w-full"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="קטגוריה">
            <select className="form-input w-full">
              <option>כ.אשראי - ריכוז חיובים</option>
            </select>
          </Field>
          <Field label="תנועה קשורה">
            <select className="form-input w-full">
              <option>2026-04-10 · דיינרס קלוב-י</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="סטטוס">
            <select className="form-input w-full">
              <option>פעיל</option>
            </select>
          </Field>
          <Field label="חזרה">
            <select className="form-input w-full">
              <option>חד-פעמי</option>
            </select>
          </Field>
        </div>
      </div>

      {children}

      {/* Footer — same on every option */}
      <div className="flex items-center justify-between gap-2 border-t bg-muted/10 px-5 py-3">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/20"
        >
          <Send className="size-3.5" />
          שלח בדיקה
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            ביטול
          </button>
          <button
            type="button"
            className="rounded-full bg-primary px-5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            הוסף
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// OPTION A — Preset-driven
// ═══════════════════════════════════════════════════════════════════════

function OptionAPresets() {
  // Hard-coded "selected" set so the mockup looks alive.
  const presets = [
    { key: 'day-of', label: 'ביום היעד', resolved: '10/04/2026', selected: false },
    { key: '1d', label: '1 יום לפני', resolved: '09/04/2026', selected: false },
    { key: '3d', label: '3 ימים לפני', resolved: '07/04/2026', selected: true },
    { key: '7d', label: 'שבוע לפני', resolved: '03/04/2026', selected: true },
    { key: '14d', label: 'שבועיים לפני', resolved: '27/03/2026', selected: false },
    { key: '30d', label: 'חודש לפני', resolved: '10/03/2026', selected: false },
  ];

  return (
    <>
      <OptionHeading
        letter="A"
        title="פריסט-דריבן"
        subtitle="אין הזנת מספר ימים ידנית. הצ׳יפים בעצמם הם הדרך להוסיף תזכורת — לחץ להפעלה/כיבוי."
      />

      <ModalShell>
        <div className="space-y-5 px-5 py-5">
          {/* Section title */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">תזכורות</h3>
            <span className="text-2xs text-muted-foreground">
              {presets.filter((p) => p.selected).length} פעילות
            </span>
          </div>

          {/* Presets */}
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              מתי להזכיר? (לחץ להפעלה/כיבוי)
            </p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={
                    p.selected
                      ? 'inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm'
                      : 'inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted'
                  }
                >
                  {p.selected ? <CheckCircle2 className="size-3" /> : <Circle className="size-3 opacity-40" />}
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3" />
                מותאם...
              </button>
            </div>
          </div>

          {/* Global channels + time */}
          <div className="rounded-xl border bg-card/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Settings2 className="size-3.5 text-muted-foreground" />
              <h4 className="text-xs font-semibold">ערוצים ושעה (חל על כל התזכורות)</h4>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="שעת שליחה">
                <input
                  type="text"
                  defaultValue="09:00"
                  className="form-input w-full"
                />
              </Field>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  ערוצים
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <ChannelChip active icon={<Smartphone className="size-3" />} label="באפליקציה" />
                  <ChannelChip icon={<Mail className="size-3" />} label="דוא&quot;ל" />
                  <ChannelChip icon={<MessageCircle className="size-3" />} label="WhatsApp" />
                </div>
              </div>
            </div>
            <button
              type="button"
              className="text-2xs text-accent underline-offset-2 hover:underline"
            >
              ◌ הגדר ערוצים נפרדים לכל תזכורת (מתקדם)
            </button>
          </div>

          {/* Resolved summary */}
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <h4 className="text-xs font-semibold text-accent">סיכום</h4>
            </div>
            <p className="text-sm">
              <span className="font-semibold tabular-nums">2 תזכורות</span> יישלחו ב-באפליקציה בשעה 09:00:
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <CalendarCheck className="size-3 text-accent" />
                <span className="tabular-nums">03/04/2026</span> · שבוע לפני
              </li>
              <li className="flex items-center gap-2">
                <CalendarCheck className="size-3 text-accent" />
                <span className="tabular-nums">07/04/2026</span> · 3 ימים לפני
              </li>
            </ul>
          </div>
        </div>
      </ModalShell>
    </>
  );
}

function ChannelChip({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={
        active
          ? 'inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-1 text-2xs font-medium text-accent'
          : 'inline-flex items-center gap-1 rounded-full border bg-card px-2 py-1 text-2xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
      }
    >
      {icon}
      {label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// OPTION B — Visual timeline
// ═══════════════════════════════════════════════════════════════════════

function OptionBTimeline() {
  // Positions are pct from start; selected reminder gets the editor expanded.
  const reminders = [
    { id: '1', label: 'שבוע לפני', date: '03/04/2026', position: 28, time: '09:00', selected: false },
    { id: '2', label: '3 ימים לפני', date: '07/04/2026', position: 58, time: '09:00', selected: true },
    { id: '3', label: '1 יום לפני', date: '09/04/2026', position: 82, time: '09:00', selected: false },
  ];

  return (
    <>
      <OptionHeading
        letter="B"
        title="ציר זמן ויזואלי"
        subtitle="ראייה אחת של כל התזכורות לאורך הזמן עד התאריך. לחץ על נקודה לעריכה."
      />

      <ModalShell>
        <div className="space-y-5 px-5 py-5">
          {/* Section title */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">תזכורות</h3>
            <span className="text-2xs text-muted-foreground">3 פעילות</span>
          </div>

          {/* Quick add */}
          <div>
            <p className="mb-2 text-xs text-muted-foreground">קפיצה מהירה:</p>
            <div className="flex flex-wrap gap-2">
              <button className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted">
                <Plus className="size-3" /> 1 יום
              </button>
              <button className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted">
                <Plus className="size-3" /> 3 ימים
              </button>
              <button className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted">
                <Plus className="size-3" /> שבוע
              </button>
              <button className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted">
                <Plus className="size-3" /> שבועיים
              </button>
              <button className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted">
                <Plus className="size-3" /> חודש
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-xl border bg-card/50 p-5 space-y-6">
            <div className="flex items-center justify-between text-2xs text-muted-foreground">
              <span>היום · 13/05/2026</span>
              <span className="text-accent font-semibold">יעד · {DEMO_DUE_DATE}</span>
            </div>
            <div className="relative h-12">
              {/* Track */}
              <div className="absolute top-1/2 left-0 right-0 h-0.5 -translate-y-1/2 rounded-full bg-muted" />
              {/* Today dot */}
              <div className="absolute right-0 top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-muted-foreground/40" />
              {/* Target dot */}
              <div className="absolute left-0 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-accent bg-accent-foreground shadow-sm flex items-center justify-center">
                <CalendarCheck className="size-2 text-accent" />
              </div>
              {/* Reminder dots */}
              {reminders.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={
                    r.selected
                      ? 'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary shadow-md ring-4 ring-primary/20'
                      : 'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-card hover:ring-4 hover:ring-primary/15'
                  }
                  style={{ right: `${r.position}%` }}
                  aria-label={`תזכורת ${r.label}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-2xs">
              {reminders.map((r) => (
                <div
                  key={r.id}
                  className={
                    r.selected
                      ? 'text-foreground font-semibold flex flex-col items-center gap-0.5'
                      : 'text-muted-foreground flex flex-col items-center gap-0.5'
                  }
                  style={{ width: '100px' }}
                >
                  <span className="tabular-nums">{r.date}</span>
                  <span className="opacity-80">{r.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Inline editor (for the selected dot) */}
          <div className="rounded-xl border border-primary/30 bg-primary-soft/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">תזכורת · 3 ימים לפני</p>
                <p className="text-2xs text-muted-foreground tabular-nums">07/04/2026</p>
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                aria-label="מחק תזכורת"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="שעה">
                <input
                  type="text"
                  defaultValue="09:00"
                  className="form-input w-full"
                />
              </Field>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  ערוצים
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <ChannelChip active icon={<Smartphone className="size-3" />} label="באפליקציה" />
                  <ChannelChip icon={<Mail className="size-3" />} label="דוא&quot;ל" />
                  <ChannelChip icon={<MessageCircle className="size-3" />} label="WhatsApp" />
                </div>
              </div>
            </div>
            <p className="text-2xs text-muted-foreground">
              💡 לחץ על נקודה אחרת בציר כדי לערוך תזכורת אחרת. גרור נקודה כדי לזוז.
            </p>
          </div>
        </div>
      </ModalShell>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// OPTION C — Compact cards
// ═══════════════════════════════════════════════════════════════════════

function OptionCCards() {
  const reminders = [
    { id: '1', offset: 'שבוע לפני', date: '03/04/2026', time: '09:00', active: true, channels: ['app'] },
    { id: '2', offset: 'יום אחד לפני', date: '09/04/2026', time: '09:00', active: true, channels: ['app', 'email'] },
  ];

  return (
    <>
      <OptionHeading
        letter="C"
        title="קלפים קומפקטיים"
        subtitle="קרוב למצב הקיים — שתי שורות לכל תזכורת, ערוצים כצ׳יפים ברורים, צ׳יפים מהירים מסומנים +."
      />

      <ModalShell>
        <div className="space-y-4 px-5 py-5">
          {/* Section title */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">תזכורות</h3>
            <span className="text-2xs text-muted-foreground">{reminders.length} תזכורות</span>
          </div>

          {/* Quick add chips */}
          <div>
            <p className="mb-2 text-xs text-muted-foreground">הוספה מהירה:</p>
            <div className="flex flex-wrap gap-2">
              {['ביום היעד', '1 יום לפני', '3 ימים', 'שבוע', 'חודש'].map((label) => (
                <button
                  key={label}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <Plus className="size-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Reminder cards */}
          <div className="space-y-2">
            {reminders.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border bg-card overflow-hidden"
              >
                {/* Card header — bold */}
                <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.active}
                      readOnly
                      className="rounded"
                    />
                    <span className="text-sm font-semibold">{r.offset}</span>
                    <span className="text-2xs text-muted-foreground tabular-nums">
                      ({r.date})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground tabular-nums">
                      <Clock className="size-3" />
                      {r.time}
                    </span>
                    <button
                      type="button"
                      className="rounded-md p-1 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                      aria-label="מחק"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                {/* Card body — channels */}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="text-2xs text-muted-foreground">ערוצים:</span>
                  <ChannelChip
                    active={r.channels.includes('app')}
                    icon={<Smartphone className="size-3" />}
                    label="באפליקציה"
                  />
                  <ChannelChip
                    active={r.channels.includes('email')}
                    icon={<Mail className="size-3" />}
                    label="דוא&quot;ל"
                  />
                  <ChannelChip
                    active={r.channels.includes('whatsapp')}
                    icon={<MessageCircle className="size-3" />}
                    label="WhatsApp"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Add custom button */}
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-dashed bg-card/50 px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" />
            הוסף תזכורת מותאמת
          </button>
        </div>
      </ModalShell>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Shared option-heading banner
// ═══════════════════════════════════════════════════════════════════════

function OptionHeading({
  letter,
  title,
  subtitle,
}: {
  letter: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground text-lg font-bold shadow-sm">
        {letter}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

