'use client';

import { useRef, useState, useTransition } from 'react';
import { previewRawFile, commitRawImport, type RawImportPreview, type RawImportResult } from './actions';
import { Loader2, Upload, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { formatIls } from '@fba/shared';

interface Props {
  accounts: Array<{ id: string; name: string; type: 'bank' | 'credit_card'; purpose: string }>;
}

type Stage = 'pick' | 'preview' | 'committed';

export function RawImportClient({ accounts }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('pick');
  const [preview, setPreview] = useState<RawImportPreview | null>(null);
  const [result, setResult] = useState<RawImportResult | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [filename, setFilename] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onPreview() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) return;
    setFilename(file.name);
    setPreview(null);
    startTransition(async () => {
      const r = await previewRawFile(data);
      setPreview(r);
      if (r.ok) setStage('preview');
    });
  }

  function onCommit() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    if (!data.get('accountId')) data.append('accountId', accountId);
    startTransition(async () => {
      const r = await commitRawImport(data);
      setResult(r);
      if (r.ok) {
        setStage('committed');
      }
    });
  }

  function reset() {
    setStage('pick');
    setPreview(null);
    setResult(null);
    setFilename(null);
    setAccountId('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <form ref={formRef} className="space-y-4">
      {/* Account selector */}
      <div className="space-y-1.5">
        <label htmlFor="accountId" className="form-label">
          לאיזה חשבון שייך הקובץ?
        </label>
        <select
          id="accountId"
          name="accountId"
          required
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          disabled={stage === 'committed'}
          className="form-input"
        >
          <option value="">— בחר חשבון —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.type === 'credit_card' ? 'אשראי' : 'בנק'} · {a.purpose === 'business' ? 'עסקי' : 'אישי'}
            </option>
          ))}
        </select>
      </div>

      {/* File upload */}
      <div className="space-y-1.5">
        <label htmlFor="file" className="form-label">
          קובץ הייצוא מהבנק / חברת האשראי (CSV או Excel)
        </label>
        <input
          ref={fileRef}
          id="file"
          name="file"
          type="file"
          accept=".csv,.tsv,.xlsx,.xls"
          required
          disabled={stage === 'committed'}
          className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary-soft/70"
        />
      </div>

      {/* Stage: pick → preview button */}
      {stage === 'pick' && (
        <button
          type="button"
          onClick={onPreview}
          disabled={isPending || !accountId}
          className="btn-primary"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
          {isPending ? 'מנתח…' : 'נתח קובץ + תצוגה מקדימה'}
        </button>
      )}

      {/* Errors from preview attempt */}
      {preview && !preview.ok && (
        <div className="rounded-md border border-destructive/40 bg-destructive-soft p-3 text-sm text-destructive">
          <p className="font-medium">לא הצלחתי לנתח את הקובץ:</p>
          <p className="mt-1">{preview.message}</p>
          {preview.needsManualMapping && (
            <p className="mt-2 text-xs">
              💡 כתאומה ביניים, נסה דרך תבנית ה-Baseline (אם זה הקובץ הראשון), או צור קשר אם זה קובץ של בנק/אשראי שאתה
              חושב שאמורים לזהות.
            </p>
          )}
        </div>
      )}

      {/* Preview view */}
      {stage === 'preview' && preview?.ok && (
        <div className="space-y-3 rounded-lg border bg-success-soft/40 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" />
            <span>
              זוהה: <strong>{preview.templateName}</strong> — {preview.rowsParsed} תנועות תקינות
              {preview.errors.length > 0 && ` (${preview.errors.length} שגיאות)`}
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-2xs">
              <thead className="bg-muted/40 text-right">
                <tr>
                  <th className="px-2 py-1.5">תאריך עסקה</th>
                  <th className="px-2 py-1.5">תאריך חיוב</th>
                  <th className="px-2 py-1.5">בית עסק</th>
                  <th className="px-2 py-1.5 text-left">סכום</th>
                  <th className="px-2 py-1.5">מטבע</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((p, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1 tabular-nums">{p.transactionDate}</td>
                    <td className="px-2 py-1 tabular-nums text-muted-foreground">{p.chargeDate ?? '—'}</td>
                    <td className="px-2 py-1">{p.merchantRaw}</td>
                    <td
                      className={`px-2 py-1 text-left tabular-nums ${
                        p.amountIls < 0 ? 'text-foreground' : 'text-success'
                      }`}
                    >
                      {formatIls(p.amountIls)}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{p.originalCurrency ?? 'ILS'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            מציג {preview.preview.length} מתוך {preview.rowsParsed} תנועות. בדוק/י שזה נראה תקין ולחץ/י "אשר וייבא".
          </p>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onCommit} disabled={isPending} className="btn-primary">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {isPending ? 'מייבא…' : 'אשר וייבא'}
            </button>
            <button type="button" onClick={reset} className="btn-secondary">
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* Committed result */}
      {stage === 'committed' && result && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            result.ok
              ? 'border-success/40 bg-success-soft text-success'
              : 'border-destructive/40 bg-destructive-soft text-destructive'
          }`}
        >
          {result.ok ? (
            <div className="space-y-1 text-foreground">
              <p className="font-medium text-success">
                ✓ ייבוא הסתיים: {result.inserted} תנועות נוספו ({result.templateName})
                {result.duplicates > 0 && `, ${result.duplicates} כפילויות דולגו`}
                {result.errors.length > 0 && `, ${result.errors.length} שגיאות`}
              </p>
              <button type="button" onClick={reset} className="btn-secondary mt-2">
                ייבוא קובץ נוסף
              </button>
            </div>
          ) : (
            <p className="font-medium">
              {result.message ?? 'שגיאה לא ידועה.'}{' '}
              <button type="button" onClick={reset} className="underline">
                ניסיון נוסף
              </button>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
