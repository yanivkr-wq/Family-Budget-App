// Admin categories loading skeleton
import { Skeleton, SkeletonHeader } from '@/components/ui/skeleton';

export default function AdminCategoriesLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />

      {/* Add-category form */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-36" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* Category rows */}
      <div className="space-y-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-20 ms-auto" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
