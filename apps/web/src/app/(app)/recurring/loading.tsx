// Recurring expenses loading skeleton
import { Skeleton, SkeletonHeader, SkeletonTile, SkeletonTable } from '@/components/ui/skeleton';

export default function RecurringLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SkeletonTile />
        <SkeletonTile />
      </div>

      <SkeletonTable rows={7} cols={7} />
    </div>
  );
}
