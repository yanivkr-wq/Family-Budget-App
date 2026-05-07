'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, X, Loader2, ArrowLeft,
  BarChart3, CalendarDays, ListChecks, Repeat, Receipt, Sparkles,
  Settings as SettingsIcon, History as HistoryIcon, CreditCard, Tags,
  ScrollText, Upload, KeyRound, Shield, History,
  Landmark, Tag, Zap, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIls } from '@fba/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchResults {
  transactions: Array<{ id: string; merchant: string; date: string; amount: string; billingMonth: string; projectId: string | null }>;
  accounts: Array<{ id: string; name: string; institution: string; type: string }>;
  categories: Array<{ id: string; nameHe: string; parentId: string | null }>;
  rules: Array<{ id: string; name: string | null; pattern: string }>;
}

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'main' | 'admin' | 'transactions' | 'accounts' | 'categories' | 'rules';
}

// ─── Static nav items (mirrors nav.tsx LINKS) ────────────────────────────────

const NAV_ITEMS: CommandItem[] = [
  { id: 'nav-/', label: 'לוח מחוונים', href: '/', icon: BarChart3, group: 'main' },
  { id: 'nav-/transactions', label: 'תנועות', href: '/transactions', icon: ListChecks, group: 'main' },
  { id: 'nav-/grid', label: 'יום-יום', href: '/grid', icon: CalendarDays, group: 'main' },
  { id: 'nav-/recurring', label: 'הוצאות קבועות', href: '/recurring', icon: Repeat, group: 'main' },
  { id: 'nav-/installments', label: 'תשלומים', href: '/installments', icon: Receipt, group: 'main' },
  { id: 'nav-/insights', label: 'תובנות', href: '/insights', icon: Sparkles, group: 'main' },
  { id: 'nav-/history', label: 'היסטוריה', href: '/history', icon: HistoryIcon, group: 'main' },
  { id: 'nav-/import', label: 'ייבוא תבנית', href: '/import', icon: Upload, group: 'main' },
  { id: 'nav-/admin/categories', label: 'קטגוריות', href: '/admin/categories', icon: Tags, group: 'admin' },
  { id: 'nav-/admin/accounts', label: 'חשבונות', href: '/admin/accounts', icon: CreditCard, group: 'admin' },
  { id: 'nav-/admin/rules', label: 'כללי קטגוריזציה', href: '/admin/rules', icon: SettingsIcon, group: 'admin' },
  { id: 'nav-/admin/imports', label: 'היסטוריית ייבוא', href: '/admin/imports', icon: History, group: 'admin' },
  { id: 'nav-/admin/audit', label: 'יומן ביקורת', href: '/admin/audit', icon: ScrollText, group: 'admin' },
  { id: 'nav-/admin/privacy', label: 'יומן פרטיות', href: '/admin/privacy', icon: Shield, group: 'admin' },
  { id: 'nav-/settings/password', label: 'שינוי סיסמה', href: '/settings/password', icon: KeyRound, group: 'admin' },
];

