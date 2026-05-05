'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { he } from '@fba/shared';
import { cn } from '@/lib/utils';
import { MessageCircle, Send, X, Loader2 } from 'lucide-react';

interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: Array<{ name: string; status: 'running' | 'done' | 'error'; durationMs?: number }>;
  error?: string;
}

interface ChatDrawerProps {
  userId: string;
  householdId: string;
  userDisplayName: string | null;
}

const SUGGESTIONS = [
  he.chat.suggestions.whereDidMoneyGo,
  he.chat.suggestions.anomalies,
  he.chat.suggestions.installmentsLeft,
  he.chat.suggestions.monthVsMonth,
  he.chat.suggestions.subscriptions,
];

export function ChatDrawer({ userId, householdId, userDisplayName }: ChatDrawerProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl + K toggles the drawer. Also listens for a custom `fba:open-chat`
  // event so other components (dashboard hint cards, etc.) can request the
  // drawer to open without prop-drilling state. Dispatch like:
  //   window.dispatchEvent(new CustomEvent('fba:open-chat'))
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('fba:open-chat', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('fba:open-chat', onOpen);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', text }, { role: 'assistant', text: '', toolCalls: [] }]);
    setInput('');

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        householdId,
        userId,
        userDisplayName,
        sessionId,
        message: text,
      }),
    });

    if (!res.ok || !res.body) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'assistant', text: he.chat.error };
        return copy;
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith('data:')) continue;
        const json = line.replace(/^data:\s*/, '');
        try {
          const data = JSON.parse(json);
          handleEvent(data);
        } catch {
          // ignore malformed line
        }
      }
    }
  }

  function handleEvent(data: { kind: string; [k: string]: unknown }) {
    if (data.kind === 'session') {
      setSessionId(data.sessionId as string);
      return;
    }
    if (data.kind === 'text_delta') {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = { ...last, text: last.text + (data.text as string) };
        }
        return copy;
      });
    } else if (data.kind === 'tool_call_start') {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            toolCalls: [...(last.toolCalls ?? []), { name: data.name as string, status: 'running' }],
          };
        }
        return copy;
      });
    } else if (data.kind === 'tool_call_result') {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && last.toolCalls) {
          const calls = [...last.toolCalls];
          const idx = calls.findIndex((c) => c.name === data.name && c.status === 'running');
          if (idx >= 0)
            calls[idx] = {
              ...calls[idx]!,
              status: data.error ? 'error' : 'done',
              durationMs: data.durationMs as number,
            };
          copy[copy.length - 1] = { ...last, toolCalls: calls };
        }
        return copy;
      });
    } else if (data.kind === 'error') {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          // Surface the upstream error so the UI never gets stuck on "thinking"
          let msg = String(data.message ?? he.chat.error);
          if (msg.includes('credit balance is too low')) {
            msg = 'יתרת הקרדיט בחשבון Anthropic שלך נמוכה מדי. הוסף קרדיט ב-https://console.anthropic.com/settings/billing ונסה שוב.';
          }
          copy[copy.length - 1] = { ...last, text: msg, error: msg };
        }
        return copy;
      });
    } else if (data.kind === 'persisted') {
      // No-op — server confirmed the message was saved
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
        aria-label={he.chat.title}
      >
        <MessageCircle className="size-4" />
        {he.chat.title}
      </button>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col border-l bg-card shadow-2xl transition-transform',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">{he.chat.title}</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 hover:bg-accent"
            aria-label={he.common.cancel}
          >
            <X className="size-4" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{he.chat.placeholder}</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => startTransition(() => send(s))}
                    className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'rounded-lg p-3 text-sm',
                m.role === 'user'
                  ? 'ms-auto max-w-[85%] bg-primary text-primary-foreground'
                  : m.error
                    ? 'me-auto max-w-[95%] border border-destructive/40 bg-destructive-soft text-destructive'
                    : 'me-auto max-w-[95%] bg-muted',
              )}
            >
              {m.toolCalls?.map((c, j) => (
                <div key={j} className="mb-2 flex items-center gap-2 rounded-md border bg-background/50 px-2 py-1 text-xs text-muted-foreground">
                  {c.status === 'running' && <Loader2 className="size-3 animate-spin" />}
                  <span className="font-mono">{c.name}</span>
                  {c.durationMs !== undefined && (
                    <span className="ms-auto tabular-nums">{c.durationMs}ms</span>
                  )}
                </div>
              ))}
              <div className="whitespace-pre-wrap leading-relaxed">
                {m.text ||
                  (m.role === 'assistant' && (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {he.chat.thinking}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(() => send(input));
          }}
          className="border-t p-3"
        >
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={he.chat.placeholder}
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isPending}
            />
            <button
              type="submit"
              disabled={isPending || !input.trim()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="size-4" />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">⌘K / Ctrl+K</p>
        </form>
      </aside>
    </>
  );
}
