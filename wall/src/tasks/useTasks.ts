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
  /** Open tasks after the three shown (summary reads only), or null. */
  remaining: number | null;
  now: number;
  complete: (id: string) => void;
}

/** Filters for `wall2_tasks_summary`. Without them the hook reads `wall2_tasks_next`. */
export interface TasksQuery {
  tag?: string;
  notTag?: string;
}

interface SummaryAnswer {
  next?: TaskItem[];
  remaining?: number;
}

/**
 * The next three open tasks. Refreshes every 2 minutes while visible and after each
 * completion. A completion shows at once (struck through, gone after 2 seconds) and
 * is sent in the background; if the save fails the row comes back marked "failed".
 * A failed refresh keeps the last good list.
 */
export function useTasks(query?: TasksQuery): TasksState {
  const visible = useVisible();
  const queryKey = query ? JSON.stringify({ tag: query.tag, notTag: query.notTag }) : null;
  const [remaining, setRemaining] = useState<number | null>(null);
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
  const queued = useRef(false);
  const started = useRef(0);
  const completed = useRef(new Map<string, { saved: boolean; faded: boolean; savedAfter: number }>());

  useEffect(() => {
    mounted.current = true;
    const timers = fades.current;
    return () => {
      mounted.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const fetchList = useCallback(async () => {
    const mine = ++started.current;
    try {
      let list: unknown;
      let more: number | null = null;
      if (queryKey) {
        const args = JSON.parse(queryKey) as TasksQuery;
        const r = await invoke<SummaryAnswer>('wall2_tasks_summary', {
          ...(args.tag ? { tag: args.tag } : {}),
          ...(args.notTag ? { notTag: args.notTag } : {}),
        });
        list = r?.next;
        more = typeof r?.remaining === 'number' && r.remaining > 0 ? r.remaining : 0;
      } else {
        list = await invoke<TaskItem[]>('wall2_tasks_next');
      }
      if (!mounted.current) return;
      const fresh = (Array.isArray(list) ? list : []) as TaskItem[];
      setRemaining(more);
      // A list fetched after a completed row was saved and faded decides that row from now on:
      // gone, or open again (reopened, or a recurring task that keeps its id).
      const settled: string[] = [];
      for (const [id, c] of completed.current) {
        if (c.saved && c.faded && mine > c.savedAfter) settled.push(id);
      }
      for (const id of settled) completed.current.delete(id);
      const kept = [...leaving.current.values()].filter((t) => !fresh.some((f) => f.id === t.id));
      const next = [...fresh, ...kept];
      tasksRef.current = next;
      setTasks(next);
      if (settled.length > 0) {
        setHidden((h) => {
          const n = new Set(h);
          settled.forEach((id) => n.delete(id));
          return n;
        });
        setMarks((m) => {
          const n = { ...m };
          settled.forEach((id) => delete n[id]);
          return n;
        });
      }
      setStatus('ready');
      setLastOk(Date.now());
    } catch (e) {
      if (!mounted.current) return;
      const text = e instanceof Error ? e.message : String(e);
      if (text === NOT_CONFIGURED) setStatus('unconfigured');
      else setStatus('error');
    }
  }, [queryKey]);

  // One list request at a time. A request made while one is running queues a single trailing one.
  const refresh = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        await fetchList();
      } while (queued.current && mounted.current);
    } finally {
      inFlight.current = false;
      if (mounted.current) setNow(Date.now());
    }
  }, [fetchList]);

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
      const rec = { saved: false, faded: false, savedAfter: Infinity };
      completed.current.set(id, rec);
      const finish = () => {
        if (!rec.faded || !rec.saved || !mounted.current) return;
        leaving.current.delete(id);
        void refresh();
      };
      const fade = setTimeout(() => {
        fades.current.delete(fade);
        rec.faded = true;
        if (!mounted.current) return;
        setHidden((h) => new Set(h).add(id));
        finish();
      }, FADE_MS);
      fades.current.add(fade);
      invoke('wall2_task_done', { id })
        .then(() => {
          pending.current.delete(id);
          rec.saved = true;
          rec.savedAfter = started.current;
          finish();
        })
        .catch(() => {
          pending.current.delete(id);
          leaving.current.delete(id);
          completed.current.delete(id);
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

  return { status, tasks, marks, hidden, lastOk, remaining, now, complete };
}