// ─── Group config ─────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  main: 'ניווט מהיר',
  admin: 'ניהול',
  transactions: 'תנועות',
  accounts: 'חשבונות',
  categories: 'קטגוריות',
  rules: 'כללים',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ── Focus + reset on open ─────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setActiveIdx(0);
      // Small delay so the element is mounted before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) setResults(await res.json());
      } catch {
        // silently fail — palette still shows nav results
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  // ── Build flat + grouped item list ────────────────────────────────────────
  const { items, groups } = useMemo(() => {
    const q = query.trim().toLowerCase();

    // Static nav: show all when empty; filter by label/href when typing
    const filteredNav =
      q.length === 0
        ? NAV_ITEMS
        : NAV_ITEMS.filter(
            (n) =>
              n.label.toLowerCase().includes(q) || n.href.toLowerCase().includes(q),
          );

    // DB results → CommandItems (only when there's a query). All deep-link
    // to the relevant page with a `?highlight=<id>` query param so the
    // destination page can scroll-into-view + flash the matched row.
    // Transactions also include `?month=<billingMonth>` so the row falls
    // inside the visible window — without it the user lands on the current
    // month and the row they searched for is invisible.
    const txnItems: CommandItem[] = (results?.transactions ?? []).map((t) => ({
      id: `txn-${t.id}`,
      label: t.merchant,
      // Mark project-linked rows so the user knows where they're going.
      sublabel: `${t.date} · ${formatIls(Number(t.amount))}${t.projectId ? ' · 📦 פרויקט' : ''}`,
      // Project transactions are hidden from /transactions by design —
      // route them to the per-project page where they ARE visible.
      // Regular transactions go to /transactions with month + highlight.
      href: t.projectId
        ? `/projects/${t.projectId}?highlight=${t.id}`
        : `/transactions?month=${t.billingMonth}&highlight=${t.id}`,
      icon: FileText,
      group: 'transactions',
    }));

    const accItems: CommandItem[] = (results?.accounts ?? []).map((a) => ({
      id: `acc-${a.id}`,
      label: a.name,
      sublabel: a.institution,
      href: `/admin/accounts?highlight=${a.id}`,
      icon: Landmark,
      group: 'accounts',
    }));

    const catItems: CommandItem[] = (results?.categories ?? []).map((c) => ({
      id: `cat-${c.id}`,
      label: c.nameHe,
      sublabel: c.parentId ? 'תת-קטגוריה' : 'קטגוריה',
      href: `/admin/categories?highlight=${c.id}`,
      icon: Tag,
      group: 'categories',
    }));

    const ruleItems: CommandItem[] = (results?.rules ?? []).map((r) => ({
      id: `rule-${r.id}`,
      label: r.name ?? r.pattern,
      sublabel: r.name ? r.pattern : undefined,
      href: `/admin/rules?highlight=${r.id}`,
      icon: Zap,
      group: 'rules',
    }));

    const allItems = [...filteredNav, ...txnItems, ...accItems, ...catItems, ...ruleItems];

    // Build groups with per-item flat indices
    type GroupEntry = { key: string; label: string; items: Array<CommandItem & { flatIdx: number }> };
    const groupMap = new Map<string, GroupEntry>();
    const groupOrder = ['main', 'admin', 'transactions', 'accounts', 'categories', 'rules'];

    let flatIdx = 0;
    for (const item of allItems) {
      if (!groupMap.has(item.group)) {
        groupMap.set(item.group, { key: item.group, label: GROUP_LABELS[item.group] ?? item.group, items: [] });
      }
      groupMap.get(item.group)!.items.push({ ...item, flatIdx: flatIdx++ });
    }

    const groups = groupOrder
      .map((k) => groupMap.get(k))
      .filter(Boolean) as GroupEntry[];

    return { items: allItems, groups };
  }, [query, results]);

  // ── Clamp activeIdx when item list shrinks ────────────────────────────────
  useEffect(() => {
    setActiveIdx((i) => (items.length === 0 ? 0 : Math.min(i, items.length - 1)));
  }, [items.length]);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        const item = items[activeIdx];
        if (item) {
          router.push(item.href);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, items, activeIdx, onClose, router]);

  if (!open) return null;

  const hasQuery = query.trim().length >= 2;
  const noResults = hasQuery && !loading && items.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* ── Search input ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="חפש תנועה, קטגוריה, כלל, דף..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            dir="rtl"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setActiveIdx(0);
                inputRef.current?.focus();
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              aria-label="נקה"
            >
              <X className="size-3.5" />
            </button>
          )}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* ── Results ──────────────────────────────────────────────────── */}
        <div className="max-h-[56vh] overflow-y-auto py-2">
          {noResults && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              לא נמצאו תוצאות עבור &ldquo;{query}&rdquo;
            </p>
          )}

          {groups.map((group) => (
            <div key={group.key} className="pb-1">
              {/* Group header — only shown when actively searching */}
              {hasQuery && (
                <p className="px-4 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
              )}

              {/* Group section header for empty state */}
              {!hasQuery && group.key === 'admin' && (
                <div className="border-t mx-2 mb-1 mt-2 pt-2">
                  <p className="px-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                </div>
              )}

              {group.items.map(({ flatIdx, ...item }) => {
                const isActive = flatIdx === activeIdx;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-muted/70',
                    )}
                    onMouseEnter={() => setActiveIdx(flatIdx)}
                    onClick={() => {
                      router.push(item.href);
                      onClose();
                    }}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <div className="flex min-w-0 flex-1 items-baseline gap-2 text-start">
                      <span className="truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.sublabel}
                        </span>
                      )}
                    </div>
                    <ArrowLeft
                      className={cn(
                        'size-3 shrink-0 transition-opacity',
                        isActive ? 'text-primary opacity-100' : 'opacity-0',
                      )}
                    />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-background px-1 py-0.5">↑</kbd>
            <kbd className="rounded border bg-background px-1 py-0.5">↓</kbd>
            ניווט
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-background px-1 py-0.5">Enter</kbd>
            פתח
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-background px-1 py-0.5">Esc</kbd>
            סגור
          </span>
          {hasQuery && items.length > 0 && (
            <span className="ms-auto text-muted-foreground/60">
              {items.length} תוצאות
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
