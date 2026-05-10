'use client';

/**
 * Notification contacts CRUD — household-scoped recipient list.
 *
 * The migration (0020) auto-imports the first user's email + phone as a
 * default "אני" contact. From here, the user can add more contacts (spouse,
 * parents, kids), pick which one is the default that pre-selects on new
 * reminders, and edit / delete them.
 *
 * Each reminder in the notification modal will let the user pick which
 * contacts receive the email / WhatsApp delivery for that specific reminder.
 */

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, Star, X, Save, Mail, Phone } from 'lucide-react';
import { createContact, updateContact, deleteContact, type ContactInput } from '@/app/(app)/notifications/actions';

export interface ContactRow {
  id:        string;
  label:     string;
  phoneE164: string | null;
  email:     string | null;
  isDefault: boolean;
}

export function ContactsClient({ initial }: { initial: ContactRow[] }) {
  const [contacts, setContacts] = useState<ContactRow[]>(initial);
  const [editing, setEditing]   = useState<ContactRow | 'new' | null>(null);

  function refreshFromServer(updated: ContactRow[]) {
    setContacts(updated);
  }

  function close() { setEditing(null); }

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <p className="text-2xs text-muted-foreground">
          {contacts.length === 0
            ? 'אין אנשי קשר עדיין'
            : `${contacts.length} אנשי קשר`}
        </p>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-3" />
          הוסף איש קשר
        </button>
      </div>

      <ul className="space-y-2">
        {contacts.map((c) => (
          <ContactRowDisplay
            key={c.id}
            contact={c}
            onEdit={() => setEditing(c)}
            onChanged={(updated) => {
              if (updated === null) {
                // Deleted — strip from local state.
                setContacts((prev) => prev.filter((x) => x.id !== c.id));
              } else {
                // Default toggled — refresh whole list since one default
                // affects others.
                refreshFromServer(updated);
              }
            }}
          />
        ))}
        {contacts.length === 0 && (
          <li className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            לחצי על &quot;הוסף איש קשר&quot; כדי להגדיר נמענים להתראות
          </li>
        )}
      </ul>

      {editing && (
        <ContactModal
          contact={editing === 'new' ? null : editing}
          onClose={close}
          onSaved={(saved, action) => {
            if (action === 'create') {
              setContacts((prev) => [
                ...prev,
                saved,
              ].sort(sortContacts));
            } else if (action === 'update') {
              setContacts((prev) => prev.map((c) =>
                c.id === saved.id ? saved : (saved.isDefault ? { ...c, isDefault: false } : c)
              ).sort(sortContacts));
            }
            close();
          }}
        />
      )}
    </>
  );
}

function sortContacts(a: ContactRow, b: ContactRow): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  return a.label.localeCompare(b.label, 'he');
}

function ContactRowDisplay({
  contact,
  onEdit,
  onChanged,
}: {
  contact: ContactRow;
  onEdit: () => void;
  onChanged: (updated: ContactRow[] | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError]          = useState<string | null>(null);

  function handleDelete() {
    if (!confirm(`למחוק את ${contact.label}?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteContact(contact.id);
      if (!r.ok) { setError(r.error ?? 'שגיאה'); return; }
      onChanged(null);
    });
  }

  return (
    <li className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            {contact.isDefault && (
              <Star className="size-3 fill-accent text-accent" aria-label="ברירת מחדל" />
            )}
            <span className="text-sm font-medium">{contact.label}</span>
            {contact.isDefault && (
              <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-2xs text-accent">
                ברירת מחדל
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
            {contact.phoneE164 && (
              <span className="flex items-center gap-1" dir="ltr">
                <Phone className="size-2.5" /> {contact.phoneE164}
              </span>
            )}
            {contact.email && (
              <span className="flex items-center gap-1" dir="ltr">
                <Mail className="size-2.5" /> {contact.email}
              </span>
            )}
            {!contact.phoneE164 && !contact.email && (
              <span className="text-warning">חסרים פרטי קשר</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40"
            title="ערוך"
            aria-label="ערוך"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-30"
            title="מחק"
            aria-label="מחק"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 text-2xs text-destructive">{error}</p>
      )}
    </li>
  );
}

function ContactModal({
  contact,
  onClose,
  onSaved,
}: {
  contact: ContactRow | null; // null = create mode
  onClose: () => void;
  onSaved: (saved: ContactRow, action: 'create' | 'update') => void;
}) {
  const isEdit = !!contact;
  const [label, setLabel]     = useState(contact?.label ?? '');
  const [phone, setPhone]     = useState(contact?.phoneE164 ?? '');
  const [email, setEmail]     = useState(contact?.email ?? '');
  const [isDefault, setDefault] = useState(contact?.isDefault ?? false);
  const [error, setError]     = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: ContactInput = {
      label: label.trim(),
      phoneE164: phone.trim() || null,
      email: email.trim() || null,
      isDefault,
    };
    startTransition(async () => {
      if (isEdit) {
        const r = await updateContact(contact!.id, input);
        if (!r.ok) { setError(r.error ?? 'שגיאה'); return; }
        onSaved({
          id: contact!.id,
          label: input.label,
          phoneE164: input.phoneE164,
          email: input.email,
          isDefault: input.isDefault,
        }, 'update');
      } else {
        const r = await createContact(input);
        if (!r.ok || !r.id) { setError(r.error ?? 'שגיאה'); return; }
        onSaved({
          id: r.id,
          label: input.label,
          phoneE164: input.phoneE164,
          email: input.email,
          isDefault: input.isDefault,
        }, 'create');
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-xl border bg-card shadow-xl" dir="rtl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-base font-semibold">
            {isEdit ? 'עריכת איש קשר' : 'איש קשר חדש'}
          </h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent/40" aria-label="סגור">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              תווית <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="למשל: אישה, אמא, יוני"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              מספר WhatsApp / טלפון
            </label>
            <input
              type="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+972501234567"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-2xs text-muted-foreground">פורמט E.164. השאר ריק אם אין WhatsApp.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              דוא&quot;ל
            </label>
            <input
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@example.com"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-2xs text-muted-foreground">השאר ריק אם אין דוא&quot;ל.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setDefault(e.target.checked)}
              className="size-4"
            />
            <span>הגדר כברירת מחדל לתזכורות חדשות</span>
          </label>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/40"
            >
              ביטול
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="size-3.5" />
              {pending ? 'שומר…' : isEdit ? 'עדכן' : 'הוסף'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
