import { IconCheck, IconClockExclamation } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useFocusStore } from '../focus/store';
import { dueLine, estText, estTipText, HOLD_SLOP_PX, LONG_PRESS_MS, openTask, overdueText, updatedText, visibleRows, type TaskItem } from './model';
import { tip } from '../ui/HoverTip';
import { usePendingTicks } from './pendingTick';
import { TaskTags } from './TaskTags';
import { useTasks, type TasksQuery } from './useTasks';

/** Work's list: the tasks without the home tag that are due today or overdue (the next three when none is). */
const WORK_QUERY: TasksQuery = { notTag: 'home', due: 'today' };

/** Rows in view in the block, and a row's pitch: 70 px and its 1 px rule (the block keeps the height three rows gave it). */
export const WORK_ROWS = 3;
export const WORK_ROW_PX = 71;
/** A key step still counts as under way this long, so a held key keeps adding rows. */
const KEY_SCROLL_MS = 400;
/**
 * Width a Work row leaves for the title and its tags together, counting the gap between them
 * the way `tagLayout` does: the 590 px row (596 less the 6 px scroll gutter), less the 50 px
 * tick, the fixed 78 px time column, the 18 px overdue slot and the gaps before them (16 px,
 * and 10 px between the slot and the time column).
 */
const WORK_ROOM = 414;

/**
 * One task as the concept draws it (`.tk3`): a check circle, the title and the estimate.
 * A click on the title opens the task in the task app. Holding the row for half a second
 * starts a focus session named after the task instead (that press opens nothing); a
 * press cancelled or moved more than 12 px does neither. A tick first shows "Done" with
 * Undo and a thin five second bar; only then is the task completed.
 */
function TaskRow({
  task,
  now,
  mark,
  pending,
  canFocus,
  onDone,
  onUndo,
}: {
  task: TaskItem;
  now: number;
  mark: 'done' | 'failed' | undefined;
  pending: boolean;
  canFocus: boolean;
  onDone: () => void;
  onUndo: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  /** The press became a hold (focus started) or was cancelled by a move: its click opens nothing. */
  const swallow = useRef(false);
  /**
   * Swallow the click that ends this press, and only that one: the flag clears just after
   * the pointer is released anywhere (the click, if any, comes first), so a press released
   * off the row cannot swallow a later click.
   */
  const swallowThisPress = () => {
    swallow.current = true;
    window.addEventListener('pointerup', () => setTimeout(() => (swallow.current = false), 0), { once: true });
  };
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    downAt.current = null;
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const focusable = canFocus && mark !== 'done';
  const startFocus = () => useFocusStore.getState().startLabeled(task.title);
  const est = estText(task.est);
  const due = dueLine(task, new Date(now));
  const late = overdueText(task, new Date(now));

  const ticked = mark === 'done' || pending;
  return (
    <li data-task={task.id} className={`tk3 task-row${mark === 'done' ? ' done' : ''}${pending ? ' pending' : ''}${holding ? ' holding' : ''}`}>
      <button
        type="button"
        className={`task-check${ticked ? ' on' : ''}`}
        aria-label={`Mark done: ${task.title}`}
        disabled={ticked}
        onClick={onDone}
      >
        <i className="ck" aria-hidden="true">
          {ticked && <IconCheck size={20} stroke={3} />}
        </i>
      </button>
      {pending ? (
        <TickWait title={task.title} onUndo={onUndo} />
      ) : (
        <>
          <button
            type="button"
            className="tk-main"
            aria-label={focusable ? `Open ${task.title}; hold to focus on it` : `Open ${task.title}`}
            title={task.title}
            onPointerDown={(e) => {
              swallow.current = false;
              if (!focusable) return;
              stop();
              downAt.current = { x: e.clientX, y: e.clientY };
              setHolding(true);
              timer.current = setTimeout(() => {
                timer.current = undefined;
                downAt.current = null;
                swallowThisPress();
                setHolding(false);
                startFocus();
              }, LONG_PRESS_MS);
            }}
            // On touch the pointer is captured and pointerleave does not fire while the finger
            // slides, so a move of more than 12 px from where it went down cancels the hold.
            onPointerMove={(e) => {
              const d = downAt.current;
              if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > HOLD_SLOP_PX) {
                swallowThisPress();
                stop();
              }
            }}
            onClick={() => {
              if (swallow.current) {
                swallow.current = false;
                return;
              }
              openTask(task.id);
            }}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              // Keyboards cannot hold: Enter starts focus straight away.
              if (e.key === 'Enter' && focusable) {
                e.preventDefault();
                startFocus();
              }
            }}
          >
            <span className="n task-title">{task.title}</span>
            {mark !== 'failed' && <TaskTags tags={task.tags} room={WORK_ROOM} />}
            {mark === 'failed' ? (
              <span className="xs task-err">Could not complete.</span>
            ) : (
              <>
                <span className="od-slot">
                  {late && (
                    <span className="od-mark" role="img" aria-label={late} {...tip(late)}>
                      <IconClockExclamation size={18} stroke={2} aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="chip-col">{est && <span className="est" {...tip(estTipText(due))}>{est}</span>}</span>
              </>
            )}
          </button>
          {mark === 'failed' && (
            <button type="button" className="tick-act" onClick={onDone} title={`Try completing ${task.title} again`}>
              Retry
            </button>
          )}
        </>
      )}
    </li>
  );
}

/**
 * A ticked row inside its undo window: "Done." and the title struck through, an Undo
 * button, and a thin bar that runs down over the five seconds (still with reduced motion).
 */
