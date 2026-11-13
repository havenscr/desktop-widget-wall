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
 * place (the list unmounts), the page hiding or the window closing (`pagehide`,
 * `beforeunload`) commits every tick still waiting, once, since the owner moved on.
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

  // Every early commit goes through this one path: each waiting id leaves the map before its
  // commit, so a timer, a place change and a closing window can never send the same tick twice.
  const flush = useCallback(() => {
    const map = timers.current;
    if (map.size === 0) return;
    const ids = [...map.keys()];
    for (const t of map.values()) clearTimeout(t);
    map.clear();
    setPending(new Set());
    for (const id of ids) commitRef.current(id);
  }, []);

  useEffect(() => {
    // The window or web view going away (or hidden) may skip React's cleanup, so the page's own
    // lifecycle events commit what waits: the owner has moved on.
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  return { pending, tick, undo };
}
