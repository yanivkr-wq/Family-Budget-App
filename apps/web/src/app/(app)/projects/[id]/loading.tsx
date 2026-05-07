import { Skeleton, SkeletonHeader, SkeletonTile, SkeletonTable } from '@/components/ui/skeleton';

export default function ProjectDetailLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
      </div>
      <div className="tile space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
