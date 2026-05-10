import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ChatDrawer } from '@/components/chat-drawer';
import { MobileBottomNav, SidebarNav } from '@/components/nav';
import { GlobalHeader } from '@/components/global-header';
import { NotificationsBellServer } from '@/components/notifications-bell-server';
import { FeedbackWidget } from '@/components/feedback-widget';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Full-width sticky header (desktop + mobile) ── */}
      <GlobalHeader
        userName={session.user.name ?? null}
        signOutAction={signOutAction}
        bell={<NotificationsBellServer />}
      />

      {/* ── Below header: sidebar + content ── */}
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-l bg-card md:flex md:flex-col">
          <div className="flex-1 overflow-y-auto">
            <SidebarNav />
          </div>
          <div className="border-t p-3">
            <p className="px-3 py-2 text-2xs text-muted-foreground">
              {session.user.name}
            </p>
          </div>
        </aside>

        {/* Main content
         *
         * max-w bumps with viewport so wide monitors don't waste space:
         *   • base   → 7xl (1280px)
         *   • xl     → no cap (let it use the full main area)
         * The aside sidebar is fixed at w-64 (256px), so on a 1920px
         * monitor this gives us ~1664px of usable width for tables. */}
        <main className="flex-1 overflow-x-hidden pb-20 md:pb-0">
          <div className="mx-auto max-w-7xl xl:max-w-none px-4 py-5 md:px-6 md:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileBottomNav />

      <ChatDrawer
        userId={session.user.id}
        householdId={session.user.householdId}
        userDisplayName={session.user.name ?? null}
      />

      {/* Floating "leave feedback" button — visible on every (app) page.
          Sits opposite the chat-drawer launcher to avoid corner collision. */}
      <FeedbackWidget />
    </div>
  );
}
