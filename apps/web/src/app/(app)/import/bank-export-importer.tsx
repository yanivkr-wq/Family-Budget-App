'use client';

/**
 * Upload UI for raw bank/CC portal exports (Israeli banks' "פירוט עסקאות"
 * downloads, Discount Key, etc.). Pairs with the importBankExport server
 * action — picks an account, picks a file, hands it off, shows results.
 *
 * Why a separate component from <ImportClient>:
 *   - Different mental model: this one targets a SPECIFIC account, the
 *     legacy CSV/baseline path infers accounts from the file content.
 *   - Different result shape: BankExportImportResult exposes per-template
 *     details (forex count, installment count, distinct cards) the user
 *     needs to see to validate the import landed correctly.
 */

import { useState, useTransition } from 'react';
import { Loader2, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, CreditCard, Globe2, Repeat, Sparkles, Tag, Landmark } from 'lucide-react';
import { importBankExport, type BankExportImportResult } from './actions';

interface AccountOption {
  id:    string;
  name:  string;
  type:  'bank' | 'credit_card';
  /** Hint for the user — show "(אישי)" / "(עסקי)" so they don't pick the wrong account. */
  purpose: 'personal' | 'business' | 'shared';
}

export function BankExportImporter({ accounts }: { accounts: AccountOption[] }) {
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [filename, setFilename]   = useState<string | null>(null);
  const [result, setResult]       = useState<BankExportImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) return;
    if (!accountId) return;
    setFilename(file.name);
    setResult(null);
    startTransition(async () => {
      const r = await importBankExport(data);
      setResult(r);
      if (r.ok && r.inserted > 0) form.reset();
    });
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
        אין חשבונות פעילים. הוסף חשבון תחת{' '}
        <a href="/admin/accounts" className="underline">חשבונות</a> לפני הייבוא.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3" dir="rtl">
        {/* Account selector — required so we know which account this file belongs to */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            חשבון יעד <span className="text-destructive">*</span>
          </label>
          <select
            name="accountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
            disabled={isPending}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.type === 'credit_card' ? 'אשראי' : 'בנק'} · {a.purpose === 'business' ? 'עסקי' : a.purpose === 'shared' ? 'משותף' : 'אישי'}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            כל השורות בקובץ ייכנסו לחשבון הזה. אם הקובץ מכיל מספר כרטיסים, נחזיר אזהרה לאחר הניתוח.
          </p>
        </div>

        {/* File picker + submit on one row */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex-1 cursor-pointer">
            <input
              type="file"
              name="file"
              accept=".csv,.tsv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              required
              disabled={isPending}
              className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary file:transition-colors hover:file:bg-primary-soft/70"
            />
          </label>
          <button type="submit" disabled={isPending || !accountId} className="btn-primary">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {isPending ? 'מייבא…' : 'ייבא'}
          </button>
        </div>
      </form>

      {filename && !isPending && result === null && (
        <p className="text-xs text-muted-foreground">קובץ נבחר: {filename}</p>
      )}

      {result && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }: { result: BankExportImportResult }) {
  if (!result.ok) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive-soft p-3 text-sm text-destructive" dir="rtl">
        <p className="font-medium">{result.message ?? 'הייבוא נכשל'}</p>
        {result.needsManualMapping && (
          <p className="mt-1 text-xs">
            לא זוהה תבנית מתאימה. ייתכן שתצטרך להוסיף תבנית חדשה ב-<code className="rounded bg-muted px-1 font-mono">institution-templates.ts</code>.
          </p>
        )}
        {result.errors.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 ps-5 text-xs">
            {result.errors.slice(0, 5).map((e, i) => (
              <li key={i}>שורה {e.row}: {e.reason}</li>
            ))}
            {result.errors.length > 5 && (
              <li className="text-muted-foreground/70">…ועוד {result.errors.length - 5} שגיאות</li>
            )}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-success/40 bg-success-soft/40 p-3 text-sm" dir="rtl">
      <div className="flex items-start gap-2 text-success">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">
            ✓ ייבוא הסתיים בהצלחה
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            תבנית: {result.templateUsed?.name ?? '—'}
          </p>
        </div>
      </div>

      {/* Counts — primary row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={<FileSpreadsheet className="size-3.5" />} label="נוספו" value={result.inserted} />
        {result.upgradedDuplicates > 0 && (
          <Stat icon={<Sparkles className="size-3.5 text-primary" />} label="שודרגו (תיוג + שיוך)" value={result.upgradedDuplicates} />
        )}
        {result.duplicates > 0 && (
          <Stat icon={<Repeat className="size-3.5" />} label="כפילויות (ללא שינוי)" value={result.duplicates} />
        )}
        {result.errors.length > 0 && (
          <Stat icon={<AlertTriangle className="size-3.5 text-warning" />} label="שגיאות" value={result.errors.length} />
        )}
      </div>

      {/* Counts — automation row */}
      {(result.categorizedRows > 0 || result.bankHintCategorized > 0 || result.newPlansCreated > 0 || result.rowsLinkedToPlans > 0 || result.forexRows > 0) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {result.categorizedRows > 0 && (
            <Stat icon={<Tag className="size-3.5 text-primary" />} label="קטגוריה (חוקים)" value={result.categorizedRows} />
          )}
          {result.bankHintCategorized > 0 && (
            <Stat icon={<Landmark className="size-3.5 text-accent" />} label="קטגוריה (ענף בנק)" value={result.bankHintCategorized} />
          )}
          {result.newPlansCreated > 0 && (
            <Stat icon={<CreditCard className="size-3.5 text-accent" />} label="תוכניות תשלומים נוצרו" value={result.newPlansCreated} />
          )}
          {result.rowsLinkedToPlans > 0 && (
            <Stat icon={<CreditCard className="size-3.5 text-primary" />} label="שורות שויכו לתשלומים" value={result.rowsLinkedToPlans} />
          )}
          {result.forexRows > 0 && (
            <Stat icon={<Globe2 className="size-3.5 text-accent" />} label='חו"ל' value={result.forexRows} />
          )}
        </div>
      )}

      {result.newPlansCreated > 0 && (
        <p className="text-[11px] text-muted-foreground">
          תוכניות תשלומים חדשות ממתינות לשם תיאורי (כגון &ldquo;iPhone&rdquo;) — ערוך אותן ב-
          <a href="/installments" className="underline">תשלומים</a>.
        </p>
      )}

      {/* Multi-card warning */}
      {result.distinctCards.length > 1 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-medium">הקובץ מכיל {result.distinctCards.length} כרטיסים שונים</p>
            <p className="mt-0.5 text-warning/80">
              כל השורות נכנסו לחשבון שנבחר ({result.distinctCards.join(', ')}).
              אם תרצה להפריד לפי כרטיס, פצל את הקובץ באקסל לפני הייבוא.
            </p>
          </div>
        </div>
      )}

      {/* Errors (rare for bank files but possible) */}
      {result.errors.length > 0 && (
        <details className="rounded-md border bg-card p-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {result.errors.length} שורות לא יובאו (לחץ להצגה)
          </summary>
          <ul className="mt-2 list-disc space-y-0.5 ps-5 text-muted-foreground">
            {result.errors.slice(0, 10).map((e, i) => (
              <li key={i}>שורה {e.row}: {e.reason}</li>
            ))}
            {result.errors.length > 10 && (
              <li className="text-muted-foreground/70">…ועוד {result.errors.length - 10}</li>
            )}
          </ul>
        </details>
      )}

      <p className="text-[11px] text-muted-foreground">
        עברו ל-<a href="/transactions" className="underline">תנועות</a> כדי לראות את השורות שנוספו.
      </p>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
