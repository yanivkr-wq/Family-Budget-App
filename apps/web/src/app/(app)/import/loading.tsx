import { Skeleton, SkeletonHeader } from '@/components/ui/skeleton';

export default function ImportLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="tile space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
    </div>
  );
}