export function TickWait({ title, onUndo }: { title: string; onUndo: () => void }) {
  return (
    <div className="tick-wait" role="status">
      <span className="n tick-text">
        <span className="tick-done">Done.</span> <s>{title}</s>
      </span>
      <button type="button" className="tick-act" onClick={onUndo} aria-label={`Undo: ${title}`} title="Put it back; nothing is saved yet">
        Undo
      </button>
      <i className="tick-bar" aria-hidden="true" />
    </div>
  );
}

/**
 * The block's list: three rows in view, the rest a scroll away (the wheel with the pointer
 * over it, a 6 px bar, arrow keys and Page Up and Down with a row focused). A soft fade marks
 * each edge while more rows wait beyond it. A refresh or a removed row never moves the rows in
 * view: the first row in view is found again by its id and put back where it was.
 */
function TaskList({ children, rows }: { children: ReactNode; rows: number }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });
  const anchor = useRef<{ id: string; top: number } | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = { top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 };
    setEdge((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
    anchor.current = null;
    if (el.scrollTop > 0) {
      for (const li of Array.from(el.children) as HTMLElement[]) {
        if (li.offsetTop + li.offsetHeight > el.scrollTop + 1 && li.dataset.task) {
          anchor.current = { id: li.dataset.task, top: li.offsetTop - el.scrollTop };
          break;
        }
      }
    }
  }, []);

  // After every change of rows: keep the first row in view where it was, then redraw the edges.
  useLayoutEffect(() => {
    const el = ref.current;
    const a = anchor.current;
    if (el && a) {
      const li = (Array.from(el.children) as HTMLElement[]).find((c) => c.dataset.task === a.id);
      if (li) {
        const drift = li.offsetTop - el.scrollTop - a.top;
        if (drift !== 0) {
          // A correction is instant: smooth scrolling is only for a person's own key steps.
          el.style.scrollBehavior = 'auto';
          el.scrollTop += drift;
          el.style.scrollBehavior = '';
        }
      }
    }
    measure();
  }, [children, rows, measure]);

  // Where the last key step is heading, so a held key adds to it instead of to a half-finished scroll.
  const heading = useRef<{ top: number; at: number } | null>(null);
  const key = (e: KeyboardEvent<HTMLUListElement>) => {
    const el = ref.current;
    if (!el) return;
    const step = e.key === 'ArrowDown' ? WORK_ROW_PX : e.key === 'ArrowUp' ? -WORK_ROW_PX : e.key === 'PageDown' ? el.clientHeight : e.key === 'PageUp' ? -el.clientHeight : 0;
    if (!step) return;
    e.preventDefault();
    const h = heading.current;
    const base = h && Date.now() - h.at < KEY_SCROLL_MS ? h.top : el.scrollTop;
    const top = Math.min(Math.max(0, el.scrollHeight - el.clientHeight), Math.max(0, base + step));
    heading.current = { top, at: Date.now() };
    const calm = typeof el.scrollTo === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (calm) el.scrollTo({ top, behavior: 'smooth' });
    else el.scrollTop = top;
  };

  const more = rows > WORK_ROWS;
  const cls = ['tasks-list', more ? 'scrolls' : '', edge.top ? 'fade-top' : '', edge.bottom ? 'fade-bottom' : ''].filter(Boolean).join(' ');
  return (
    <ul ref={ref} className={cls} onScroll={measure} onKeyDown={key}>
      {children}
    </ul>
  );
}

/**
 * "Due today": every open task due today or overdue (without the home tag), overdue first, as
 * a small scrolling list with each task's tags. When nothing is due the block reads "Next up"
 * and shows the next three tasks. Click the circle to finish one, the title to open it, hold
 * a row to focus on it.
 */
export function TaskCard() {
  const t = useTasks(WORK_QUERY);
  const ticks = usePendingTicks(t.complete);
  const focusStatus = useFocusStore((s) => s.state.status);
  const canFocus = focusStatus === 'idle' || focusStatus === 'finished';
  const rows = visibleRows(t.tasks, t.hidden);
  const stale = t.status === 'error' && t.lastOk !== null ? updatedText(t.lastOk, t.now) : null;
  const nextUp = t.nextUp && rows.length > 0;
  const overdue = nextUp ? 0 : rows.filter((r) => dueLine(r, new Date(t.now)) === 'overdue').length;
  const count = rows.length + (t.remaining ?? 0);
  const side = stale ?? (nextUp ? 'Nothing due today' : rows.length > 0 ? (overdue > 0 ? `${count}, ${overdue} overdue` : `${count}`) : null);

  let body;
  if (t.status === 'unconfigured') {
    body = <div className="s">Not set up</div>;
  } else if (t.status === 'loading') {
    body = <div className="s">Loading tasks</div>;
  } else if (t.status === 'error' && t.lastOk === null) {
    body = <div className="s">Tasks unavailable</div>;
  } else if (rows.length === 0) {
    // No open task at all: the heading stays "Due today" (Next up is only ever the next tasks).
    body = <div className="s">Nothing due today</div>;
  } else {
    body = (
      <TaskList rows={rows.length}>
        {rows.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={t.now}
            mark={t.marks[task.id]}
            pending={ticks.pending.has(task.id)}
            canFocus={canFocus}
            onDone={() => (t.marks[task.id] === 'failed' ? t.complete(task.id) : ticks.tick(task.id))}
            onUndo={() => ticks.undo(task.id)}
          />
        ))}
      </TaskList>
    );
  }

  return (
    <section className="tasks" aria-label="Tasks">
      <div className="row sb tasks-hd">
        <span className="k">{nextUp ? 'Next up' : 'Due today'}</span>
        {side && <span className="xs">{side}</span>}
      </div>
      <div className="tasks-body">{body}</div>
    </section>
  );
}
