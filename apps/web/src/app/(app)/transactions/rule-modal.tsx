'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  findRuleSuggestions,
  applyRuleToOneTransaction,
  createRuleFromTransaction,
  type RuleSuggestion,
} from './rule-actions';
import { formatIls } from '@fba/shared';
import {
  X, Sparkles, Library, Plus, Loader2, CheckCircle2, Tag,
  MessageSquare, Mic, MicOff, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Cat {
  id: string;
  nameHe: string;
}
interface SubCat extends Cat {
  parentId: string;
}

interface Props {
  transactionId: string;
  topCategories: Cat[];
  subCategories: SubCat[];
  onClose: () => void;
}

type Tab = 'matches' | 'new' | 'describe';

interface ParsedRule {
  pattern: string;
  matchType: 'contains' | 'exact' | 'starts_with' | 'regex';
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

export function RuleModal({ transactionId, topCategories, subCategories, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('matches');
  const [data, setData] = useState<Awaited<ReturnType<typeof findRuleSuggestions>> | null>(null);
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);

  // ── Structured new-rule form state ────────────────────────────────────────
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<'contains' | 'exact' | 'starts_with' | 'regex'>('contains');
  const [categoryId, setCategoryId] = useState('');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [scopeToAccount, setScopeToAccount] = useState(false);
  const [applyToPast, setApplyToPast] = useState(true);

  // ── NL describe-tab state ─────────────────────────────────────────────────
  const [nlText, setNlText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [nlParsing, setNlParsing] = useState(false);
  const [nlResult, setNlResult] = useState<ParseResponse | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlAnswer, setNlAnswer] = useState('');
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    startTransition(async () => {
      const r = await findRuleSuggestions(transactionId);
      setData(r);
      if (r.transaction) {
        setPattern(r.transaction.merchantNormalized);
        if (r.transaction.currentCategoryId) setCategoryId(r.transaction.currentCategoryId);
      }
      if (r.matches.filter((m) => m.matchType === 'exact_match').length === 0) {
        setTab('new');
      }
    });
  }, [transactionId]);

  const subForCategory = subCategories.filter((s) => s.parentId === categoryId);

  // ── Actions ───────────────────────────────────────────────────────────────
  function applySuggestion(s: RuleSuggestion) {
    const fd = new FormData();
    fd.set('transactionId', transactionId);
    fd.set('ruleId', s.rule.id);
    startTransition(async () => {
      const r = await applyRuleToOneTransaction(fd);
      if (r.ok) {
        setSuccess(`הכלל "${s.rule.pattern}" הוחל. הקטגוריה היא "${s.categoryName}".`);
        setTimeout(onClose, 1200);
      }
    });
  }

  function createNew(overrides?: Partial<ParsedRule>) {
    const p = overrides?.pattern ?? pattern;
    const cat = overrides?.categoryId ?? categoryId;
    if (!p || !cat) return;
    const fd = new FormData();
    fd.set('transactionId', transactionId);
    fd.set('pattern', p);
    fd.set('matchType', overrides?.matchType ?? matchType);
    fd.set('categoryId', cat);
    const sub = overrides?.subCategoryId ?? subCategoryId;
    if (sub) fd.set('subCategoryId', sub);
    const min = overrides?.minAmountIls ?? (minAmount ? Number(minAmount) : null);
    const max = overrides?.maxAmountIls ?? (maxAmount ? Number(maxAmount) : null);
    if (min !== null) fd.set('minAmountIls', String(min));
    if (max !== null) fd.set('maxAmountIls', String(max));
    if (scopeToAccount) fd.set('scopeToAccount', 'true');
    if (applyToPast) fd.set('applyToPast', 'true');
    startTransition(async () => {
      const r = await createRuleFromTransaction(fd);
      if (r.ok) {
        setSuccess('כלל חדש נוצר והוחל.');
        setTimeout(onClose, 1200);
      }
    });
  }

  // ── NL parse ─────────────────────────────────────────────────────────────
  async function parseNl() {
    const textToSend = nlAnswer
      ? `${nlText}\n\nתשובה לשאלת המשך: ${nlAnswer}`
      : nlText;
    if (!textToSend.trim()) return;
    setNlParsing(true);
    setNlError(null);
    try {
      const res = await fetch('/api/parse-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSend }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const parsed: ParseResponse = await res.json();
      setNlResult(parsed);
      setNlAnswer('');
      // If high-confidence and no follow-ups → auto pre-fill the structured form
      if (parsed.followUpQuestions.length === 0 && parsed.confidence >= 0.75) {
        if (parsed.rule.pattern) setPattern(parsed.rule.pattern);
        if (parsed.rule.matchType) setMatchType(parsed.rule.matchType);
        if (parsed.rule.categoryId) setCategoryId(parsed.rule.categoryId);
        if (parsed.rule.subCategoryId) setSubCategoryId(parsed.rule.subCategoryId);
        if (parsed.rule.minAmountIls !== null) setMinAmount(String(parsed.rule.minAmountIls));
        if (parsed.rule.maxAmountIls !== null) setMaxAmount(String(parsed.rule.maxAmountIls));
      }
    } catch (e) {
      setNlError(String(e));
    } finally {
      setNlParsing(false);
    }
  }

  // ── Speech recognition ───────────────────────────────────────────────────
  function toggleMic() {
    const SR =
      typeof window !== 'undefined'
        ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
        : null;
    if (!SR) {
      alert('הדפדפן שלך אינו תומך בזיהוי דיבור. נסה Chrome.');
      return;
    }
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const rec = new SR();
    rec.lang = 'he-IL';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const transcript: string = e.results[0]?.[0]?.transcript ?? '';
      setNlText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onerror = () => setIsRecording(false);
    rec.onend = () => setIsRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl space-y-4 rounded-xl border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="size-4 text-accent" />
            כללים לתנועה
          </h2>
          <button onClick={onClose} aria-label="סגור" className="btn-ghost">
            <X className="size-4" />
          </button>
        </div>

        {/* Transaction context */}
        {data?.transaction && (
          <div className="rounded-md border bg-subtle/50 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{data.transaction.merchant}</span>
              <span className={`tabular-nums ${data.transaction.amount < 0 ? '' : 'text-success'}`}>
                {formatIls(data.transaction.amount)}
              </span>
            </div>
            {data.transaction.currentCategoryName && (
              <div className="mt-1 text-xs text-muted-foreground">
                <Tag className="me-1 inline size-3" />
                קטגוריה נוכחית: {data.transaction.currentCategoryName}
              </div>
            )}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success-soft p-2 text-sm text-success">
            <CheckCircle2 className="size-4" />
            {success}
          </div>
        )}

        {/* Tabs */}
        <div className="inline-flex rounded-md border bg-card p-0.5 text-sm">
          <button
            onClick={() => setTab('matches')}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors',
              tab === 'matches' ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Library className="size-3.5" />
            כללים קיימים
            {data && (
              <span className="pill bg-muted text-2xs text-muted-foreground">
                {data.matches.length + data.similar.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('describe')}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors',
              tab === 'describe' ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <MessageSquare className="size-3.5" />
            תאר בטקסט
          </button>
          <button
            onClick={() => setTab('new')}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors',
              tab === 'new' ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Plus className="size-3.5" />
            טופס מפורט
          </button>
        </div>

        {/* ── Tab: existing rules ── */}
        {tab === 'matches' && (
          <div className="space-y-3">
            {isPending && !data && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
            {data && data.matches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">כללים שמתאימים:</p>
                {data.matches.map((s) => (
                  <RuleCard key={s.rule.id} suggestion={s} onApply={() => applySuggestion(s)} disabled={isPending} />
                ))}
              </div>
            )}
            {data && data.similar.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">כללים בקטגוריה זו:</p>
                {data.similar.map((s) => (
                  <RuleCard key={s.rule.id} suggestion={s} onApply={() => applySuggestion(s)} disabled={isPending} />
                ))}
              </div>
            )}
            {data && data.matches.length === 0 && data.similar.length === 0 && (
              <div className="rounded-md border border-dashed bg-subtle p-4 text-center text-sm text-muted-foreground">
                אין כללים קיימים שמתאימים — תאר בטקסט או השתמש בטופס המפורט.
              </div>
            )}
          </div>
        )}

        {/* ── Tab: describe in natural language ── */}
        {tab === 'describe' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              תאר את הכלל בשפה טבעית — האפליקציה תמלא את השדות עבורך.
            </p>

            {/* Text area + mic */}
            <div className="relative">
              <textarea
                value={nlText}
                onChange={(e) => setNlText(e.target.value)}
                placeholder={'לדוגמה: "כשיש חיוב מדלק מתחת ל-100 ₪ — קטגוריזציה כמזון"'}
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

            {/* Parse button */}
            <button
              onClick={parseNl}
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

            {/* AI result */}
            {nlResult && (
              <div className="space-y-3 rounded-md border border-primary/20 bg-primary-soft/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">הבנתי:</p>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      nlResult.confidence >= 0.8
                        ? 'bg-success/20 text-success'
                        : nlResult.confidence >= 0.5
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-destructive/10 text-destructive',
                    )}
                  >
                    {Math.round(nlResult.confidence * 100)}% ביטחון
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{nlResult.explanation}</p>

                {/* Rule fields summary */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">דפוס:</span>
                  <span className="font-mono font-medium">{nlResult.rule.pattern}</span>
                  <span className="text-muted-foreground">סוג התאמה:</span>
                  <span>{nlResult.rule.matchType}</span>
                  <span className="text-muted-foreground">קטגוריה:</span>
                  <span>{nlResult.rule.categoryId
                    ? (topCategories.find((c) => c.id === nlResult.rule.categoryId)?.nameHe ?? nlResult.rule.categoryId)
                    : '—'}
                  </span>
                  {nlResult.rule.subCategoryId && (
                    <>
                      <span className="text-muted-foreground">תת-קטגוריה:</span>
                      <span>{subCategories.find((s) => s.id === nlResult.rule.subCategoryId)?.nameHe ?? '—'}</span>
                    </>
                  )}
                  {nlResult.rule.minAmountIls !== null && (
                    <>
                      <span className="text-muted-foreground">סכום מינימום:</span>
                      <span>{nlResult.rule.minAmountIls} ₪</span>
                    </>
                  )}
                  {nlResult.rule.maxAmountIls !== null && (
                    <>
                      <span className="text-muted-foreground">סכום מקסימום:</span>
                      <span>{nlResult.rule.maxAmountIls} ₪</span>
                    </>
                  )}
                </div>

                {/* Follow-up questions */}
                {nlResult.followUpQuestions.length > 0 && (
                  <div className="space-y-2 border-t pt-2">
                    <p className="text-xs font-medium text-amber-700">
                      <AlertCircle className="me-1 inline size-3.5" />
                      יש לי שאלות משלימות:
                    </p>
                    {nlResult.followUpQuestions.map((q, i) => (
                      <p key={i} className="text-sm">• {q}</p>
                    ))}
                    <textarea
                      value={nlAnswer}
                      onChange={(e) => setNlAnswer(e.target.value)}
                      placeholder="תשובה שלך..."
                      rows={2}
                      className="w-full rounded-md border bg-background p-2 text-sm placeholder:text-muted-foreground/60"
                      dir="auto"
                    />
                    <button
                      onClick={parseNl}
                      disabled={!nlAnswer.trim() || nlParsing}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white disabled:opacity-40 hover:bg-amber-600"
                    >
                      {nlParsing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      עדכן
                    </button>
                  </div>
                )}

                {/* Confirm / switch to form */}
                {nlResult.followUpQuestions.length === 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                    <button
                      onClick={() => createNew(nlResult.rule)}
                      disabled={isPending || !nlResult.rule.pattern || !nlResult.rule.categoryId}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90"
                    >
                      {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                      אישור — צור כלל
                    </button>
                    <button
                      onClick={() => {
                        // Pre-fill form tab and switch to it for fine-tuning
                        if (nlResult.rule.pattern) setPattern(nlResult.rule.pattern);
                        if (nlResult.rule.matchType) setMatchType(nlResult.rule.matchType);
                        if (nlResult.rule.categoryId) setCategoryId(nlResult.rule.categoryId);
                        if (nlResult.rule.subCategoryId) setSubCategoryId(nlResult.rule.subCategoryId);
                        if (nlResult.rule.minAmountIls !== null) setMinAmount(String(nlResult.rule.minAmountIls));
                        if (nlResult.rule.maxAmountIls !== null) setMaxAmount(String(nlResult.rule.maxAmountIls));
                        setTab('new');
                      }}
                      className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent/40"
                    >
                      <Plus className="size-3.5" />
                      ערוך בטופס
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: structured form ── */}
        {tab === 'new' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="form-label">דפוס לחיפוש *</label>
                <input value={pattern} onChange={(e) => setPattern(e.target.value)} className="form-input" />
              </div>
              <div className="space-y-1">
                <label className="form-label">סוג התאמה</label>
                <select
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value as typeof matchType)}
                  className="form-input"
                >
                  <option value="contains">מכיל</option>
                  <option value="exact">בדיוק</option>
                  <option value="starts_with">מתחיל ב</option>
                  <option value="regex">ביטוי רגולרי</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="form-label">→ קטגוריה *</label>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="form-input">
                  <option value="">בחר…</option>
                  {topCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.nameHe}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="form-label">→ תת-קטגוריה</label>
                <select value={subCategoryId} onChange={(e) => setSubCategoryId(e.target.value)} className="form-input">
                  <option value="">— ללא —</option>
                  {subForCategory.map((s) => (
                    <option key={s.id} value={s.id}>{s.nameHe}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="form-label">סכום מינימום (₪)</label>
                <input
                  type="number"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="form-input"
                  placeholder="100"
                />
              </div>
              <div className="space-y-1">
                <label className="form-label">סכום מקסימום (₪)</label>
                <input
                  type="number"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  className="form-input"
                  placeholder="500"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scopeToAccount} onChange={(e) => setScopeToAccount(e.target.checked)} />
              הגבל לחשבון של התנועה הזו
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={applyToPast} onChange={(e) => setApplyToPast(e.target.checked)} />
              החל גם על תנועות עבר תואמות
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              <button onClick={onClose} className="btn-secondary">ביטול</button>
              <button
                onClick={() => createNew()}
                disabled={isPending || !pattern || !categoryId}
                className="btn-primary"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                שמור כלל
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RuleCard({ suggestion, onApply, disabled }: {
  suggestion: RuleSuggestion;
  onApply: () => void;
  disabled: boolean;
}) {
  const r = suggestion.rule;
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 text-sm">
          <div className="font-medium">{r.name ?? r.pattern}</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{r.matchType}</span>: "{r.pattern}"
            {(r.minAmountIls !== null || r.maxAmountIls !== null) && (
              <span>
                {' '}· {r.minAmountIls !== null && `≥ ${formatIls(r.minAmountIls, { decimals: false })}`}
                {r.minAmountIls !== null && r.maxAmountIls !== null && ' '}
                {r.maxAmountIls !== null && `≤ ${formatIls(r.maxAmountIls, { decimals: false })}`}
              </span>
            )}
          </div>
          <div className="text-xs">
            → <span className="font-medium">{suggestion.categoryName}</span>
            {suggestion.subCategoryName && (
              <span className="text-muted-foreground"> / {suggestion.subCategoryName}</span>
            )}
          </div>
          <div className="mt-0.5 text-2xs text-muted-foreground">{suggestion.reason}</div>
        </div>
        <button onClick={onApply} disabled={disabled} className="btn-primary text-xs">
          {disabled ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
          החל
        </button>
      </div>
    </div>
  );
}
