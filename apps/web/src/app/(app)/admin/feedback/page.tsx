import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { listFeedback } from './actions';
import { FeedbackList } from './client';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const items = await listFeedback();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">פידבק</h1>
        <p className="text-sm text-muted-foreground">
          הערות ובאגים שתיעדת תוך כדי שימוש באפליקציה. ייצוא Markdown מאפשר
          להעביר את הרשימה ל-Claude Code לעבודה על שיפורים.
        </p>
      </header>
      <FeedbackList initial={items} />
    </div>
  );
}
