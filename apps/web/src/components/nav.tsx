'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  ListChecks,
  Repeat,
  Receipt,
  Sparkles,
  Settings as SettingsIcon,
  History as HistoryIcon,
  CreditCard,
  Tags,
  ScrollText,
  Upload,
  KeyRound,
  Shield,
  History,
  PiggyBank,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { he } from '@fba/shared';
import { cn } from '@/lib/utils';

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  group: 'main' | 'admin';
  /** If true, the link appears in the mobile bottom bar (max 5 items) */
  mobile?: boolean;
}

const LINKS: NavLink[] = [
  { href: '/', label: he.nav.dashboard, icon: BarChart3, group: 'main', mobile: true },
  { href: '/transactions', label: he.nav.transactions, icon: ListChecks, group: 'main', mobile: true },
  { href: '/grid', label: he.nav.grid, icon: CalendarDays, group: 'main', mobile: true },
  { href: '/import', label: 'ייבוא בנק/אשראי', icon: Upload, group: 'main' },
  { href: '/recurring', label: he.nav.recurring, icon: Repeat, group: 'main' },
  { href: '/installments', label: he.nav.installments, icon: Receipt, group: 'main' },
  { href: '/savings', label: he.nav.savings, icon: PiggyBank, group: 'main' },
  { href: '/insights', label: he.nav.insights, icon: Sparkles, group: 'main', mobile: true },
  { href: '/history', label: he.nav.history, icon: HistoryIcon, group: 'main' },
  { href: '/admin/categories', label: he.nav.categories, icon: Tags, group: 'admin' },
  { href: '/admin/accounts', label: he.nav.accounts, icon: CreditCard, group: 'admin' },
  { href: '/admin/rules', label: he.nav.rules, icon: SettingsIcon, group: 'admin' },
  { href: '/admin/imports', label: 'היסטוריית ייבוא', icon: History, group: 'admin' },
  { href: '/admin/feedback', label: 'פידבק', icon: MessageSquare, group: 'admin' },
  { href: '/admin/audit', label: he.nav.audit, icon: ScrollText, group: 'admin' },
  { href: '/admin/privacy', label: 'יומן פרטיות', icon: Shield, group: 'admin' },
  { href: '/settings/password', label: 'סיסמה', icon: KeyRound, group: 'admin' },
];

const MOBILE_LINKS = LINKS.filter((l) => l.mobile);

export function SidebarNav() {
  const pathname = usePathname();
  const main = LINKS.filter((l) => l.group === 'main');
  const admin = LINKS.filter((l) => l.group === 'admin');

  return (
    <nav className="space-y-6 p-3 text-sm">
      <NavGroup links={main} active={pathname} />
      <div className="space-y-1">
        <p className="px-3 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {he.nav.settings}
        </p>
        <NavGroup links={admin} active={pathname} />
      </div>
    </nav>
  );
}

function NavGroup({ links, active }: { links: NavLink[]; active: string }) {
  return (
    <div className="space-y-0.5">
      {links.map((link) => {
        const isActive = link.href === '/' ? active === '/' : active.startsWith(link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
              isActive
                ? 'bg-primary-soft font-medium text-primary'
                : 'text-foreground/80 hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-4">
        {MOBILE_LINKS.map((link) => {
          const isActive = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
          const Icon = link.icon;
          return (
            <li key={link.href} className="flex">
              <Link
                href={link.href}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-2xs',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className={cn('size-5', isActive && 'fill-primary-soft')} />
                <span className="truncate">{link.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
