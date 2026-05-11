import { useEffect, useRef } from "react";

import type { ReaderStats } from "../../hooks/useTurn";

/**
 * Track the previous stats snapshot so callers can compute deltas for the
 * stat-pip "receipt" mark. Returns `null` on first render so initial mount
 * never fires phantom pips.
 */
export function usePreviousStats(stats: ReaderStats): ReaderStats | null {
  const ref = useRef<ReaderStats | null>(null);
  const snapshotRef = useRef<ReaderStats | null>(null);

  // Capture the previous value as observed at the start of this render.
  // We commit the new value in an effect so the captured "previous" stays
  // stable for the duration of the render cycle.
  if (snapshotRef.current === null) {
    snapshotRef.current = stats;
  }

  useEffect(() => {
    ref.current = stats;
  }, [stats]);

  return ref.current;
}
