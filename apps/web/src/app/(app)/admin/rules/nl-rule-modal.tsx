'use client';

import { useRef, useState, useTransition } from 'react';
import { createRule } from './actions';
import {
  X, Sparkles, Loader2, CheckCircle2, AlertCircle, Mic, MicOff, MessageSquare, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Cat { id: string; nameHe: string; }
interface SubCat extends Cat { parentId: string; }

interface ParsedRule {
  pattern: string;
  matchType: 'contains' | 'exact' | 'starts_with' | 'regex';
  notesPattern: string | null;
  notesMatchType: 'contains' | 'exact' | 'starts_with' | 'regex' | null;
  categoryId: string | null;
  subCategoryId: string | null;
  minAmountIls: number | null;
  maxAmountIls: number | null;
  ruleName: string | null;
  notes: string | null;
}
interface ParseResponse {
  rule: ParsedRule;
  followUpQuestions: string[];
  confidence: number;
  explanation: string;
}

export function NlRuleModal(props: {
  topCategories: Cat[];
  subCategories: SubCat[];
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [nlText, setNlText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [nlParsing, setNlParsing] = useState(false);
  const [nlResult, setNlResult] = useState<ParseResponse | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlAnswer, setNlAnswer] = useState('');
  const [applyToPast, setApplyToPast] = useState(true);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const recognitionRef = useRef<any>(null);

  async function parse() {
    const combined = nlAnswer
      ? `${nlText}\n\nתשובה לשאלת המשך: ${nlAnswer}`
      : nlText;
    if (!combined.trim()) return;
    setNlParsing(true);
    setNlError(null);
    try {
      const res = await fetch('/api/parse-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: combined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? `HTTP ${res.status}`);
      }
      const parsed: ParseResponse = await res.json();
      setNlResult(parsed);
      setNlAnswer('');
    } catch (e) {
      setNlError(String(e));
    } finally {
      setNlParsing(false);
    }
  }

  function toggleMic() {
    const SR =
      typeof window !== 'undefined'
        ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
        : null;
    if (!SR) { alert('הדפדפן שלך אינו תומך בזיהוי דיבור. נסה Chrome.'); return; }
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); return; }
    const rec = new SR();
    rec.lang = 'he-IL';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const t: string = e.results[0]?.[0]?.transcript ?? '';
      setNlText((prev) => (prev ? `${prev} ${t}` : t));
    };
    rec.onerror = () => setIsRecording(false);
    rec.onend = () => setIsRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
  }

  function confirmCreate() {
    if (!nlResult?.rule.pattern || !nlResult?.rule.categoryId) return;
    const fd = new FormData();
    fd.set('pattern', nlResult.rule.pattern);
    fd.set('matchType', nlResult.rule.matchType);
    fd.set('categoryId', nlResult.rule.categoryId);
    if (nlResult.rule.notesPattern) {
      fd.set('notesPattern', nlResult.rule.notesPattern);
      fd.set('notesMatchType', nlResult.rule.notesMatchType ?? 'contains');
    }
    if (nlResult.rule.subCategoryId) fd.set('subCategoryId', nlResult.rule.subCategoryId);
    if (nlResult.rule.minAmountIls !== null) fd.set('minAmountIls', String(nlResult.rule.minAmountIls));
    if (nlResult.rule.maxAmountIls !== null) fd.set('maxAmountIls', String(nlResult.rule.maxAmountIls));
    if (nlResult.rule.ruleName) fd.set('name', nlResult.rule.ruleName);
    if (applyToPast) fd.set('applyToPast', 'true');

    startTransition(async () => {
      const r = await createRule(fd);
      if (r.ok) {
        setSuccess(true);
        setTimeout(() => { props.onCreated?.(); props.onClose(); }, 1200);
      } else {
        setNlError(r.error ?? 'שגיאה ביצירת הכלל');
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-xl space-y-4 rounded-xl border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquare className="size-4 text-accent" />
            צור כלל בשפה טבעית
          </h2>
          <button onClick={props.onClose} className="btn-ghost" aria-label="סגור">
            <X className="size-4" />
          </button>
        </div>

        {success && (
          <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success-soft p-2 text-sm text-success">
            <CheckCircle2 className="size-4" />
            כלל נוצר בהצלחה!
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          תאר את הכלל בשפה חופשית — עברית או אנגלית. לדוגמה:<br />
          <span className="mt-1 block rounded bg-muted/50 px-2 py-1 font-mono text-xs">
            "כשיש חיוב מדלק מתחת ל-100 ₪ — קטגוריה מזון"
          </span>
        </p>

        {/* Text area + mic */}
        <div className="relative">
          <textarea
            value={nlText}
            onChange={(e) => setNlText(e.target.value)}
            placeholder="תאר כאן…"
            rows={3}
            className="w-full rounded-md border bg-background p-3 pe-10 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
            dir="auto"
          />
          <button
            type="button"
            onClick={toggleMic}
            title={isRecording ? 'עצור הקלטה' : 'הקלט בקול (עברית)'}
            className={cn(
              'absolute bottom-2.5 end-2.5 rounded-full p-1.5 transition-colors',
              isRecording
                ? 'bg-destructive/20 text-destructive animate-pulse'
                : 'text-muted-foreground hover:bg-accent/40',
            )}
          >
            {isRecording ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
        </div>
        {isRecording && (
          <p className="text-xs text-destructive">🔴 מקליט… דבר בבירור בעברית, לחץ שוב לעצירה.</p>
        )}

        <button
          onClick={parse}
          disabled={!nlText.trim() || nlParsing}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-40 hover:bg-accent/80"
        >
          {nlParsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {nlResult ? 'פרש מחדש' : 'בנה כלל עם AI'}
        </button>

        {nlError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 flex-shrink-0" />
            {nlError}
          </div>
        )}

        {/* Result */}
        {nlResult && (
          <div className="space-y-3 rounded-md border border-primary/20 bg-primary-soft/20 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">הבנתי:</p>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                nlResult.confidence >= 0.8
                  ? 'bg-success/20 text-success'
                  : nlResult.confidence >= 0.5
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-destructive/10 text-destructive',
              )}>
                {Math.round(nlResult.confidence * 100)}% ביטחון
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{nlResult.explanation}</p>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">דפוס בית עסק:</span>
              <span className="font-mono font-medium">{nlResult.rule.pattern}</span>
              <span className="text-muted-foreground">סוג התאמה:</span>
              <span>{nlResult.rule.matchType}</span>
              {nlResult.rule.notesPattern && (
                <>
                  <span className="text-accent font-medium">AND הערה ({nlResult.rule.notesMatchType ?? 'contains'}):</span>
                  <span className="font-mono font-medium text-accent">{nlResult.rule.notesPattern}</span>
                </>
              )}
              <span className="text-muted-foreground">קטגוריה:</span>
              <span>{nlResult.rule.categoryId
                ? (props.topCategories.find((c) => c.id === nlResult!.rule.categoryId)?.nameHe ?? nlResult.rule.categoryId)
                : '—'}
              </span>
              {nlResult.rule.subCategoryId && (
                <>
                  <span className="text-muted-foreground">תת-קטגוריה:</span>
                  <span>{props.subCategories.find((s) => s.id === nlResult!.rule.subCategoryId)?.nameHe ?? '—'}</span>
                </>
              )}
              {nlResult.rule.minAmountIls !== null && (
                <><span className="text-muted-foreground">סכום מינ׳:</span><span>{nlResult.rule.minAmountIls} ₪</span></>
              )}
              {nlResult.rule.maxAmountIls !== null && (
                <><span className="text-muted-foreground">סכום מקס׳:</span><span>{nlResult.rule.maxAmountIls} ₪</span></>
              )}
            </div>

            {/* Follow-up questions */}
            {nlResult.followUpQuestions.length > 0 && (
              <div className="space-y-2 border-t pt-2">
                <p className="text-xs font-medium text-amber-700">
                  <AlertCircle className="me-1 inline size-3.5" />
                  שאלות משלימות:
                </p>
                {nlResult.followUpQuestions.map((q, i) => (
                  <p key={i} className="text-sm">• {q}</p>
                ))}
                <textarea
                  value={nlAnswer}
                  onChange={(e) => setNlAnswer(e.target.value)}
                  placeholder="תשובה שלך..."
                  rows={2}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  dir="auto"
                />
                <button
                  onClick={parse}
                  disabled={!nlAnswer.trim() || nlParsing}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white disabled:opacity-40 hover:bg-amber-600"
                >
                  {nlParsing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  עדכן
                </button>
              </div>
            )}

            {nlResult.followUpQuestions.length === 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={applyToPast}
                    onChange={(e) => setApplyToPast(e.target.checked)}
                  />
                  החל גם על תנועות עבר
                </label>
                <button
                  onClick={confirmCreate}
                  disabled={isPending || !nlResult.rule.pattern || !nlResult.rule.categoryId}
                  className="ms-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90"
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  צור כלל
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
