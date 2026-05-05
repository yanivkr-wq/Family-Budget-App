'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, LogOut, Command } from 'lucide-react';
import { CommandPalette } from './command-palette';
import { he } from '@fba/shared';

interface Props {
  userName: string | null;
  signOutAction: () => Promise<void>;
}

export function GlobalHeader({ userName, signOutAction }: Props) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ── Global Cmd+K / Ctrl+K shortcut ───────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <header
        className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur md:px-6"
        dir="rtl"
      >
        {/* ── App logo ──────────────────────────────────────────────── */}
        <Link
          href="/"
          className="shrink-0 text-base font-semibold tracking-tight"
        >
          {he.app.name}
        </Link>

        {/* ── Search trigger (fake input) ────────────────────────────── */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex flex-1 items-center gap-2 rounded-md border bg-background/80 px-3 py-1.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted/50 md:max-w-sm"
          aria-label="חיפוש גלובלי"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="hidden flex-1 text-start sm:block">
            חפש תנועה, קטגוריה, כלל...
          </span>
          <span className="flex-1 text-start sm:hidden">חפש...</span>
          <kbd className="hidden items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-xs sm:flex">
            <Command className="size-3" />
            <span>K</span>
          </kbd>
        </button>

        {/* ── User info + sign-out ───────────────────────────────────── */}
        <div className="ms-auto flex shrink-0 items-center gap-1">
          {userName && (
            <span className="hidden text-sm text-muted-foreground md:inline">
              {userName}
            </span>
          )}
          <form action={signOutAction}>
            <button
              type="submit"
              title={he.nav.signOut}
              aria-label={he.nav.signOut}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </header>

      {/* ── Command palette overlay ────────────────────────────────────── */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
