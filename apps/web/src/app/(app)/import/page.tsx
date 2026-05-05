import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Sparkles, Banknote } from 'lucide-react';
import { ImportClient } from './import-client';
import { BankExportImporter } from './bank-export-importer';
import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const db = getDb();
  // Active accounts only — the user shouldn't be able to import into a closed
  // account. Order: personal first, business second, alphabetical within.
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
          העלה קובץ CC ישירות מהפורטל של הבנק/חברת האשראי שלך, או השתמש בתבנית הבייסליין למילוי ידני.
        </p>
      </header>

      {/* === PRIMARY: bank/CC raw export — picks an account, parses the file ===
          Sits at the top because it's the most common day-to-day flow once a
          baseline exists. Templates currently supported: Israeli bank-portal
          CC exports (Diners/Visa/Mastercard via Leumi/Discount/etc.) and
          Discount Key. */}
      <section className="tile space-y-3 border-primary/40 bg-primary-soft/30" dir="rtl">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Banknote className="size-4" />
          <span>ייבוא ישיר מקובץ CC / בנק (התבניות הנפוצות בישראל)</span>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />זיהוי אוטומטי: דיינרס/ויזה/מסטרקארד מפורטל הבנק (לאומי, דיסקונט וכד׳)</li>
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />זיהוי אוטומטי: מפתח דיסקונט (Discount Key) — קובץ דו-גליוני כולל חו״ל</li>
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />חילוץ תאריך חיוב, סימון חו״ל, דילוג שקט על שורות בקליטה</li>
          <li><CheckCircle2 className="me-1 inline size-3 text-success" />דה-דופ: ייבוא של אותו קובץ פעמיים לא ייצור כפילויות</li>
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

      {/* === RECOMMENDED: baseline template === */}
      <section className="tile space-y-3 border-success/40 bg-success-soft/30">
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <Sparkles className="size-4" />
          <span>מומלץ: תבנית בייסליין נקייה</span>
        </div>
        <p className="text-sm text-muted-foreground">
          תבנית פשוטה עם 5 גליונות (Accounts / Transactions / Construction / Categories / README).
          מילוי חד-פעמי של חשבון + תנועות חודש אחד = בייסליין מדויק שאפשר לבנות עליו קדימה.
        </p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            <CheckCircle2 className="me-1 inline size-3 text-success" />
            עמודות פשוטות וברורות, ללא נוסחאות
          </li>
          <li>
            <CheckCircle2 className="me-1 inline size-3 text-success" />
            תומך בהפרדה בין חשבונות אישיים ועסקיים
          </li>
          <li>
            <CheckCircle2 className="me-1 inline size-3 text-success" />
            תומך בהעברות בין חשבונות (משכורת מעסקי לאישי) ללא ספירה כפולה
          </li>
          <li>
            <CheckCircle2 className="me-1 inline size-3 text-success" />
            פרויקט בנייה נפרד אוטומטית — לא מזהם את הסיכום החודשי
          </li>
        </ul>
        <div className="rounded-md bg-card p-3 text-xs">
          <p className="mb-1 font-medium">איפה למצוא את התבנית?</p>
          <p className="text-muted-foreground">
            התבנית נוצרה בתיקייה:
          </p>
          <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono">
            ...\Family Budget App\reference\baseline-template.xlsx
          </code>
          <p className="mt-2 text-muted-foreground">
            פתח את התבנית באקסל, החלף את שורות הדוגמה בנתונים האמיתיים שלך, שמור, והעלה כאן.
          </p>
        </div>
      </section>

      {/* === The legacy multi-sheet path is still supported === */}
      <section className="tile space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileSpreadsheet className="size-4 text-accent" />
          <span>תבנית קודמת (האקסל הרב-גליוני המקורי) או CSV — עדיין נתמכים</span>
        </div>
        <p className="text-sm text-muted-foreground">
          אם תעלה את האקסל הרב-גליוני המקורי שלך (סדינים 1, 2, ..., 12, 1125 וכו׳), המערכת תזהה אותו אוטומטית
          ותפעל לפי הלוגיקה הקודמת. אם תעלה CSV עם עמודות סטנדרטיות (date / merchant / amount / category / account)
          — גם זה ייעבוד.
        </p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            <AlertTriangle className="me-1 inline size-3 text-warning" />
            התבנית הרב-גליונית המקורית כוללת רעש (פרויקט בנייה, תחזיות עתידיות) — קשה לבנות עליה בייסליין נקי.
            לכן מומלץ הבייסליין החדש.
          </li>
        </ul>
      </section>

      <section className="tile">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Upload className="size-4 text-accent" />
          <span>העלאת קובץ</span>
        </div>
        <ImportClient />
      </section>
    </div>
  );
}
