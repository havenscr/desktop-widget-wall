import { useCallback, useRef, type KeyboardEvent } from 'react';

/** How long the same control stays quiet after its action settles. */
export const LATCH_MS = 500;

/**
 * Keeps one activation to one action. A click that is part of a double click (`detail > 1`),
 * a second activation while one is running, and a repeat of the same control within about
 * 500 ms of its action settling are all ignored; a held key (`repeat`) never activates.
 */
export function useGuard() {
  const busy = useRef(false);
  const until = useRef(new Map<string, number>());
  const run = useCallback(async (id: string, detail: number, action: () => Promise<void>) => {
    if (detail > 1 || busy.current || Date.now() < (until.current.get(id) ?? 0)) return;
    busy.current = true;
    try {
      await action();
    } finally {
      busy.current = false;
      until.current.set(id, Date.now() + LATCH_MS);
    }
  }, []);
  /** Stops the click a held Enter or Space would make again and again. */
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.repeat) e.preventDefault();
  }, []);
  return { run, onKeyDown };
}
