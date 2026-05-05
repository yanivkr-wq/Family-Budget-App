// Grid page loading skeleton
import { Skeleton, SkeletonHeader } from '@/components/ui/skeleton';

export default function GridLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SkeletonHeader />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>

      {/* Grid table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            {/* Column headers (categories) */}
            <thead className="bg-muted/40">
              <tr>
                <th className="border-b px-2 py-2 w-10">
                  <Skeleton className="h-3 w-6" />
                </th>
                {Array.from({ length: 8 }).map((_, i) => (
                  <th key={i} className="border-b px-2 py-2 min-w-[80px]">
                    <Skeleton className="h-3 w-16" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }).map((_, r) => (
                <tr key={r} className="border-b last:border-0">
                  <td className="px-2 py-2">
                    <Skeleton className="h-3 w-4" />
                  </td>
                  {Array.from({ length: 8 }).map((_, c) => (
                    <td key={c} className="px-2 py-2 text-center">
                      {/* ~30% of cells have a value */}
                      {(r + c) % 3 === 0 ? (
                        <Skeleton className="h-3 w-12 mx-auto" />
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
