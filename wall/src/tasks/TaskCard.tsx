import { IconCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useFocusStore } from '../focus/store';
import { estText, HOLD_SLOP_PX, LONG_PRESS_MS, openTask, updatedText, visibleRows, type TaskItem } from './model';
import { usePendingTicks } from './pendingTick';
import { useTasks, type TasksQuery } from './useTasks';

/** Work's list: the tasks without the home tag. */
const WORK_QUERY: TasksQuery = { notTag: 'home' };

/**
 * One task as the concept draws it (`.tk3`): a check circle, the title and the estimate.
 * A click on the title opens the task in the task app. Holding the row for half a second
 * starts a focus session named after the task instead (that press opens nothing); a
 * press cancelled or moved more than 12 px does neither. A tick first shows "Done" with
 * Undo and a thin five second bar; only then is the task completed.
 */
function TaskRow({
  task,
  mark,
  pending,
  canFocus,
  onDone,
  onUndo,
}: {
  task: TaskItem;
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

  const ticked = mark === 'done' || pending;
  return (
    <li className={`tk3 task-row${mark === 'done' ? ' done' : ''}${pending ? ' pending' : ''}${holding ? ' holding' : ''}`}>
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
            {mark === 'failed' ? <span className="xs task-err">Could not complete.</span> : est && <span className="est">{est}</span>}
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

/** The next three open tasks without the home tag: click the circle to finish one, the title to open it, hold a row to focus on it. */
export function TaskCard() {
  const t = useTasks(WORK_QUERY);
  const ticks = usePendingTicks(t.complete);
  const focusStatus = useFocusStore((s) => s.state.status);
  const canFocus = focusStatus === 'idle' || focusStatus === 'finished';
  const rows = visibleRows(t.tasks, t.hidden);
  const stale = t.status === 'error' && t.lastOk !== null ? updatedText(t.lastOk, t.now) : null;
  const more = t.remaining ? `${t.remaining} more can wait` : null;

  let body;
  if (t.status === 'unconfigured') {
    body = <div className="s">Not set up</div>;
  } else if (t.status === 'loading') {
    body = <div className="s">Loading tasks</div>;
  } else if (t.status === 'error' && t.lastOk === null) {
    body = <div className="s">Tasks unavailable</div>;
  } else if (rows.length === 0) {
    body = <div className="s">Nothing due</div>;
  } else {
    body = (
      <ul className="tasks-list">
        {rows.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            mark={t.marks[task.id]}
            pending={ticks.pending.has(task.id)}
            canFocus={canFocus}
            onDone={() => (t.marks[task.id] === 'failed' ? t.complete(task.id) : ticks.tick(task.id))}
            onUndo={() => ticks.undo(task.id)}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="tasks" aria-label="Tasks">
      <div className="row sb tasks-hd">
        <span className="k">Next three</span>
        {(stale || more) && <span className="xs">{stale ?? more}</span>}
      </div>
      {body}
    </section>
  );
}
