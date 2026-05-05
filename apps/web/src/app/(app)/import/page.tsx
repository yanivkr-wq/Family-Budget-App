import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { ImportClient } from './import-client';

export const dynamic = 'force-dynamic';

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">ייבוא נתונים</h1>
        <p className="text-sm text-muted-foreground">
          הדרך המומלצת: השתמש בתבנית הבייסליין החדשה כדי להתחיל נקי ומדויק.
        </p>
      </header>

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
