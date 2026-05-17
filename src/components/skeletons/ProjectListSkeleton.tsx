import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const ProjectListSkeleton: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="w-full p-5 rounded-xl bg-card border border-[var(--surface-hairline-soft)] shadow-sm"
          >
            <div className="flex items-start gap-4 mb-3">
              <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
              <div className="flex-1 min-w-0 pr-16 flex flex-col justify-center">
                <Skeleton className="h-5 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2 rounded" />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--surface-hairline-soft)]">
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
