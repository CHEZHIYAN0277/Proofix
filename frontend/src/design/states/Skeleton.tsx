/**
 * Skeletons (blueprint §3.6).
 *
 * Shape-preserving, one shimmer token.
 *
 * **Only for genuine in-flight fetches, never to simulate work.** A skeleton
 * that outlives its request is an animation pretending to be a system.
 */

import { cn } from "@/lib/utils";

export interface SkeletonProps {
  className?: string;
  /** Turns off the shimmer, leaving a static placeholder block. */
  animated?: boolean;
  /** Accessible description of what is loading. */
  label?: string;
}

export function Skeleton({ className, animated = true, label }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? "Loading"}
      className={cn("rounded-xs bg-surface-muted", animated && "ds-shimmer", className)}
    />
  );
}

/** A run of text lines, last one short — preserves the shape of a paragraph. */
export function SkeletonText({
  lines = 3,
  className,
  label,
}: {
  lines?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-busy>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          label={i === 0 ? (label ?? "Loading text") : undefined}
          className={cn("h-3", i === lines - 1 ? "w-2/5" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Card-shaped placeholder: title, two body lines, a footer row. */
export function SkeletonCard({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface p-5", className)} aria-busy>
      <Skeleton className="h-4 w-1/3" label={label ?? "Loading card"} />
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    </div>
  );
}

/** Rows of a dense table, at the design system's 36px row height. */
export function SkeletonRows({
  rows = 5,
  className,
  label,
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)} aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 border-b border-border px-3">
          <Skeleton
            className="h-3 flex-1"
            label={i === 0 ? (label ?? "Loading rows") : undefined}
          />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
