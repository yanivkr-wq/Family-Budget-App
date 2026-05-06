import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { RULES_CATALOG, RULE_CATEGORIES, type RuleCategory } from '@/lib/rules-catalog';
import { BookOpen } from 'lucide-react';

export const dynamic = 'force-static'; // pure content — no DB hit needed

/**
 * Story-mode catalog of all the business logic baked into the app.
 * Single source of truth lives in `apps/web/src/lib/rules-catalog.ts` —
 * this page just renders it.
 *
 * Rule for me (Claude): every time I add or change a piece of import /
 * categorization / transaction-handling logic, I append a matching entry
 * to RULES_CATALOG. The page picks it up automatically on next refresh.
 */
export default async function RulesCatalogPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  // Group rules by category in the same order as RULE_CATEGORIES
  const grouped = (Object.keys(RULE_CATEGORIES) as RuleCategory[]).map((cat) => ({
    cat,
    meta: RULE_CATEGORIES[cat],
    items: RULES_CATALOG.filter((r) => r.category === cat),
  })).filter((g) => g.items.length > 0);

  const totalRules = RULES_CATALOG.length;

  return (
    <div className="space-y-8" dir="rtl">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="size-6 text-primary" />
          ספר החוקים
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          כל הלוגיקה האוטומטית של האפליקציה במקום אחד — איך מזוהה הקובץ, איך מתויגות
          הקטגוריות, מה קורה למט"ח, איך נמנעות כפילויות. מטרת הדף: שלא תצטרך לזכור
          הכל בעל-פה ושתוכל לבדוק האם משהו עובד כפי שאתה מצפה.
        </p>
        <p className="mt-1 text-xs text-muted-foreground/80">
          כרגע {totalRules} חוקים ב-{grouped.length} קטגוריות. הדף נשמר תמיד מסונכרן עם הקוד —
          כשנוסף חוק חדש לאפליקציה, הוא מתעדכן כאן אוטומטית.
        </p>
      </header>

      {/* Quick-jump table of contents */}
      <nav className="rounded-lg border bg-card p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          קפיצה מהירה
        </h2>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {grouped.map((g) => (
            <li key={g.cat}>
              <a href={`#cat-${g.cat}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/40">
                <span className="text-base">{g.meta.emoji}</span>
                <span className="flex-1">{g.meta.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{g.items.length}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* The actual catalog, grouped */}
      {grouped.map((g) => (
        <section key={g.cat} id={`cat-${g.cat}`} className="space-y-3 scroll-mt-4">
          <header className="border-b pb-2">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <span className="text-2xl">{g.meta.emoji}</span>
              {g.meta.label}
              <span className="text-sm font-normal text-muted-foreground">
                · {g.items.length} חוקים
              </span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{g.meta.description}</p>
          </header>

          <div className="space-y-3">
            {g.items.map((r) => (
              <article key={r.id} id={r.id} className="rounded-lg border bg-card p-4 scroll-mt-4">
                <h3 className="text-base font-semibold">{r.title}</h3>
                <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">
                  {r.story}
                </p>
                <div className="mt-3 rounded-md bg-muted/40 p-2.5 text-xs">
                  <p className="font-medium text-muted-foreground">למה?</p>
                  <p className="mt-0.5 text-foreground/80">{r.why}</p>
                </div>
                {r.example && (
                  <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
                    <p className="font-medium text-primary">דוגמה</p>
                    <p className="mt-0.5 whitespace-pre-line text-foreground/90">{r.example}</p>
                  </div>
                )}
                {r.code && r.code.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] text-muted-foreground/70 hover:text-muted-foreground">
                      קוד ({r.code.length} {r.code.length === 1 ? 'קובץ' : 'קבצים'})
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {r.code.map((c) => (
                        <li key={c} className="text-[10px] font-mono text-muted-foreground">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

      <footer className="rounded-md border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
        <p>
          <strong>איפה זה נשמר:</strong>{' '}
          <code className="rounded bg-muted px-1 font-mono">apps/web/src/lib/rules-catalog.ts</code>
        </p>
        <p className="mt-1">
          הקובץ הזה הוא מקור-האמת — כל שינוי בלוגיקת האפליקציה מקבל גם רשומה כאן,
          כך שהדף הזה תמיד משקף את המצב האמיתי. אם משהו פה לא תואם להתנהגות שאתה רואה,
          זה באג שווה לדווח עליו דרך כפתור הפידבק.
        </p>
      </footer>
    </div>
  );
}
