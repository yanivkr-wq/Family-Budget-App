import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Sparkles, MessageCircle, TrendingDown, Repeat, Calendar, Target } from 'lucide-react';
import Link from 'next/link';

export default async function InsightsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const cards = [
    {
      icon: TrendingDown,
      title: 'ניתוח הוצאות',
      desc: 'השווה הוצאות בין חודשים, זהה קטגוריות שגדלו',
      action: 'שאל את העוזר',
      href: null,
      color: 'text-destructive',
    },
    {
      icon: Repeat,
      title: 'הוצאות קבועות',
      desc: 'רשימת תנועות חוזרות שזוהו — מנויים, ביטוחים, משכנתה',
      action: 'צפה בהוצאות קבועות',
      href: '/recurring',
      color: 'text-accent',
    },
    {
      icon: Calendar,
      title: 'תשלומים עתידיים',
      desc: 'תוכניות תשלום פעילות ותחזית לחודשים הבאים',
      action: 'צפה בתשלומים',
      href: '/installments',
      color: 'text-primary',
    },
    {
      icon: Target,
      title: 'ביצוע מול תקציב',
      desc: 'לוח מחוונים עם מד התקדמות לכל קטגוריה',
      action: 'לדשבורד',
      href: '/',
      color: 'text-success',
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">תובנות</h1>
        <p className="text-sm text-muted-foreground">
          ניתוח חכם של דפוסי ההוצאות שלך
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="tile space-y-3">
              <div className="flex items-center gap-2">
                <Icon className={`size-5 ${card.color}`} />
                <h2 className="text-sm font-semibold">{card.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground">{card.desc}</p>
              {card.href ? (
                <Link href={card.href} className="btn-secondary inline-flex text-xs">
                  {card.action}
                </Link>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle className="size-3" />
                    לחץ ⌘K ופתח את צ׳אט העוזר
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── AI chat CTA ── */}
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-6 text-center">
        <Sparkles className="mx-auto mb-2 size-8 text-accent" />
        <h2 className="text-base font-semibold">שאל את העוזר</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          &ldquo;כמה הוצאנו על מסעדות ב-3 החודשים האחרונים?&rdquo; <br />
          &ldquo;מה ההוצאה הכי גדולה שלנו החודש?&rdquo; <br />
          &ldquo;אילו מנויים כדאי לבטל?&rdquo;
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          לחץ <kbd className="rounded border bg-background px-1">⌘K</kbd> בכל דף לפתיחת העוזר
        </p>
      </div>
    </div>
  );
}
