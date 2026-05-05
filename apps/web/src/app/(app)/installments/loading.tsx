// Installments loading skeleton
import { Skeleton, SkeletonHeader, SkeletonTile, SkeletonTable } from '@/components/ui/skeleton';

export default function InstallmentsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <SkeletonTile />
        <SkeletonTile />
      </div>

      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
