'use client';

/**
 * "Run backup now" button for /admin/backups. Client-side because the
 * backup is long-running (10s-2min) and we want a spinner + inline result
 * — server actions in Next return only after completion which is fine
 * here, we just need React state for the pending UI.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Database, CheckCircle2, AlertTriangle } from 'lucide-react';
import { runBackupNow } from './actions';

export function BackupRunButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult]        = useState<{ ok: boolean; msg: string } | null>(null);
  const router = useRouter();

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const r = await runBackupNow();
      if (r.ok) {
        const sizeKb = r.bytes ? Math.round(r.bytes / 1024) : 0;
        const dur    = r.duration ? Math.round(r.duration / 1000) : 0;
        const pruned = r.pruned ? ` · נוקו ${r.pruned} ישנים` : '';
        setResult({
          ok: true,
          msg: `נוצר ${r.filename} · ${sizeKb.toLocaleString('he-IL')} KB · ${dur}ש${pruned}`,
        });
        // Refresh the page so the new backup appears in the table.
        router.refresh();
      } else if (r.skipped) {
        setResult({ ok: false, msg: r.reason ?? 'דולג' });
      } else {
        setResult({ ok: false, msg: r.error ?? 'שגיאה' });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span className={`text-2xs flex items-center gap-1 ${result.ok ? 'text-success' : 'text-destructive'}`}>
          {result.ok
            ? <CheckCircle2 className="size-3" aria-hidden />
            : <AlertTriangle className="size-3" aria-hidden />}
          {result.msg}
        </span>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-wait"
        title="הרץ גיבוי מיד (לא מחליף את הגיבוי היומי האוטומטי)"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
        {pending ? 'מגבה…' : 'גבה עכשיו'}
      </button>
    </div>
  );
}
