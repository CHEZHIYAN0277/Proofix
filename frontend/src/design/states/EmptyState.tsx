/**
 * `<EmptyState>` (blueprint §3.6).
 *
 * "The backend ran and produced nothing" — distinct from `Waiting` (it has not
 * run) and from `Unavailable` (it cannot run). Every list, panel and graph
 * declares this state explicitly.
 */

import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  /** An action that would produce data. Never a "generate sample data" path. */
  action?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  size = "md",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-border text-center",
        size === "sm" ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-10",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn("text-ink-soft/60", size === "sm" ? "size-4" : "size-5")}
        strokeWidth={1.75}
      />
      <p className={cn(size === "sm" ? "type-label" : "type-title-3", "text-ink")}>{title}</p>
      {description && (
        <p className="type-body-sm max-w-sm text-balance text-ink-soft">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
