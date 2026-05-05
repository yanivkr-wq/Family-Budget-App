// Admin audit log loading skeleton
import { Skeleton, SkeletonHeader, SkeletonTable } from '@/components/ui/skeleton';

export default function AdminAuditLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>

      <SkeletonTable rows={10} cols={5} />

      {/* Pagination */}
      <div className="flex justify-end gap-2">
        <Skeleton className="h-8 w-16 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>
    </div>
  );
}
