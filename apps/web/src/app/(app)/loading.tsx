// Dashboard loading skeleton
import { Skeleton, SkeletonHeader, SkeletonTile } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header + month / account switchers */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SkeletonHeader />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
        </div>
      </div>

      {/* Top stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
      </div>

      {/* Cash-flow info bar */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Category budget progress list */}
      <div className="tile space-y-4">
        <Skeleton className="h-4 w-36" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>

      {/* Predicted EoM + anomaly tiles */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonTile />
        <SkeletonTile />
      </div>
    </div>
  );
}
