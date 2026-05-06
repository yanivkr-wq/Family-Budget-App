import { CheckCircle2, Banknote } from 'lucide-react';
import { BankExportImporter } from './bank-export-importer';
import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Import page.
 *
 * Single primary path: BankExportImporter — uploads a raw bank or
 * credit-card export, picks the destination account, parses + categorizes
 * + dedupes + auto-creates installment plans + flags CC settlements.
 *
 * The legacy CSV / multi-sheet / baseline-template uploaders that used to
 * live here have been removed (the user finished the one-time migration
 * and only uses bank/CC files going forward). If we ever need them back,
 * they're in git history at commit a20e23a.
 */
export default async function ImportPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const db = getDb();
  // Active accounts only — the user shouldn't be able to import into a
  // closed account. Order: personal first, business second, alphabetical.
  const accounts = await db
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      type: schema.accounts.type,
      purpose: schema.accounts.purpose,
    })
    .from(schema.accounts)
    .where(and(
      eq(schema.accounts.householdId, session.user.householdId),
      eq(schema.accounts.isActive, true),
    ))
    .orderBy(schema.accounts.purpose, schema.accounts.name);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">ייבוא נתונים</h1>
        <p className="text-sm text-muted-foreground">
          העלה קובץ ישירות מהפורטל של הבנק או חברת האשראי. המערכת תזהה את התבנית
          אוטומטית ותפעיל קטגוריזציה, זיהוי תשלומים, סימון חו״ל ודה-דופ.
        </p>
      </header>

      <section className="tile space-y-3 border-primary/40 bg-primary-soft/30" dir="rtl">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Banknote className="size-4" />
          <span>ייבוא קובץ בנק / אשראי</span>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />זיהוי אוטומטי: כ.א.ל / דיינרס / ויזה / מסטרקארד / מקס מהפורטל הישיר</li>
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />זיהוי אוטומטי: דיינרס/ויזה מהפורטל של הבנק (לאומי / דיסקונט)</li>
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />זיהוי אוטומטי: מפתח דיסקונט (3 גליונות כולל חו״ל וארנק מט״ח)</li>
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />זיהוי אוטומטי: עו״ש לאומי / עו״ש דיסקונט</li>
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />חילוץ תשלומים, סימון חיובי כרטיס אשראי בעו״ש, זיווג העברות</li>
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />דה-דופ: ייבוא חוזר של אותו קובץ לא ייצור כפילויות</li>
        </ul>
        <BankExportImporter
          accounts={accounts.map((a) => ({
            id:      a.id,
            name:    a.name,
            type:    a.type as 'bank' | 'credit_card',
            purpose: a.purpose as 'personal' | 'business' | 'shared',
          }))}
        />
      </section>
    </div>
  );
}
