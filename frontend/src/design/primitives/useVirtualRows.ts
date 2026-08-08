/**
 * Fixed-height row virtualization (blueprint §14).
 *
 * "Virtualize every list >50 rows" is a mandatory technique in the performance
 * budget. Every list this applies to — the repository tree, ranked files,
 * tables, the activity feed — has uniform row heights, which makes the whole
 * problem arithmetic: the visible window is derivable from `scrollTop` alone,
 * with no measurement pass and no observer.
 *
 * That is why this is ~60 lines rather than a dependency. `@tanstack/virtual`
 * earns its weight when rows are dynamically sized; here it would add a
 * package to the initial bundle to compute a division.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface VirtualRowsOptions {
  count: number;
  rowHeight: number;
  /** Rows rendered beyond the viewport, so scrolling never shows a gap. */
  overscan?: number;
  /** Below this, virtualization costs more than it saves. */
  threshold?: number;
}

export interface VirtualRows<T extends HTMLElement> {
  /** Attach to the scrolling container. */
  ref: React.RefObject<T | null>;
  onScroll: () => void;
  /** First row to render, inclusive. */
  start: number;
  /** Last row to render, exclusive. */
  end: number;
  /** Full height of all rows, so the scrollbar is honest. */
  totalHeight: number;
  /** Offset of the first rendered row. */
  offsetTop: number;
  /** Whether windowing is active — below the threshold everything renders. */
  active: boolean;
}

export const DEFAULT_VIRTUAL_THRESHOLD = 50;

export function useVirtualRows<T extends HTMLElement>({
  count,
  rowHeight,
  overscan = 8,
  threshold = DEFAULT_VIRTUAL_THRESHOLD,
}: VirtualRowsOptions): VirtualRows<T> {
  const ref = useRef<T | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const active = count > threshold;

  const onScroll = useCallback(() => {
    if (ref.current) setScrollTop(ref.current.scrollTop);
  }, []);

  // The container's height drives how many rows fit. Observed rather than
  // assumed, so a resized panel re-windows instead of clipping.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    setViewport(element.clientHeight);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!active) {
    return {
      ref,
      onScroll,
      start: 0,
      end: count,
      totalHeight: count * rowHeight,
      offsetTop: 0,
      active: false,
    };
  }

  const visible = Math.ceil((viewport || rowHeight * threshold) / rowHeight);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, start + visible + overscan * 2);

  return {
    ref,
    onScroll,
    start,
    end,
    totalHeight: count * rowHeight,
    offsetTop: start * rowHeight,
    active: true,
  };
}
