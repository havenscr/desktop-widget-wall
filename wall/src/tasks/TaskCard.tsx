import { IconCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useFocusStore } from '../focus/store';
import { estText, LONG_PRESS_MS, updatedText, visibleRows, type TaskItem } from './model';
import { useTasks, type TasksQuery } from './useTasks';

/** Work's list: the tasks without the home tag. */
const WORK_QUERY: TasksQuery = { notTag: 'home' };

/**
 * One task as the concept draws it (`.tk3`): a check circle, the title and the estimate.
 * Holding the row for half a second starts a focus session named after the task.
 */
function TaskRow({
  task,
  mark,
  canFocus,
  onDone,
}: {
  task: TaskItem;
  mark: 'done' | 'failed' | undefined;
  canFocus: boolean;
  onDone: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const focusable = canFocus && mark !== 'done';
  const startFocus = () => useFocusStore.getState().startLabeled(task.title);
  const est = estText(task.est);

  return (
    <li className={`tk3 task-row${mark === 'done' ? ' done' : ''}${holding ? ' holding' : ''}`}>
      <button
        type="button"
        className={`task-check${mark === 'done' ? ' on' : ''}`}
        aria-label={`Mark done: ${task.title}`}
        disabled={mark === 'done'}
        onClick={onDone}
      >
        <i className="ck" aria-hidden="true">
          {mark === 'done' && <IconCheck size={20} stroke={3} />}
        </i>
      </button>
      <button
        type="button"
        className="tk-main"
        aria-label={`Hold to focus on: ${task.title}`}
        aria-disabled={!focusable}
        onPointerDown={() => {
          if (!focusable) return;
          stop();
          setHolding(true);
          timer.current = setTimeout(() => {
            timer.current = undefined;
            setHolding(false);
            startFocus();
          }, LONG_PRESS_MS);
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
        {mark === 'failed' ? <span className="xs task-err">Could not save</span> : est && <span className="est">{est}</span>}
      </button>
    </li>
  );
}

/** The next three open tasks without the home tag: tap the circle to finish one, hold a row to focus on it. */
export function TaskCard() {
  const t = useTasks(WORK_QUERY);
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
          <TaskRow key={task.id} task={task} mark={t.marks[task.id]} canFocus={canFocus} onDone={() => t.complete(task.id)} />
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
