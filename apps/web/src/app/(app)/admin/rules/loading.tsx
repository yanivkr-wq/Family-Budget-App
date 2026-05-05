// Admin rules loading skeleton
import { Skeleton, SkeletonHeader, SkeletonTable } from '@/components/ui/skeleton';

export default function AdminRulesLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />

      {/* Toolbar: search + buttons */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-9 w-60 rounded-md" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>

      <SkeletonTable rows={7} cols={5} />
    </div>
  );
}
