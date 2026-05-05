'use client';

import { useState, useTransition } from 'react';
import { changePassword } from './actions';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';

export function ChangePasswordClient() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await changePassword(data);
      if (r.ok) {
        setSuccess(true);
        (e.target as HTMLFormElement).reset();
      } else {
        setError(r.error ?? 'שגיאה לא ידועה');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="currentPassword" className="form-label">
          סיסמה נוכחית
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className="form-input"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="newPassword" className="form-label">
          סיסמה חדשה (8+ תווים)
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="form-input"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirmPassword" className="form-label">
          אישור סיסמה חדשה
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="form-input"
        />
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive-soft p-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p className="flex items-center gap-2 rounded-md border border-success/40 bg-success-soft p-2 text-sm text-success">
          <CheckCircle2 className="size-4" />
          הסיסמה עודכנה בהצלחה.
        </p>
      )}

      <button type="submit" disabled={isPending} className="btn-primary w-full">
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        עדכן סיסמה
      </button>
    </form>
  );
}
