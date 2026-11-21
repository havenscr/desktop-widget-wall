import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';

export type TaskListsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; names: string[] };

/** The task app's list names, read once when the place opens (`wall2_tasks_lists`). */
export function useTaskLists(enabled = true): TaskListsState {
  const [state, setState] = useState<TaskListsState>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    invoke<unknown>('wall2_tasks_lists')
      .then((r) => {
        if (!live) return;
        if (!Array.isArray(r)) throw new Error('bad answer');
        setState({ status: 'ready', names: r.filter((n): n is string => typeof n === 'string' && n.trim() !== '') });
      })
      .catch(() => {
        if (live) setState({ status: 'error' });
      });
    return () => {
      live = false;
    };
  }, [enabled]);
  return state;
}
