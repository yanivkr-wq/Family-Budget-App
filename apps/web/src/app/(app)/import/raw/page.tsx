import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { eq } from 'drizzle-orm';
import { listTemplates } from '@/lib/smart-importer';
import { RawImportClient } from './client';
import { Sparkles, FileSpreadsheet, AlertTriangle } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function RawImportPage() {
  const session = await auth();
  const householdId = session!.user.householdId;
  const db = getDb();

  const accounts = await db
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      type: schema.accounts.type,
      purpose: schema.accounts.purpose,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, householdId))
    .orderBy(schema.accounts.name);

  const templates = listTemplates();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">ייבוא קובץ גולמי מהבנק / כרטיס אשראי</h1>
        <p className="text-sm text-muted-foreground">
          העלאה ישירה של קובץ הייצוא שהבנק או חברת האשראי נתנו לך. הפורמט מזוהה אוטומטית.
        </p>
      </header>

      <section className="tile space-y-3 border-success/40 bg-success-soft/30">
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <Sparkles className="size-4" />
          <span>תבניות שמזוהות אוטומטית</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          {templates.map((t) => (
            <div key={t.id} className="rounded-md border bg-card px-2 py-1.5">
              <span className="font-medium">{t.name}</span>
              <span className="ms-1 text-muted-foreground">
                ({t.type === 'bank' ? 'בנק' : 'אשראי'})
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          תוריד/י מאתר הבנק או חברת האשראי את הייצוא החודשי (CSV או Excel) — בלי לערוך כלום — ועלה/י לכאן.
          המערכת תזהה את התבנית, תציג תצוגה מקדימה לאישור, ואז תייבא.
        </p>
      </section>

      {accounts.length === 0 ? (
        <section className="tile border-warning/40 bg-warning-soft/40">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" />
            <span>צריך קודם להגדיר חשבונות</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            לפני ייבוא קובץ גולמי, צריך לפחות חשבון אחד במערכת. עבור/י לדף{' '}
            <a href="/admin/accounts" className="text-primary underline">
              חשבונות
            </a>{' '}
            או הוסף/י חשבון דרך תבנית ה-Baseline.
          </p>
        </section>
      ) : (
        <section className="tile space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileSpreadsheet className="size-4 text-accent" />
            <span>העלאת קובץ</span>
          </div>
          <RawImportClient accounts={accounts} />
        </section>
      )}
    </div>
  );
}
