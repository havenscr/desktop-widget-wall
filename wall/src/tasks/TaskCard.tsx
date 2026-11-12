import { IconCheck, IconTarget } from '@tabler/icons-react';
import { useFocusStore } from '../focus/store';
import { dueLine, updatedText, visibleRows } from './model';
import { useTasks } from './useTasks';

/** The next three open tasks: tap the circle to finish one, "Focus" to start a session named after it. */
export function TaskCard() {
  const t = useTasks();
  const focusStatus = useFocusStore((s) => s.state.status);
  const canFocus = focusStatus === 'idle' || focusStatus === 'finished';
  const rows = visibleRows(t.tasks, t.hidden);
  const stale = t.status === 'error' && t.lastOk !== null ? updatedText(t.lastOk, t.now) : null;
  const today = new Date(t.now);

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
        {rows.map((task) => {
          const mark = t.marks[task.id];
          const due = dueLine(task, today);
          return (
            <li key={task.id} className={`task-row${mark === 'done' ? ' done' : ''}`}>
              <button
                type="button"
                className={`rd task-check${mark === 'done' ? ' on' : ''}`}
                aria-label={`Mark done: ${task.title}`}
                disabled={mark === 'done'}
                onClick={() => t.complete(task.id)}
              >
                {mark === 'done' && <IconCheck size={36} aria-hidden="true" />}
              </button>
              <div className="task-text">
                <div className="b6 ellipsis task-title">{task.title}</div>
                {mark === 'failed' ? (
                  <div className="xs task-err">Could not save</div>
                ) : (
                  due && <div className="xs ellipsis">{due}</div>
                )}
              </div>
              <button
                type="button"
                className="btn task-focus"
                disabled={!canFocus || mark === 'done'}
                onClick={() => useFocusStore.getState().startLabeled(task.title)}
              >
                <IconTarget size={26} aria-hidden="true" />
                Focus
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="panel tasks" aria-label="Tasks">
      <div className="row sb">
        <span className="k">Next three</span>
        {stale && <span className="xs">{stale}</span>}
      </div>
      {body}
    </section>
  );
}
