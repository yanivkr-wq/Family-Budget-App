// Transactions page loading skeleton
import { Skeleton, SkeletonHeader, SkeletonTable } from '@/components/ui/skeleton';

export default function TransactionsLoading() {
  return (
    <div className="space-y-6">
      {/* Header + month switcher */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SkeletonHeader />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>

      {/* Add-transaction form card */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-36" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Transactions table */}
      <SkeletonTable rows={8} cols={7} />
    </div>
  );
}
