import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { FADE_MS, NOT_CONFIGURED, REFRESH_MS, type RowMark, type TaskItem } from '../tasks/model';
import { useVisible } from '../ui/useVisible';

/** Around the house is the task app's `home` tag, not a list. */
export const CHORES_ARGS = { tag: 'home' } as const;

export interface ChoresState {
  status: 'loading' | 'ready' | 'unconfigured' | 'error';
  tasks: TaskItem[];
  /** Open home tasks beyond the three shown. */
  remaining: number;
  marks: Record<string, RowMark>;
  hidden: ReadonlySet<string>;
  complete: (id: string) => void;
}

interface Summary {
  next?: TaskItem[];
  remaining?: number;
}

/**
 * The next three open tasks tagged `home`, from `wall2_tasks_summary`. Read on show and
 * every two minutes while visible; a failed read keeps the last good list. Ticking a
 * row strikes it at once, saves it in the background, hides it after two seconds and
 * reads the list again; a failed save brings the row back marked "failed".
 */
export function useChores(): ChoresState {
  const visible = useVisible();
  const [status, setStatus] = useState<ChoresState['status']>('loading');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [marks, setMarks] = useState<Record<string, RowMark>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const pending = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    mounted.current = true;
    const t = timers.current;
    return () => {
      mounted.current = false;
      t.forEach(clearTimeout);
      t.clear();
    };
  }, []);

  const queued = useRef(false);

  const read = useCallback(async () => {
    try {
      const r = await invoke<Summary>('wall2_tasks_summary', { ...CHORES_ARGS });
      if (!mounted.current) return;
      const next = Array.isArray(r?.next) ? r.next.slice(0, 3) : [];
      setTasks(next);
      setRemaining(typeof r?.remaining === 'number' && r.remaining > 0 ? r.remaining : 0);
      // A fresh list decides every row again: forget marks for rows it no longer holds.
      const ids = new Set(next.map((t) => t.id));
      setHidden((h) => new Set([...h].filter((id) => ids.has(id) && pending.current.has(id))));
      setMarks((m) => Object.fromEntries(Object.entries(m).filter(([id]) => ids.has(id))));
      setStatus('ready');
    } catch (e) {
      if (!mounted.current) return;
      const text = e instanceof Error ? e.message : String(e);
      setStatus(text === NOT_CONFIGURED ? 'unconfigured' : 'error');
    }
  }, []);

  // One read at a time; a read asked for while one runs queues a single trailing read.
  const refresh = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        await read();
      } while (queued.current && mounted.current);
    } finally {
      inFlight.current = false;
    }
  }, [read]);

  useEffect(() => {
    if (!visible) return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [visible, refresh]);

  const complete = useCallback(
    (id: string) => {
      if (pending.current.has(id)) return;
      pending.current.add(id);
      setMarks((m) => ({ ...m, [id]: 'done' }));
      let saved = false;
      let faded = false;
      const finish = () => {
        if (!saved || !faded || !mounted.current) return;
        pending.current.delete(id);
        void refresh();
      };
      const fade = setTimeout(() => {
        timers.current.delete(fade);
        faded = true;
        if (!mounted.current) return;
        setHidden((h) => new Set(h).add(id));
        finish();
      }, FADE_MS);
      timers.current.add(fade);
      invoke('wall2_task_done', { id })
        .then(() => {
          saved = true;
          finish();
        })
        .catch(() => {
          pending.current.delete(id);
          clearTimeout(fade);
          timers.current.delete(fade);
          if (!mounted.current) return;
          setHidden((h) => {
            const n = new Set(h);
            n.delete(id);
            return n;
          });
          setMarks((m) => ({ ...m, [id]: 'failed' }));
        });
    },
    [refresh],
  );

  return { status, tasks, remaining, marks, hidden, complete };
}
