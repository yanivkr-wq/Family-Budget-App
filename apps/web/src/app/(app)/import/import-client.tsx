'use client';

import { useState, useTransition } from 'react';
import { importCsv, type ImportResult } from './actions';
import { Loader2, Upload } from 'lucide-react';

export function ImportClient() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [filename, setFilename] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) return;
    setFilename(file.name);
    setResult(null);
    startTransition(async () => {
      const r = await importCsv(data);
      setResult(r);
      if (r.ok && r.inserted > 0) form.reset();
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
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
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {isPending ? 'מייבא…' : 'ייבא'}
        </button>
      </form>

      {filename && !isPending && result === null && (
        <p className="text-xs text-muted-foreground">קובץ נבחר: {filename}</p>
      )}

      {result && (
        <div
          className={`rounded-md border p-3 text-sm ${
            result.ok
              ? 'border-success/40 bg-success-soft text-success'
              : 'border-destructive/40 bg-destructive-soft text-destructive'
          }`}
        >
          {!result.ok && result.message && <p className="font-medium">{result.message}</p>}
          {result.ok && (
            <div className="space-y-2 text-foreground">
              <p className="font-medium text-success">
                ✓ ייבוא הסתיים: {result.inserted} תנועות נוספו
                {result.duplicates > 0 && `, ${result.duplicates} כפילויות דולגו`}
                {result.errors.length > 0 && `, ${result.errors.length} שורות עם שגיאות`}.
              </p>
              {result.monthsImported.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  חודשים שיובאו ({result.monthsImported.length}): {result.monthsImported.join(', ')}
                </p>
              )}
              {result.createdAccounts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  חשבונות חדשים שנוצרו ({result.createdAccounts.length}):{' '}
                  {result.createdAccounts.join(', ')}
                </p>
              )}
              {result.createdCategories.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  קטגוריות חדשות שנוצרו ({result.createdCategories.length}):{' '}
                  {result.createdCategories.join(', ')}
                </p>
              )}
              {result.unmatchedCategories.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  קטגוריות שלא זוהו ({result.unmatchedCategories.length}):{' '}
                  {result.unmatchedCategories.slice(0, 5).join(', ')}
                  {result.unmatchedCategories.length > 5 && '…'}
                </p>
              )}
              {result.errors.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    הצג {result.errors.length} שגיאות
                  </summary>
                  <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-md border bg-card p-2 font-mono text-2xs">
                    {result.errors.slice(0, 200).map((e, i) => (
                      <li key={i}>
                        <span className="text-muted-foreground">
                          {e.sheet ? `${e.sheet} שורה ${e.rowNumber}` : `שורה ${e.rowNumber}`}:
                        </span>{' '}
                        <span className="text-destructive">{e.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
