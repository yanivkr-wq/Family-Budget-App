import { Skeleton, SkeletonHeader, SkeletonTile } from '@/components/ui/skeleton';

export default function SavingsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SkeletonTile />
        <SkeletonTile />
      </div>
      <div className="tile space-y-4">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
