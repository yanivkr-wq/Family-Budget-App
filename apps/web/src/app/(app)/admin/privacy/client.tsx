'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, BookOpen, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PrivacyEntryToggle(props: {
  icon: ReactNode;
  title: string;
  body: string;
  whatLeft: string[];
  whatStayed: string[];
  technical: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'story' | 'technical'>('story');

  return (
    <div className="rounded-lg border bg-card transition-colors hover:bg-accent/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-3 text-right"
      >
        <div className="text-muted-foreground">{props.icon}</div>
        <div className="flex-1">
          <p className="text-sm font-medium">{props.title}</p>
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t bg-subtle/50 p-3 text-sm">
          {/* View toggle */}
          <div className="inline-flex rounded-md border bg-card p-0.5">
            <button
              onClick={() => setView('story')}
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors',
                view === 'story'
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <BookOpen className="size-3.5" />
              סיפור
            </button>
            <button
              onClick={() => setView('technical')}
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors',
                view === 'technical'
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Code2 className="size-3.5" />
              טכני
            </button>
          </div>

          {view === 'story' ? (
            <div className="space-y-3">
              <p className="leading-relaxed text-foreground">{props.body}</p>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div className="rounded-md border border-success/30 bg-success-soft/40 p-2.5 text-xs">
                  <p className="mb-1 font-medium text-success">מה יצא ל-Claude:</p>
                  <ul className="ms-4 list-disc space-y-0.5 text-muted-foreground">
                    {props.whatLeft.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-destructive/30 bg-destructive-soft/40 p-2.5 text-xs">
                  <p className="mb-1 font-medium text-destructive">מה לא יצא:</p>
                  <ul className="ms-4 list-disc space-y-0.5 text-muted-foreground">
                    {props.whatStayed.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <pre dir="ltr" className="overflow-x-auto rounded-md bg-card p-3 font-mono text-2xs leading-relaxed">
              {JSON.stringify(props.technical, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
