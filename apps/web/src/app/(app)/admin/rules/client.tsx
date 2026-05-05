'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  createRule,
  updateRule,
  deleteRule,
  bulkDeleteRules,
  bulkToggleRules,
  previewRule,
  applyRuleToPastTransactions,
  type RulePreview,
} from './actions';
import { formatIls } from '@fba/shared';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  Wand2,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
  Sparkles,
  Repeat,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NlRuleModal } from './nl-rule-modal';
import { runAiCategorization, type AiTagResult } from './ai-actions';

interface Cat {
  id: string;
  nameHe: string;
}
interface SubCat extends Cat {
  parentId: string;
}
interface Account {
  id: string;
  name: string;
  type: 'bank' | 'credit_card';
}
interface Rule {
  id: string;
  name: string | null;
  description: string | null;
  pattern: string;
  matchType: string;
  notesPattern: string | null;
  notesMatchType: string | null;
  appliesToAccountId: string | null;
  minAmountIls: number | null;
  maxAmountIls: number | null;
  categoryId: string;
  subCategoryId: string | null;
  priority: number;
  isActive: boolean;
  timesApplied: number;
  lastAppliedAt: string | null;
  source: string;
}

export function RulesAdminClient(props: {
  rules: Rule[];
  topCategories: Cat[];
  subCategories: SubCat[];
  accounts: Account[];
}) {
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [showNlModal, setShowNlModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [aiResult, setAiResult] = useState<AiTagResult | null>(null);
  const [isAiPending, setIsAiPending] = useState(false);

  function handleAiCategorize() {
    if (isAiPending) return;
    if (!confirm('להריץ סיווג אוטומטי על כל התנועות ללא קטגוריה? פעולה זו עשויה לקחת 5-15 שניות ותיצור כללים חדשים על בסיס הזיהוי.')) return;
    setIsAiPending(true);
    setAiResult(null);
    void (async () => {
      try {
        const r = await runAiCategorization();
        setAiResult(r);
      } finally {
        setIsAiPending(false);
      }
    })();
  }
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return props.rules;
    const q = search.toLowerCase();
    return props.rules.filter(
      (r) =>
        (r.name?.toLowerCase().includes(q) ?? false) ||
        r.pattern.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [props.rules, search]);

  const catNameById = useMemo(
    () => new Map(props.topCategories.concat(props.subCategories).map((c) => [c.id, c.nameHe])),
    [props.topCategories, props.subCategories],
  );
  const accountNameById = useMemo(() => new Map(props.accounts.map((a) => [a.id, a.name])), [props.accounts]);

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(filtered.map((r) => r.id)) : new Set());
  }
  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  function bulkAction(action: 'delete' | 'enable' | 'disable') {
    if (selected.size === 0) return;
    const fd = new FormData();
    Array.from(selected).forEach((id) => fd.append('ids', id));
    if (action === 'enable' || action === 'disable') fd.set('enable', String(action === 'enable'));
    startTransition(async () => {
      if (action === 'delete') {
        if (!confirm(`למחוק ${selected.size} כללים?`)) return;
        await bulkDeleteRules(fd);
      } else {
        await bulkToggleRules(fd);
      }
      setSelected(new Set());
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="חיפוש כלל…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input w-60"
        />
        <div className="ms-auto flex items-center gap-2">
          <button
            onClick={handleAiCategorize}
            disabled={isAiPending}
            className="btn-secondary"
            title="זהה אוטומטית קטגוריה עבור כל התנועות ללא קטגוריה — Claude מבצע חיפוש לפי שם בית העסק"
          >
            {isAiPending
              ? <Loader2 className="size-4 animate-spin" />
              : <Sparkles className="size-4 text-accent" />}
            {isAiPending ? 'מסווג…' : 'תיוג AI'}
          </button>
          <button
            onClick={() => setShowNlModal(true)}
            className="btn-secondary"
            title="צור כלל בשפה טבעית + מיקרופון"
          >
            <MessageSquare className="size-4" />
            תאר בטקסט
          </button>
          <button onClick={() => setEditing('new')} className="btn-primary">
            <Plus className="size-4" />
            כלל חדש
          </button>
        </div>
      </div>

      {aiResult && <AiResultModal result={aiResult} onClose={() => setAiResult(null)} />}

      {showNlModal && (
        <NlRuleModal
          topCategories={props.topCategories}
          subCategories={props.subCategories}
          onClose={() => setShowNlModal(false)}
        />
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary-soft p-2 text-sm">
          <span className="font-medium text-primary">נבחרו {selected.size} כללים</span>
          <button onClick={() => bulkAction('enable')} disabled={isPending} className="btn-secondary text-xs">
            <ToggleRight className="size-3.5" />
            הפעל
          </button>
          <button onClick={() => bulkAction('disable')} disabled={isPending} className="btn-secondary text-xs">
            <ToggleLeft className="size-3.5" />
            השבת
          </button>
          <button onClick={() => bulkAction('delete')} disabled={isPending} className="btn-destructive text-xs">
            <Trash2 className="size-3.5" />
            מחק
          </button>
          <button onClick={() => setSelected(new Set())} className="ms-auto text-xs text-muted-foreground hover:underline">
            ביטול בחירה
          </button>
        </div>
      )}

      {/* Rules list */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed bg-subtle p-8 text-center text-sm text-muted-foreground">
          {props.rules.length === 0
            ? 'אין כללים עדיין. לחץ "כלל חדש" כדי להתחיל.'
            : 'אין כללים שתואמים לחיפוש.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-right text-xs">
              <tr>
                <th className="border-b px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
                <th className="border-b px-3 py-2 font-medium">שם / דפוס</th>
                <th className="border-b px-3 py-2 font-medium">תנאים</th>
                <th className="border-b px-3 py-2 font-medium">→ קטגוריה</th>
                <th className="border-b px-3 py-2 text-center font-medium">הופעל</th>
                <th className="border-b px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    'border-b last:border-0 hover:bg-accent/20',
                    !r.isActive && 'opacity-50',
                  )}
                >
                  <td className="px-3 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) => toggleOne(r.id, e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.name ?? r.pattern}</span>
                      {r.source === 'pending' && (
                        <span className="pill bg-warning-soft text-warning">ממתין לאישור</span>
                      )}
                      {!r.isActive && <span className="pill bg-muted text-muted-foreground">מושבת</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{r.matchType}</span>: "{r.pattern}"
                    </div>
                    {r.description && <div className="mt-0.5 text-xs text-muted-foreground">{r.description}</div>}
                  </td>
                  <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                    {r.notesPattern && (
                      <div className="mb-0.5 font-mono text-accent">
                        + הערה {r.notesMatchType ?? 'contains'}: &ldquo;{r.notesPattern}&rdquo;
                      </div>
                    )}
                    {r.appliesToAccountId && (
                      <div>חשבון: {accountNameById.get(r.appliesToAccountId) ?? '?'}</div>
                    )}
                    {r.minAmountIls !== null && <div>סכום ≥ {formatIls(r.minAmountIls, { decimals: false })}</div>}
                    {r.maxAmountIls !== null && <div>סכום ≤ {formatIls(r.maxAmountIls, { decimals: false })}</div>}
                    {!r.notesPattern && !r.appliesToAccountId && r.minAmountIls === null && r.maxAmountIls === null && (
                      <span>—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div>{catNameById.get(r.categoryId) ?? '?'}</div>
                    {r.subCategoryId && (
                      <div className="text-xs text-muted-foreground">↳ {catNameById.get(r.subCategoryId)}</div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">עדיפות: {r.priority}</div>
                  </td>
                  <td className="px-3 py-3 text-center align-top tabular-nums text-muted-foreground">
                    {r.timesApplied}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditing(r)}
                        className="btn-ghost text-xs"
                        aria-label="ערוך"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <DeleteButton ruleId={r.id} ruleName={r.name ?? r.pattern} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RuleEditModal
          rule={editing === 'new' ? null : editing}
          topCategories={props.topCategories}
          subCategories={props.subCategories}
          accounts={props.accounts}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function DeleteButton({ ruleId, ruleName }: { ruleId: string; ruleName: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <form
      action={(fd: FormData) => {
        if (!confirm(`למחוק כלל: ${ruleName}?`)) return;
        const data = new FormData();
        data.set('id', ruleId);
        startTransition(async () => {
          await deleteRule(data);
        });
      }}
    >
      <button type="submit" disabled={isPending} className="btn-ghost text-xs text-destructive hover:bg-destructive/10">
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </button>
    </form>
  );
}

function RuleEditModal(props: {
  rule: Rule | null;
  topCategories: Cat[];
  subCategories: SubCat[];
  accounts: Account[];
  onClose: () => void;
}) {
  const [pattern, setPattern] = useState(props.rule?.pattern ?? '');
  const [matchType, setMatchType] = useState(props.rule?.matchType ?? 'contains');
  const [notesPattern, setNotesPattern] = useState(props.rule?.notesPattern ?? '');
  const [notesMatchType, setNotesMatchType] = useState(props.rule?.notesMatchType ?? 'contains');
  const [categoryId, setCategoryId] = useState(props.rule?.categoryId ?? '');
  const [subCategoryId, setSubCategoryId] = useState(props.rule?.subCategoryId ?? '');
  const [accountId, setAccountId] = useState(props.rule?.appliesToAccountId ?? '');
  const [minAmount, setMinAmount] = useState(props.rule?.minAmountIls?.toString() ?? '');
  const [maxAmount, setMaxAmount] = useState(props.rule?.maxAmountIls?.toString() ?? '');
  const [name, setName] = useState(props.rule?.name ?? '');
  const [description, setDescription] = useState(props.rule?.description ?? '');
  const [priority, setPriority] = useState(props.rule?.priority?.toString() ?? '100');
  const [isActive, setIsActive] = useState(props.rule?.isActive ?? true);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [applyToPast, setApplyToPast] = useState(false);
  // Recurring-tag fields. The user opts in via a checkbox; when enabled we
  // also write to recurring_pattern so /recurring + the קבוע badge fire on
  // future imports of the same merchant.
  const [markAsRecurring, setMarkAsRecurring] = useState(false);
  const [recurringExpectedAmount, setRecurringExpectedAmount] = useState('');
  const [recurringFrequency, setRecurringFrequency] = useState<'monthly' | 'bimonthly' | 'quarterly' | 'yearly'>('monthly');
  const [recurringSign, setRecurringSign] = useState<'expense' | 'income'>('expense');
  const [recurringDescription, setRecurringDescription] = useState('');
  const [isPending, startTransition] = useTransition();

  const subForCategory = props.subCategories.filter((s) => s.parentId === categoryId);

  function buildFormData(): FormData {
    const fd = new FormData();
    if (props.rule?.id) fd.set('id', props.rule.id);
    fd.set('name', name);
    fd.set('description', description);
    fd.set('matchType', matchType);
    fd.set('pattern', pattern);
    if (notesPattern.trim()) {
      fd.set('notesPattern', notesPattern.trim());
      fd.set('notesMatchType', notesMatchType);
    }
    if (accountId) fd.set('appliesToAccountId', accountId);
    if (minAmount) fd.set('minAmountIls', minAmount);
    if (maxAmount) fd.set('maxAmountIls', maxAmount);
    fd.set('categoryId', categoryId);
    if (subCategoryId) fd.set('subCategoryId', subCategoryId);
    if (markAsRecurring) {
      fd.set('markAsRecurring', 'true');
      if (recurringExpectedAmount) fd.set('recurringExpectedAmount', recurringExpectedAmount);
      fd.set('recurringFrequency', recurringFrequency);
      fd.set('recurringSign', recurringSign);
      if (recurringDescription.trim()) fd.set('recurringDescription', recurringDescription.trim());
    }
    fd.set('priority', priority);
    fd.set('isActive', String(isActive));
    return fd;
  }

  function onPreview() {
    if (!pattern || !categoryId) return;
    startTransition(async () => {
      const r = await previewRule(buildFormData());
      setPreview(r);
    });
  }

  function onSave() {
    const fd = buildFormData();
    if (!props.rule?.id && applyToPast) fd.set('applyToPast', 'true');
    startTransition(async () => {
      let recurringCreated = 0;
      if (props.rule?.id) {
        const r = await updateRule(fd);
        recurringCreated = r.recurringCreated ?? 0;
        if (applyToPast) await applyRuleToPastTransactions(props.rule.id);
      } else {
        const r = await createRule(fd);
        recurringCreated = r.recurringCreated ?? 0;
      }
      if (markAsRecurring && recurringCreated > 0) {
        // Brief inline confirmation. Browser alert is fine for this rare,
        // explicit user action — no need for a toast system yet.
        alert(`✓ נוצרו ${recurringCreated} רישומי הוצאה קבועה. ניתן לערוך אותם ב-/recurring.`);
      }
      props.onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-2xl space-y-4 rounded-xl border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{props.rule ? 'עריכת כלל' : 'כלל חדש'}</h2>
          <button onClick={props.onClose} aria-label="סגור" className="btn-ghost">
            <XCircle className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="form-label">שם הכלל (אופציונלי)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="form-input" placeholder="למשל: שופרסל → מכולת" />
          </div>
          <div className="space-y-1">
            <label className="form-label">עדיפות (קטן יותר = חזק יותר)</label>
            <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} className="form-input" />
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="form-label">תיאור</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" placeholder="למה הכלל הזה קיים?" />
          </div>

          <div className="space-y-1">
            <label className="form-label">סוג התאמה</label>
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as Rule['matchType'])} className="form-input">
              <option value="contains">מכיל (contains)</option>
              <option value="starts_with">מתחיל ב (starts with)</option>
              <option value="exact">בדיוק (exact)</option>
              <option value="regex">ביטוי רגולרי (regex)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="form-label">דפוס בית עסק *</label>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} required className="form-input" placeholder="למשל: שופרסל" />
          </div>

          {/* ── Notes AND-condition ── */}
          <div className="col-span-full rounded-md border border-dashed border-accent/40 bg-accent/5 p-3 space-y-2">
            <p className="text-xs font-medium text-accent">
              תנאי הערה — AND (רשות)
            </p>
            <p className="text-xs text-muted-foreground">
              אם הוגדר, הכלל יפעל רק כאשר גם בית העסק וגם שדה ההערה מתאימים.
              <br />
              <span className="font-mono">דוגמה: בית עסק = paybox ו-הערה מכילה = אורית מילוא</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="form-label">סוג התאמה (הערה)</label>
                <select
                  value={notesMatchType}
                  onChange={(e) => setNotesMatchType(e.target.value)}
                  className="form-input"
                >
                  <option value="contains">מכיל</option>
                  <option value="starts_with">מתחיל ב</option>
                  <option value="exact">בדיוק</option>
                  <option value="regex">regex</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="form-label">דפוס בשדה הערה</label>
                <input
                  value={notesPattern}
                  onChange={(e) => setNotesPattern(e.target.value)}
                  className="form-input"
                  placeholder="למשל: אורית מילוא"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="form-label">חשבון ספציפי (רשות)</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="form-input">
              <option value="">כל החשבונות</option>
              {props.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="form-label">סכום מינימום (₪) — רשות</label>
            <input type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="form-input" placeholder="למשל: 100" />
          </div>
          <div className="space-y-1">
            <label className="form-label">סכום מקסימום (₪) — רשות</label>
            <input type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="form-input" placeholder="למשל: 100" />
          </div>

          <div className="space-y-1">
            <label className="form-label">→ קטגוריה *</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required className="form-input">
              <option value="">בחר…</option>
              {props.topCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameHe}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="form-label">→ תת-קטגוריה</label>
            <select value={subCategoryId} onChange={(e) => setSubCategoryId(e.target.value)} className="form-input">
              <option value="">— ללא —</option>
              {subForCategory.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameHe}
                </option>
              ))}
            </select>
          </div>

          <label className="col-span-full flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>פעיל</span>
          </label>

          <label className="col-span-full flex items-center gap-2 text-sm">
            <input type="checkbox" checked={applyToPast} onChange={(e) => setApplyToPast(e.target.checked)} />
            <span>החל את הכלל גם על תנועות עבר תואמות (backfill)</span>
          </label>

          {/* ── Mark as recurring expense ── */}
          <div className="col-span-full rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={markAsRecurring}
                onChange={(e) => setMarkAsRecurring(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 font-medium text-primary">
                  <Repeat className="size-3.5" />
                  <span>סמן בית עסק זה כהוצאה קבועה (קבע)</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ייווצר רישום ב-<a href="/recurring" className="underline" target="_blank" rel="noopener">הוצאות קבועות</a> וכל
                  התנועות התואמות (כולל ייבואים עתידיים) יקבלו את התג &quot;קבוע&quot;.
                  לכללים מסוג <em>מכיל / מתחיל ב</em> ניצור רישום לכל בית עסק שכבר תואם בעבר.
                </p>
              </div>
            </label>

            {markAsRecurring && (
              <div className="space-y-2 ps-6">
                <div className="space-y-1">
                  <label className="form-label">תיאור / שם התשלום (רשות)</label>
                  <input
                    type="text"
                    value={recurringDescription}
                    onChange={(e) => setRecurringDescription(e.target.value)}
                    placeholder="למשל: Spotify Family, השכרת דירה, ביטוח רכב"
                    className="form-input text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    מה נרכש בפועל — מוצג ליד שם בית העסק ב-/recurring.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="form-label">סוג</label>
                    <select
                      value={recurringSign}
                      onChange={(e) => setRecurringSign(e.target.value as 'expense' | 'income')}
                      className="form-input text-sm"
                    >
                      <option value="expense">הוצאה</option>
                      <option value="income">הכנסה</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="form-label">סכום צפוי (₪)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={recurringExpectedAmount}
                      onChange={(e) => setRecurringExpectedAmount(e.target.value)}
                      placeholder="לדוגמה: 21.90"
                      className="form-input text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="form-label">תדירות</label>
                    <select
                      value={recurringFrequency}
                      onChange={(e) => setRecurringFrequency(e.target.value as typeof recurringFrequency)}
                      className="form-input text-sm"
                    >
                      <option value="monthly">חודשי</option>
                      <option value="bimonthly">דו-חודשי</option>
                      <option value="quarterly">רבעוני</option>
                      <option value="yearly">שנתי</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {preview && (
          <div className="rounded-md border bg-subtle/40 p-3 text-sm">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Eye className="size-4 text-accent" />
              <span>תצוגה מקדימה</span>
            </div>
            <p>
              הכלל יתאים ל-<strong>{preview.matchCount}</strong> תנועות קיימות. מתוכן{' '}
              <span className="text-success">{preview.alreadyMatching} כבר באותה קטגוריה</span>,{' '}
              <span className="text-warning">{preview.wouldChange} ישתנו</span>.
            </p>
            {preview.sampleMatches.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {preview.sampleMatches.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 border-t pt-1 first:border-0 first:pt-0">
                    <span className="truncate">
                      {s.date} · {s.merchant}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatIls(s.amount)} · {s.currentCategory ?? '(ללא)'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <button onClick={onPreview} disabled={isPending || !pattern || !categoryId} className="btn-secondary">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            תצוגה מקדימה
          </button>
          <button onClick={onSave} disabled={isPending || !pattern || !categoryId} className="btn-primary">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            שמור
          </button>
        </div>
      </div>
    </div>
  );
}


function AiResultModal({ result, onClose }: { result: AiTagResult; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl" dir="rtl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="size-4 text-accent" />
              סיווג AI הסתיים
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {result.uniqueMerchants} בתי עסק נסקרו • {result.rulesCreated} כללים נוצרו • {result.rowsCategorized} תנועות שויכו לקטגוריה
            </p>
            {result.tokensIn > 0 && (
              <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                {(result.tokensIn / 1000).toFixed(1)}K tokens-in • {result.tokensOut} tokens-out • {(result.durationMs / 1000).toFixed(1)}s
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent/40">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 text-sm">
          {!result.ok && result.message && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive-soft p-3 text-destructive">
              {result.message}
            </div>
          )}

          {result.results.length === 0 ? (
            <p className="text-muted-foreground">אין תוצאות להציג.</p>
          ) : (
            <ul className="divide-y">
              {result.results.map((r) => (
                <li key={r.merchantNormalized} className="flex items-start gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.merchantNormalized}</span>
                      <span className="text-[10px] text-muted-foreground">{r.txnCount} תנועות</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{r.reasoning}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    {r.applied ? (
                      <>
                        <p className="text-xs font-medium text-success">{r.categoryNameHe ?? "—"}</p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">{Math.round(r.confidence * 100)}% ביטחון</p>
                      </>
                    ) : (
                      <p className="text-xs text-warning">לא הוחל • {Math.round(r.confidence * 100)}%</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t bg-muted/30 px-5 py-3 text-end">
          <button onClick={onClose} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            סיום
          </button>
        </div>
      </div>
    </div>
  );
}
