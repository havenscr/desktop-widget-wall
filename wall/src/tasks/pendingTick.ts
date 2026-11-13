import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a ticked task waits, showing "Done" and Undo, before it is really completed. */
export const TICK_UNDO_MS = 5000;

export interface PendingTicks {
  /** Rows ticked and still inside their undo window. */
  pending: ReadonlySet<string>;
  /** Tick a row: it shows "Done" with Undo, and `commit` runs when the window ends. One per row. */
  tick: (id: string) => void;
  /** Take a tick back inside the window: the row comes back and nothing is called. */
  undo: (id: string) => void;
}

/**
 * The undo window on a task tick (Work's next three and Home's chores). A tick waits
 * `TICK_UNDO_MS`, then calls `commit` (the list's existing complete command). Leaving the
 * place (the list unmounts) commits every tick still waiting, since the owner moved on.
 */
export function usePendingTicks(commit: (id: string) => void): PendingTicks {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const drop = (id: string) =>
    setPending((p) => {
      if (!p.has(id)) return p;
      const n = new Set(p);
      n.delete(id);
      return n;
    });

  const tick = useCallback((id: string) => {
    if (timers.current.has(id)) return;
    const t = setTimeout(() => {
      timers.current.delete(id);
      drop(id);
      commitRef.current(id);
    }, TICK_UNDO_MS);
    timers.current.set(id, t);
    setPending((p) => new Set(p).add(id));
  }, []);

  const undo = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t === undefined) return;
    clearTimeout(t);
    timers.current.delete(id);
    drop(id);
  }, []);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const [id, t] of map) {
        clearTimeout(t);
        commitRef.current(id);
      }
      map.clear();
    };
  }, []);

  return { pending, tick, undo };
}
