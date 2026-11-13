import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { REFRESH_MS, type TaskItem } from '../tasks/model';

/** Work and Meet read the tasks without the home tag; Home reads only those with it. */
export function summaryArgs(kind: 'work' | 'home'): Record<string, string> {
  return kind === 'home' ? { tag: 'home' } : { notTag: 'home' };
}

/** The ribbon's tasks, and whether the last read was good (so an empty list means none). */
export interface DueTaskFeed {
  tasks: TaskItem[];
  known: boolean;
}

/**
 * The next three open tasks for the ribbon's due marks, from `wall2_tasks_summary`: read
 * when `on` turns true (or the kind changes), then every two minutes while it stays true.
 * Not set up or a failed read gives no tasks, so the ribbon shows no marks, and `known`
 * is false until a read succeeds.
 */
export function useDueTaskFeed(kind: 'work' | 'home', on: boolean): DueTaskFeed {
  const [feed, setFeed] = useState<DueTaskFeed>({ tasks: [], known: false });
  useEffect(() => {
    if (!on) return;
    let live = true;
    const read = () => {
      invoke<{ next?: TaskItem[] }>('wall2_tasks_summary', summaryArgs(kind))
        .then((r) => {
          if (!live) return;
          const ok = Array.isArray(r?.next);
          setFeed({ tasks: ok ? r.next!.slice(0, 3) : [], known: ok });
        })
        .catch(() => live && setFeed({ tasks: [], known: false }));
    };
    read();
    const id = setInterval(read, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [kind, on]);
  return feed;
}

/** The tasks alone (see `useDueTaskFeed`). */
export function useDueTasks(kind: 'work' | 'home', on: boolean): TaskItem[] {
  return useDueTaskFeed(kind, on).tasks;
}
