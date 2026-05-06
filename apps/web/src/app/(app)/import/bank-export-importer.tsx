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
import { Loader2, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, CreditCard, Globe2, Repeat, Sparkles, Tag, Landmark, Search, UserCheck, ArrowLeftRight, Plus, Link2 } from 'lucide-react';
import { importBankExport, type BankExportImportResult } from './actions';

interface AccountOption {
  id:    string;
  name:  string;
  type:  'bank' | 'credit_card';
  /** Hint for the user — show "(אישי)" / "(עסקי)" so they don't pick the wrong account. */
  purpose: 'personal' | 'business' | 'shared';
}

/** Per-file entry in the batch progress + results list. */
interface BatchEntry {
  file:     File;
  status:   'pending' | 'running' | 'done' | 'error';
  result?:  BankExportImportResult;
  error?:   string;
}

export function BankExportImporter({ accounts }: { accounts: AccountOption[] }) {
  const [accountId, setAccountId] = useState<string>('');
  const [files, setFiles]         = useState<File[]>([]);
  const [batch, setBatch]         = useState<BatchEntry[]>([]);
  const [isPending, startTransition] = useTransition();

  function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    setFiles(Array.from(list));
    // Reset previous batch results when new files are picked.
    setBatch([]);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (files.length === 0) return;

    // Initialize the batch progress list — every file starts pending.
    const initial: BatchEntry[] = files.map((file) => ({ file, status: 'pending' }));
    setBatch(initial);

    startTransition(async () => {
      // Process files SEQUENTIALLY — not in parallel — for two reasons:
      //   • Cross-account transfer pairing (Pass 5 in the import action)
      //     queries ALL unpaired transfers in the household, so each file
      //     needs to see the previous files' inserts to find its pair.
      //   • Avoid hammering the DB / Anthropic API with concurrent
      //     server-action calls.
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        // Mark "running" before the await
        setBatch((prev) => prev.map((b, idx) => idx === i ? { ...b, status: 'running' } : b));
        try {
          const fd = new FormData();
          fd.set('file', file);
          if (accountId) fd.set('accountId', accountId);
          const r = await importBankExport(fd);
          setBatch((prev) => prev.map((b, idx) =>
            idx === i ? { ...b, status: r.ok ? 'done' : 'error', result: r } : b,
          ));
        } catch (err) {
          setBatch((prev) => prev.map((b, idx) =>
            idx === i ? { ...b, status: 'error', error: err instanceof Error ? err.message : 'שגיאה' } : b,
          ));
        }
      }
      // Reset file input after the whole batch completes
      setFiles([]);
      const fileInput = document.querySelector<HTMLInputElement>('input[name="files"]');
      if (fileInput) fileInput.value = '';
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

  // Aggregate stats across the batch — useful for an "all done" summary.
  const completed = batch.filter((b) => b.status === 'done' || b.status === 'error');
  const allDone = batch.length > 0 && completed.length === batch.length;
  const totalInserted = completed.reduce((s, b) => s + (b.result?.inserted ?? 0), 0);

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3" dir="rtl">
        {/* Account override (OPTIONAL).
            For batch upload this applies to ALL files. Leave on
            "auto-detect" so each file routes to its own account via
            externalKey — that's the whole point of the bulk flow. */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            חשבון יעד
          </label>
          <select
            name="accountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— זיהוי אוטומטי לפי הקובץ (מומלץ) —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.type === 'credit_card' ? 'אשראי' : 'בנק'} · {a.purpose === 'business' ? 'עסקי' : a.purpose === 'shared' ? 'משותף' : 'אישי'}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            במצב &quot;זיהוי אוטומטי&quot; כל קובץ ירוּתב לחשבון שלו לפי
            &quot;מזהה חיצוני&quot; שהוגדר ב-<a className="underline" href="/admin/accounts">חשבונות</a>.
            לחילופין בחר חשבון מפורש — יחול על כל הקבצים שתעלה כעת.
          </p>
        </div>

        {/* Multi-file picker + submit */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex-1 cursor-pointer">
            <input
              type="file"
              name="files"
              multiple
              accept=".csv,.tsv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              required
              disabled={isPending}
              onChange={onFilesChange}
              className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary file:transition-colors hover:file:bg-primary-soft/70"
            />
          </label>
          <button type="submit" disabled={isPending || files.length === 0} className="btn-primary">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {isPending
              ? `מייבא… ${batch.filter((b) => b.status === 'done' || b.status === 'error').length}/${batch.length}`
              : files.length > 1 ? `ייבא ${files.length} קבצים` : 'ייבא'}
          </button>
        </div>

        {/* File list preview before submit */}
        {files.length > 0 && batch.length === 0 && (
          <ul className="space-y-1 rounded-md border bg-card p-2 text-xs">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-muted-foreground">
                <FileSpreadsheet className="size-3.5 shrink-0" />
                <span className="truncate">{f.name}</span>
                <span className="ms-auto tabular-nums">{(f.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        )}
      </form>

      {/* Batch progress + per-file results */}
      {batch.length > 0 && (
        <div className="space-y-2">
          {allDone && (
            <div className="rounded-md border border-success/40 bg-success-soft/40 p-3 text-sm">
              <p className="font-semibold text-success">
                ✓ הסתיים: {completed.filter((b) => b.status === 'done').length}/{batch.length} קבצים, {totalInserted} תנועות נוספו
              </p>
            </div>
          )}
          {batch.map((entry, i) => (
            <BatchRow key={i} entry={entry} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One row in the batch progress list. Collapsed by default to keep the
 *  page short; expand to see the full BankExportImportResult stat tiles. */
function BatchRow({ entry, index }: { entry: BatchEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor =
    entry.status === 'done'   ? 'border-success/40 bg-success-soft/30' :
    entry.status === 'error'  ? 'border-destructive/40 bg-destructive-soft/30' :
    entry.status === 'running'? 'border-primary/40 bg-primary-soft/30 animate-pulse' :
                                'border-border bg-card';
  const statusIcon =
    entry.status === 'done'   ? <CheckCircle2 className="size-4 text-success" /> :
    entry.status === 'error'  ? <AlertTriangle className="size-4 text-destructive" /> :
    entry.status === 'running'? <Loader2 className="size-4 animate-spin text-primary" /> :
                                <FileSpreadsheet className="size-4 text-muted-foreground" />;
  const r = entry.result;

  return (
    <div className={`rounded-md border ${statusColor}`} dir="rtl">
      <button
        type="button"
        onClick={() => r && setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm"
      >
        {statusIcon}
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{index + 1}.</span>
        <span className="truncate font-medium">{entry.file.name}</span>
        {r?.destinationAccountName && (
          <span className="text-xs text-muted-foreground">
            → {r.destinationAccountName}
            {r.autoRoutedAccount && (
              <span className="ms-1 inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                אוטומטי
              </span>
            )}
          </span>
        )}
        {r?.ok && (
          <span className="ms-auto text-xs text-muted-foreground">
            {r.inserted} נוספו
            {r.upgradedDuplicates > 0 && ` · ${r.upgradedDuplicates} שודרגו`}
            {r.duplicates > 0 && ` · ${r.duplicates} כפילויות`}
          </span>
        )}
        {!r?.ok && r?.message && (
          <span className="ms-auto text-xs text-destructive">{r.message}</span>
        )}
        {!r && entry.error && (
          <span className="ms-auto text-xs text-destructive">{entry.error}</span>
        )}
      </button>
      {expanded && r && (
        <div className="border-t bg-card/50 p-3">
          <ResultCard result={r} />
        </div>
      )}
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
            {result.destinationAccountName && (
              <> · חשבון: <strong className="text-foreground">{result.destinationAccountName}</strong>
                {result.autoRoutedAccount && (
                  <span className="ms-1 inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    זוהה אוטומטית
                  </span>
                )}
              </>
            )}
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
      {(result.categorizedRows > 0 || result.taggedExportCategorized > 0 || result.bankHintCategorized > 0 || result.merchantKeywordCategorized > 0 || result.recurringPatternsCreated > 0 || result.transferRows > 0 || result.newPlansCreated > 0 || result.rowsLinkedToPlans > 0 || result.forexRows > 0) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {result.categorizedRows > 0 && (
            <Stat icon={<Tag className="size-3.5 text-primary" />} label="קטגוריה (חוקים)" value={result.categorizedRows} />
          )}
          {result.taggedExportCategorized > 0 && (
            <Stat icon={<UserCheck className="size-3.5 text-success" />} label="קטגוריה (תיוג ידני)" value={result.taggedExportCategorized} />
          )}
          {result.bankHintCategorized > 0 && (
            <Stat icon={<Landmark className="size-3.5 text-accent" />} label="קטגוריה (ענף בנק)" value={result.bankHintCategorized} />
          )}
          {result.merchantKeywordCategorized > 0 && (
            <Stat icon={<Search className="size-3.5 text-accent" />} label="קטגוריה (שם בית עסק)" value={result.merchantKeywordCategorized} />
          )}
          {result.aiCategorized > 0 && (
            <Stat icon={<Sparkles className="size-3.5 text-purple-600" />} label={`קטגוריה (AI · ${result.aiRulesCreated} כללים נוצרו)`} value={result.aiCategorized} />
          )}
          {result.recurringPatternsCreated > 0 && (
            <Stat icon={<Repeat className="size-3.5 text-primary" />} label="הוצאות קבועות נוצרו" value={result.recurringPatternsCreated} />
          )}
          {result.matchedExistingRecurring > 0 && (
            <Stat icon={<Repeat className="size-3.5 text-success" />} label="התאימו לקבועות קיימות" value={result.matchedExistingRecurring} />
          )}
          {result.categoriesCreated > 0 && (
            <Stat icon={<Plus className="size-3.5 text-success" />} label="קטגוריות נוצרו" value={result.categoriesCreated} />
          )}
          {result.transferRows > 0 && (
            <Stat icon={<ArrowLeftRight className="size-3.5 text-accent" />} label="העברות בין חשבונות" value={result.transferRows} />
          )}
          {result.transferPairsLinked > 0 && (
            <Stat icon={<Link2 className="size-3.5 text-success" />} label="זוגות העברה זוּוגו" value={result.transferPairsLinked} />
          )}
          {result.ccSettlementsFlagged > 0 && (
            <Stat icon={<CreditCard className="size-3.5 text-amber-600" />} label="חיובי כרטיס דוּלגו" value={result.ccSettlementsFlagged} />
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
