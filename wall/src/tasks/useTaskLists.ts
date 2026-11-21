import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';

export type TaskListsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; names: string[] };

/** Waits before each retry after a failed read: 15 s, 30 s, then every 60 s. */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000];

/**
 * The task app's list names (`wall2_tasks_lists`), read when the place opens. A failed read is retried
 * on a backoff while the place is mounted and the page is visible, and stops after a success.
 */
export function useTaskLists(enabled = true): TaskListsState {
  const [state, setState] = useState<TaskListsState>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clear();
      const wait = RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)];
      timer = setTimeout(() => {
        timer = undefined;
        if (document.visibilityState === 'hidden') return; // resumes on the next visibilitychange
        load();
      }, wait);
    };
    const load = () => {
      invoke<unknown>('wall2_tasks_lists')
        .then((r) => {
          if (!live) return;
          if (!Array.isArray(r)) throw new Error('bad answer');
          document.removeEventListener('visibilitychange', onVisible);
          setState({ status: 'ready', names: r.filter((n): n is string => typeof n === 'string' && n.trim() !== '') });
        })
        .catch(() => {
          if (!live) return;
          failures += 1;
          setState({ status: 'error' });
          schedule();
        });
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || failures === 0 || timer !== undefined) return;
      load();
    };
    document.addEventListener('visibilitychange', onVisible);
    load();
    return () => {
      live = false;
      clear();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
  return state;
}
