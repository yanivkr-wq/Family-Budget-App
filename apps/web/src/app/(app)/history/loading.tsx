// History page loading skeleton
import { Skeleton, SkeletonHeader } from '@/components/ui/skeleton';

export default function HistoryLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />

      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-24" />
              <div className="flex gap-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
            {/* Expense bar */}
            <Skeleton className="h-1 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
