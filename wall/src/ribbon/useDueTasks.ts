import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { REFRESH_MS, type TaskItem } from '../tasks/model';

/** Work and Meet read the tasks without the home tag; Home reads only those with it. */
export function summaryArgs(kind: 'work' | 'home'): Record<string, string> {
  return kind === 'home' ? { tag: 'home' } : { notTag: 'home' };
}

/**
 * The next three open tasks for the ribbon's due marks, from `wall2_tasks_summary`: read
 * when `on` turns true (or the kind changes), then every two minutes while it stays true.
 * Not set up or a failed read gives no tasks, so the ribbon shows no marks.
 */
export function useDueTasks(kind: 'work' | 'home', on: boolean): TaskItem[] {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const read = () => {
      invoke<{ next?: TaskItem[] }>('wall2_tasks_summary', summaryArgs(kind))
        .then((r) => live && setTasks(Array.isArray(r?.next) ? r.next.slice(0, 3) : []))
        .catch(() => live && setTasks([]));
    };
    read();
    const id = setInterval(read, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [kind, on]);
  return tasks;
}
