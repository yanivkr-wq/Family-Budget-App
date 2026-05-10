'use client';

/**
 * Interactive projects table. Server-component page.tsx loads the data
 * and hands it here, which owns the per-row actions + create modal.
 *
 * Each row links to /projects/[id] for the per-project dashboard. The
 * action buttons (edit, delete) sit on the side and stop propagation
 * so the click doesn't navigate away.
 *
 * Deep-link support: ?edit=<projectId> auto-opens the edit modal for
 * that project — used by the "ערוך פרויקט" button on the per-project
 * dashboard so the user can jump from /projects/[id] straight into the
 * edit form (without us having to build a separate /edit page).
 */

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pencil, Plus, Trash2, ExternalLink, Briefcase } from 'lucide-react';
import { formatIls } from '@fba/shared';
import { ProjectModal } from './project-modal';
import { deleteProject, type ProjectRow } from './actions';

const STATUS_LABEL: Record<string, string> = {
  active:    'פעיל',
  paused:    'מושהה',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

const STATUS_TONE: Record<string, string> = {
  active:    'bg-success/10 text-success',
  paused:    'bg-warning/10 text-warning',
  completed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

export function ProjectsList({ projects }: { projects: ProjectRow[] }) {
  const [modalProject, setModalProject] = useState<ProjectRow | null | undefined>(undefined);
  // undefined = closed; null = create mode; ProjectRow = edit mode
  const [isPending, startTransition] = useTransition();

  // Deep-link: ?edit=<id> auto-opens edit modal for that project. Used by
  // the "ערוך פרויקט" link on the per-project page so the user lands
  // directly in the edit form rather than the read-only dashboard.
  // openedViaDeepLink lets the close handler navigate BACK to the prior
  // page (e.g. /projects/[id]) instead of stranding on /projects.
  const router = useRouter();
  const searchParams = useSearchParams();
  const openedViaDeepLink = useRef(false);
  const handledEditRef    = useRef<string | null>(null);
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    if (handledEditRef.current === editId) return;
    const project = projects.find((p) => p.id === editId);
    if (project) {
      setModalProject(project);
      openedViaDeepLink.current = true;
      handledEditRef.current = editId;
    }
  }, [searchParams, projects]);

  function closeEditModal() {
    setModalProject(undefined);
    if (openedViaDeepLink.current) {
      openedViaDeepLink.current = false;
      router.back();
    }
  }

  function onDelete(p: ProjectRow) {
    const msg = p.txnCount > 0
      ? `למחוק את הפרויקט "${p.name}"? ${p.txnCount} תנועות מתויגות יחזרו לתזרים הרגיל.`
      : `למחוק את הפרויקט "${p.name}"?`;
    if (!confirm(msg)) return;
    startTransition(async () => {
      await deleteProject(p.id);
    });
  }

  return (
    <>
      {/* Add button + count */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {projects.length === 0 ? 'אין פרויקטים' : `${projects.length} פרויקטים`}
        </div>
        <button
          type="button"
          onClick={() => setModalProject(null)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-3.5" />
          הוסף פרויקט
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
          <Briefcase className="mx-auto mb-3 size-8 text-muted-foreground/50" />
          <p>לחץ על &ldquo;הוסף פרויקט&rdquo; כדי להתחיל.</p>
          <p className="mt-1 text-xs">
            דוגמאות: בניית בית, חתונה, חופשה גדולה. תנועות שתסמן לפרויקט יוסרו אוטומטית מהתצוגות החודשיות.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="min-w-full text-sm" dir="rtl">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="border-b px-3 py-2 font-medium">שם</th>
                <th className="border-b px-3 py-2 font-medium">תקציב</th>
                <th className="border-b px-3 py-2 font-medium">הוצאות</th>
                <th className="border-b px-3 py-2 font-medium">מימון / הכנסה</th>
                <th className="border-b px-3 py-2 font-medium">% מהתקציב</th>
                <th className="border-b px-3 py-2 font-medium">תנועות</th>
                <th className="border-b px-3 py-2 font-medium">סטטוס</th>
                <th className="border-b px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const budget = p.totalBudgetIls ? Number(p.totalBudgetIls) : null;
                // % of budget compares EXPENSES to budget (income/funding
                // doesn't consume the spending budget).
                const pct = budget && budget > 0 ? Math.round((p.totalExpenses / budget) * 100) : null;
                const overBudget = pct !== null && pct >= 100;
                const nearBudget = pct !== null && pct >= 80 && pct < 100;
                return (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link
                        href={`/projects/${p.id}`}
                        className="flex items-center gap-2 font-medium hover:underline"
                      >
                        {p.color && (
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: p.color }}
                          />
                        )}
                        <span>{p.name}</span>
                        <ExternalLink className="size-3 text-muted-foreground/60" />
                      </Link>
                      {p.description && (
                        <div className="text-[11px] text-muted-foreground" title={p.description}>
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {budget !== null
                        ? formatIls(budget, { decimals: false })
                        : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-medium">
                      {formatIls(p.totalExpenses, { decimals: false })}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {p.totalIncome > 0 ? (
                        <span className="text-success font-medium">
                          {formatIls(p.totalIncome, { decimals: false })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {pct !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full transition-all"
                              style={{
                                width: `${Math.min(100, pct)}%`,
                                backgroundColor: overBudget
                                  ? 'var(--destructive)'
                                  : nearBudget
                                    ? 'var(--warning)'
                                    : (p.color ?? 'var(--primary)'),
                              }}
                            />
                          </div>
                          <span className={`text-xs tabular-nums ${
                            overBudget ? 'text-destructive font-medium' : 'text-muted-foreground'
                          }`}>
                            {pct}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{p.txnCount}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_TONE[p.status] ?? 'bg-muted text-muted-foreground'
                      }`}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setModalProject(p)}
                          className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40"
                          title="ערוך"
                          aria-label="ערוך"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(p)}
                          disabled={isPending}
                          className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-30"
                          title="מחק"
                          aria-label="מחק"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalProject !== undefined && (
        <ProjectModal
          project={modalProject}
          onClose={closeEditModal}
        />
      )}
    </>
  );
}
