// Insights loading skeleton
import { Skeleton, SkeletonHeader } from '@/components/ui/skeleton';

export default function InsightsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="tile space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="size-5 rounded" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-7 w-28 rounded-md" />
          </div>
        ))}
      </div>

      {/* AI CTA */}
      <div className="rounded-xl border p-6 text-center space-y-3">
        <Skeleton className="size-8 rounded-full mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
        <Skeleton className="h-3 w-64 mx-auto" />
        <Skeleton className="h-3 w-56 mx-auto" />
      </div>
    </div>
  );
}
