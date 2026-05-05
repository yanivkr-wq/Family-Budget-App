import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

/** A full-width header placeholder: title + optional subtitle */
export function SkeletonHeader({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <header className="space-y-2">
      <Skeleton className="h-7 w-48" />
      {subtitle && <Skeleton className="h-4 w-32" />}
    </header>
  );
}

/** A single stat tile (matches the `.tile` class used in pages) */
export function SkeletonTile({ className }: { className?: string }) {
  return (
    <div className={cn('tile space-y-3', className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-32" />
    </div>
  );
}

/** A table with N skeleton rows */
export function SkeletonTable({
  rows = 6,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="min-w-full">
        <thead className="bg-muted/40">
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="border-b px-3 py-2">
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b last:border-0">
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="px-3 py-3">
                  <Skeleton className={cn('h-3', c === 1 ? 'w-32' : 'w-20')} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
