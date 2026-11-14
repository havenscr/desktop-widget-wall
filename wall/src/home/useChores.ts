import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { FADE_MS, NOT_CONFIGURED, REFRESH_MS, type RowMark, type TaskItem } from '../tasks/model';
import { useVisible } from '../ui/useVisible';

/** Around the house is the task app's `home` tag, not a list. */
/** Home lists up to twenty chores (five rows in view, the rest a scroll away). */
export const CHORES_LIMIT = 20;
export const CHORES_ARGS = { tag: 'home', limit: CHORES_LIMIT } as const;

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
 * every two minutes while visible; a failed read keeps the last good list (the card
 * shows it as stale). Ticking a row strikes it at once, saves it in the background,
 * hides it after two seconds and reads the list again; only a read that started after
 * the save settled may bring a ticked row back. A failed save brings the row back
 * marked "failed".
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
  const queued = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Request generations, as in tasks/useTasks.ts: each read takes the next number. A ticked
  // row is decided again only by a read that started after its save settled and it faded.
  const started = useRef(0);
  const completed = useRef(new Map<string, { saved: boolean; faded: boolean; savedAfter: number }>());
  // Ticked rows not yet decided, kept in place even when a read no longer lists them.
  const leaving = useRef(new Map<string, TaskItem>());

  useEffect(() => {
    mounted.current = true;
    const t = timers.current;
    return () => {
      mounted.current = false;
      t.forEach(clearTimeout);
      t.clear();
    };
  }, []);

  const read = useCallback(async () => {
    const mine = ++started.current;
    try {
      const r = await invoke<Summary>('wall2_tasks_summary', { ...CHORES_ARGS });
      if (!mounted.current) return;
      const fresh = Array.isArray(r?.next) ? r.next.slice(0, CHORES_LIMIT) : [];
      const settled: string[] = [];
      for (const [id, c] of completed.current) {
        if (c.saved && c.faded && mine > c.savedAfter) settled.push(id);
      }
      for (const id of settled) {
        completed.current.delete(id);
        leaving.current.delete(id);
      }
      const kept = [...leaving.current.values()].filter((t) => !fresh.some((f) => f.id === t.id));
      const next = [...fresh, ...kept];
      const ids = new Set(next.map((t) => t.id));
      setTasks(next);
      setRemaining(typeof r?.remaining === 'number' && r.remaining > 0 ? r.remaining : 0);
      setHidden((h) => new Set([...h].filter((id) => completed.current.has(id))));
      setMarks((m) => Object.fromEntries(Object.entries(m).filter(([id]) => ids.has(id) && !settled.includes(id))));
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
      if (completed.current.has(id)) return;
      const rec = { saved: false, faded: false, savedAfter: Infinity };
      completed.current.set(id, rec);
      const row = tasks.find((t) => t.id === id);
      if (row) leaving.current.set(id, row);
      setMarks((m) => ({ ...m, [id]: 'done' }));
      const finish = () => {
        if (rec.saved && rec.faded && mounted.current) void refresh();
      };
      const fade = setTimeout(() => {
        timers.current.delete(fade);
        rec.faded = true;
        if (!mounted.current) return;
        setHidden((h) => new Set(h).add(id));
        finish();
      }, FADE_MS);
      timers.current.add(fade);
      invoke('wall2_task_done', { id })
        .then(() => {
          rec.saved = true;
          rec.savedAfter = started.current;
          finish();
        })
        .catch(() => {
          completed.current.delete(id);
          leaving.current.delete(id);
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
    [refresh, tasks],
  );

  return { status, tasks, remaining, marks, hidden, complete };
}
