/**
 * Table (blueprint §3.6).
 *
 * Dense enterprise: **36px rows, sticky header, mono numerics, right-aligned
 * numbers, zebra off, hover tint only.**
 *
 * Column-driven rather than composed from `<tr>`/`<td>`, because the blueprint
 * requires that **every graph ships a Table equivalent** — the accessibility
 * contract and the mobile escape hatch. A shared column shape means a graph
 * and its table render from one definition instead of two that drift.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { EmptyState } from "../states/EmptyState";

export const TABLE_ROW_HEIGHT = 36;

export interface TableColumn<T> {
  /** Stable key, used for React keys and for sort state. */
  key: string;
  header: ReactNode;
  /** Cell renderer. Return a primitive and the table styles it for you. */
  cell: (row: T, index: number) => ReactNode;
  /**
   * Numbers are right-aligned and mono; text is left-aligned and sans.
   * This is the only alignment control — ad hoc alignment is how dense tables
   * become unreadable.
   */
  numeric?: boolean;
  /** Identifiers, paths and SHAs are mono even though they are not numeric. */
  mono?: boolean;
  width?: string;
  /** Accessible header text when `header` is an icon. */
  headerLabel?: string;
}

export interface DataTableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Caption for screen readers; also the graph-equivalence label. */
  caption?: string;
  onRowClick?: (row: T, index: number) => void;
  /** Shown when `rows` is empty — the table ran and found nothing. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Constrains height and scrolls under the sticky header. */
  maxHeight?: number | string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  onRowClick,
  emptyTitle = "No rows",
  emptyDescription,
  maxHeight,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} size="sm" />;
  }

  return (
    <div
      className={cn("overflow-auto rounded-card border border-border", className)}
      style={{ maxHeight }}
    >
      <table className="w-full border-collapse">
        {caption && <caption className="sr-only">{caption}</caption>}

        <thead className="sticky top-0 z-10 bg-surface-muted">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-label={col.headerLabel}
                style={{ width: col.width }}
                className={cn(
                  "type-label whitespace-nowrap border-b border-border px-3 py-2 text-ink-soft",
                  col.numeric ? "text-right" : "text-left",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              className={cn(
                // Zebra off; a hover tint is the only row decoration.
                "border-b border-border last:border-b-0 transition-colors hover:bg-surface-muted",
                onRowClick && "cursor-pointer",
              )}
              style={{
                height: TABLE_ROW_HEIGHT,
                transitionDuration: "var(--motion-instant)",
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "truncate px-3",
                    col.numeric || col.mono ? "type-mono" : "type-body-sm",
                    col.numeric ? "text-right" : "text-left",
                    "text-ink",
                  )}
                >
                  {col.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
