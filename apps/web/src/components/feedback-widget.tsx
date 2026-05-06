'use client';

/**
 * Floating "leave feedback" button — visible on every page (mounted by
 * the (app) layout). Click opens a small modal with category + textarea.
 *
 * Why bottom-START (= right in RTL): bottom-end is occupied by the
 * chat-drawer's launcher; we sit on the opposite corner so they don't
 * collide on small screens. z-40 keeps it under modals (z-50) but
 * above the page content.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ThumbsUp, X, Loader2 } from 'lucide-react';
import { createFeedback } from '@/app/(app)/admin/feedback/actions';

type Category = 'bug' | 'ux' | 'feature' | 'other';

const CATEGORY_OPTIONS: Array<{ value: Category; label: string; hint: string }> = [
  { value: 'bug',     label: 'באג',         hint: 'משהו לא עובד / מציג שגיאה' },
  { value: 'ux',      label: 'UX / נראות',  hint: 'משהו לא ברור / מבלבל / יכול להיות יפה יותר' },
  { value: 'feature', label: 'פיצ׳ר חדש',   hint: 'הצעה לתוסף או יכולת חדשה' },
  { value: 'other',   label: 'אחר',         hint: 'כל שאר ההערות' },
];

export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen]         = useState(false);
  const [category, setCategory] = useState<Category>('other');
  const [message, setMessage]   = useState('');
  const [status, setStatus]     = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea when the modal opens (after mount).
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    setOpen(false);
    // Defer reset so the modal fade-out doesn't show stale "success" state.
    setTimeout(() => {
      setMessage('');
      setCategory('other');
      setStatus('idle');
      setErrorMsg(null);
    }, 200);
  }

  function submit() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setStatus('idle');
    setErrorMsg(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('category', category);
      fd.set('message', trimmed);
      fd.set('pagePath', pathname ?? '');
      if (typeof navigator !== 'undefined') fd.set('userAgent', navigator.userAgent);
      const r = await createFeedback(fd);
      if (r.ok) {
        setStatus('success');
        // Clear + auto-close after a beat so the user sees the confirmation.
        setMessage('');
        setTimeout(close, 1200);
      } else {
        setStatus('error');
        setErrorMsg(r.error ?? 'שגיאה');
      }
    });
  }

  return (
    <>
      {/* Floating launcher button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="שלח פידבק על האפליקציה"
        aria-label="שלח פידבק"
        className="fixed bottom-20 start-4 z-40 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg hover:bg-accent/40 md:bottom-4"
      >
        <ThumbsUp className="size-3.5 text-primary" />
        <span className="hidden sm:inline">פידבק</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            className="w-full max-w-md rounded-xl border bg-card p-5 shadow-xl"
            dir="rtl"
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 id="feedback-title" className="text-base font-semibold">פידבק על האפליקציה</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  עמוד נוכחי: <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{pathname || '/'}</code>
                </p>
              </div>
              <button onClick={close} aria-label="סגור" className="rounded-md p-1 text-muted-foreground hover:bg-accent/40">
                <X className="size-4" />
              </button>
            </div>

            {/* Category radios */}
            <div className="mb-3 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">סוג</label>
              <div className="grid grid-cols-2 gap-1">
                {CATEGORY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                      category === opt.value ? 'border-primary bg-primary-soft/40' : 'hover:bg-accent/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="fb-category"
                      value={opt.value}
                      checked={category === opt.value}
                      onChange={() => setCategory(opt.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-[10px] text-muted-foreground">{opt.hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Message */}
            <div className="mb-3 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">הפידבק שלך</label>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  // Submit on Ctrl/Cmd+Enter for keyboard users.
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
                }}
                rows={5}
                maxLength={4000}
                placeholder="לדוגמה: כפתור התיוג בעמוד תנועות חבוי כשהטבלה מתרחבת. הייתי מעדיף..."
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-[10px] text-muted-foreground/70">
                {message.length}/4000 · Ctrl+Enter לשליחה
              </p>
            </div>

            {/* Status */}
            {status === 'success' && (
              <div className="mb-3 rounded-md border border-success/40 bg-success-soft/40 p-2 text-xs text-success">
                ✓ הפידבק נשמר. ניתן לעיין ולייצא ב-<a href="/admin/feedback" className="underline">/admin/feedback</a>.
              </div>
            )}
            {status === 'error' && errorMsg && (
              <div className="mb-3 rounded-md border border-destructive/40 bg-destructive-soft/40 p-2 text-xs text-destructive">
                {errorMsg}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between">
              <a href="/admin/feedback" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                כל הפידבקים →
              </a>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/40"
                >
                  ביטול
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={isPending || !message.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isPending && <Loader2 className="size-3.5 animate-spin" />}
                  שלח
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
