import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { FADE_MS, NOT_CONFIGURED, REFRESH_MS, type RowMark, type TaskItem } from './model';

export type TasksStatus = 'loading' | 'ready' | 'unconfigured' | 'error';

export interface TasksState {
  status: TasksStatus;
  tasks: TaskItem[];
  /** Per task: 'done' while struck through, 'failed' after a save that did not work. */
  marks: Record<string, RowMark>;
  /** Tasks that finished fading out. */
  hidden: ReadonlySet<string>;
  /** Time of the last good list, or null. */
  lastOk: number | null;
  now: number;
  complete: (id: string) => void;
}

/**
 * The next three open tasks. Refreshes every 2 minutes while visible and after each
 * completion. A completion shows at once (struck through, gone after 2 seconds) and
 * is sent in the background; if the save fails the row comes back marked "failed".
 * A failed refresh keeps the last good list.
 */
export function useTasks(): TasksState {
  const visible = useVisible();
  const [status, setStatus] = useState<TasksStatus>('loading');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [marks, setMarks] = useState<Record<string, RowMark>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(false);
  const tasksRef = useRef<TaskItem[]>([]);
  const inFlight = useRef(false);
  const fades = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Ids completed this session and not yet faded out; a refresh keeps them in place until then.
  const leaving = useRef(new Map<string, TaskItem>());
  const pending = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    const timers = fades.current;
    return () => {
      mounted.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const list = await invoke<TaskItem[]>('wall2_tasks_next');
      if (!mounted.current) return;
      const fresh = Array.isArray(list) ? list : [];
      const kept = [...leaving.current.values()].filter((t) => !fresh.some((f) => f.id === t.id));
      const next = [...fresh, ...kept];
      tasksRef.current = next;
      setTasks(next);
      setStatus('ready');
      setLastOk(Date.now());
    } catch (e) {
      if (!mounted.current) return;
      const text = e instanceof Error ? e.message : String(e);
      if (text === NOT_CONFIGURED) setStatus('unconfigured');
      else setStatus('error');
    } finally {
      inFlight.current = false;
      if (mounted.current) setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [visible, refresh]);

  const complete = useCallback(
    (id: string) => {
      if (pending.current.has(id)) return;
      pending.current.add(id);
      setMarks((m) => ({ ...m, [id]: 'done' }));
      const row = tasksRef.current.find((t) => t.id === id);
      if (row) leaving.current.set(id, row);
      let faded = false;
      let saved = false;
      const finish = () => {
        if (!faded || !saved || !mounted.current) return;
        leaving.current.delete(id);
        void refresh();
      };
      const fade = setTimeout(() => {
        fades.current.delete(fade);
        faded = true;
        if (!mounted.current) return;
        setHidden((h) => new Set(h).add(id));
        finish();
      }, FADE_MS);
      fades.current.add(fade);
      invoke('wall2_task_done', { id })
        .then(() => {
          pending.current.delete(id);
          saved = true;
          finish();
        })
        .catch(() => {
          pending.current.delete(id);
          leaving.current.delete(id);
          clearTimeout(fade);
          fades.current.delete(fade);
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

  return { status, tasks, marks, hidden, lastOk, now, complete };
}
