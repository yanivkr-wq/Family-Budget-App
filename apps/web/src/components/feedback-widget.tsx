'use client';

/**
 * Floating "leave feedback" button + hover menu.
 *
 * Hover-reveal menu offers two ways to file feedback:
 *   • Form (default): opens the existing modal with category + message
 *   • Camera: captures a full-page screenshot via html2canvas, then opens
 *     the modal with the image preview attached. The user can add text
 *     context before submitting.
 *
 * Why hover-reveal vs persistent buttons: keeps the resting UI tiny (one
 * launcher pill) and only surfaces the choice when the user signals intent.
 *
 * Why bottom-START (= right in RTL): bottom-end is occupied by the
 * chat-drawer's launcher; we sit on the opposite corner so they don't
 * collide on small screens.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ThumbsUp, X, Loader2, Camera, MessageSquare, Image as ImageIcon } from 'lucide-react';
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
  const [hover, setHover] = useState(false); // controls hover menu visibility
  const [open, setOpen]         = useState(false);
  const [category, setCategory] = useState<Category>('other');
  const [message, setMessage]   = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus]     = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setScreenshot(null);
      setStatus('idle');
      setErrorMsg(null);
    }, 200);
  }

  function openFormMode() {
    setHover(false);
    setScreenshot(null);
    setOpen(true);
  }

  /**
   * Capture a full-page screenshot via html2canvas, then open the modal
   * with the image attached. Captures the document body — the floating
   * widget itself is hidden during the capture so it doesn't appear in
   * the screenshot.
   *
   * Why html2canvas: zero-permission browser-side rendering of the DOM to
   * a canvas. Doesn't need getDisplayMedia (which would prompt for screen
   * share). Doesn't capture browser chrome — just the page content.
   */
  async function openCameraMode() {
    setHover(false);
    setCapturing(true);
    try {
      // Dynamic import keeps html2canvas (~50KB gz) out of the initial bundle
      const { default: html2canvas } = await import('html2canvas');
      // Hide our floating launcher so it doesn't appear in the shot
      const launcher = document.querySelector('[data-feedback-launcher]') as HTMLElement | null;
      if (launcher) launcher.style.visibility = 'hidden';
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        logging: false,
        // Use the actual content size, not just viewport, so we capture the
        // full scrollable page.
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
      });
      if (launcher) launcher.style.visibility = '';
      const dataUri = canvas.toDataURL('image/png');
      setScreenshot(dataUri);
      setOpen(true);
    } catch (err) {
      console.error('screenshot capture failed', err);
      setErrorMsg(err instanceof Error ? err.message : 'שגיאה בלכידת מסך');
      setStatus('error');
      setOpen(true);
    } finally {
      setCapturing(false);
    }
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
      if (screenshot) fd.set('screenshotData', screenshot);
      const r = await createFeedback(fd);
      if (r.ok) {
        setStatus('success');
        setMessage('');
        setTimeout(close, 1200);
      } else {
        setStatus('error');
        setErrorMsg(r.error ?? 'שגיאה');
      }
    });
  }

  // Hover handlers with a small delay so the menu doesn't dance when the
  // mouse briefly leaves and returns.
  function onLauncherMouseEnter() {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setHover(true);
  }
  function onLauncherMouseLeave() {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setHover(false), 200);
  }

  return (
    <>
      {/* Floating launcher container — hover area for the menu */}
      <div
        data-feedback-launcher
        className="fixed bottom-20 start-4 z-40 md:bottom-4"
        onMouseEnter={onLauncherMouseEnter}
        onMouseLeave={onLauncherMouseLeave}
      >
        {/* Hover-reveal menu — sits ABOVE the main button */}
        {hover && !open && (
          <div className="mb-2 flex flex-col gap-1.5 rounded-xl border bg-card p-1.5 shadow-lg" dir="rtl">
            <button
              type="button"
              onClick={openFormMode}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/40"
              title="כתוב פידבק"
            >
              <MessageSquare className="size-3.5 text-primary" />
              פידבק טקסט
            </button>
            <button
              type="button"
              onClick={openCameraMode}
              disabled={capturing}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/40 disabled:opacity-50"
              title="צלם תמונת מסך וצרף אותה לפידבק"
            >
              {capturing ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <Camera className="size-3.5 text-primary" />}
              {capturing ? 'מצלם...' : 'צילום מסך + פידבק'}
            </button>
          </div>
        )}

        {/* Main launcher button — clicking opens form mode directly */}
        <button
          type="button"
          onClick={openFormMode}
          title="שלח פידבק על האפליקציה"
          aria-label="שלח פידבק"
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg hover:bg-accent/40"
        >
          <ThumbsUp className="size-3.5 text-primary" />
          <span className="hidden sm:inline">פידבק</span>
        </button>
      </div>

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
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border bg-card p-5 shadow-xl"
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

            {/* Screenshot preview — shown when camera mode captured one */}
            {screenshot && (
              <div className="mb-3 space-y-1">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <ImageIcon className="size-3" /> תמונת מסך מצורפת
                  </label>
                  <button
                    type="button"
                    onClick={() => setScreenshot(null)}
                    className="text-[11px] text-muted-foreground hover:text-destructive"
                    title="הסר תמונה"
                  >
                    הסר
                  </button>
                </div>
                <div className="overflow-hidden rounded-md border bg-muted/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshot}
                    alt="screenshot preview"
                    className="block h-auto max-h-48 w-full object-contain"
                  />
                </div>
              </div>
            )}

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
