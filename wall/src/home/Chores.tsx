import { IconCheck } from '@tabler/icons-react';
import { reviewNow } from '../ui/reviewClock';
import { openTask, type TaskItem } from '../tasks/model';
import { clockText } from './sunLine';
import { useChores } from './useChores';

const EST: Record<string, string> = { '15': '15 m', '30': '30 m', '45': '45 m', '60plus': '1 h+' };

/** The small pill on a chore: its time when it is due later today at a set time, else its estimate. */
export function chorePill(task: Pick<TaskItem, 'due_at' | 'due_is_all_day' | 'est'>, now: number): string | null {
  if (task.due_at && !task.due_is_all_day && !/^\d{4}-\d{2}-\d{2}$/.test(task.due_at)) {
    const at = Date.parse(task.due_at);
    const today = new Date(now);
    const d = new Date(at);
    if (
      !Number.isNaN(at) &&
      at >= now &&
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    ) {
      return clockText(at).replace(':00 ', ' ');
    }
  }
  return task.est ? (EST[task.est] ?? null) : null;
}

/**
 * Around the house: the next three tasks tagged `home`, with "N more can wait". The tick
 * circle finishes a chore; a click on its title opens it in the task app.
 */
export function Chores() {
  const { status, tasks, remaining, marks, hidden, complete } = useChores();
  const now = reviewNow ? reviewNow() : Date.now();
  const rows = tasks.filter((t) => !hidden.has(t.id));
  // A failed refresh after a good read keeps the rows, dimmed, with a quiet sign by the heading.
  const stale = status === 'error' && tasks.length > 0;
  let body;
  if (status === 'unconfigured') {
    body = <div className="s">Not set up</div>;
  } else if (status === 'loading') {
    body = <div className="s">Loading</div>;
  } else if (status === 'error' && tasks.length === 0) {
    body = <div className="s warn-text">Task app not reachable</div>;
  } else if (rows.length === 0 && tasks.length > 0) {
    // Every shown chore is ticked: the next ones arrive with the refresh.
    body = <div className="s">{stale ? 'Could not load the next ones' : 'Loading the next ones'}</div>;
  } else if (rows.length === 0) {
    body = (
      <div className="tk3 clear">
        <IconCheck size={28} stroke={2} aria-hidden="true" />
        <span className="n">Nothing waiting around the house</span>
      </div>
    );
  } else {
    body = (
      <div className={stale ? 'chore-rows stale' : 'chore-rows'}>
        {rows.map((t) => {
          const mark = marks[t.id];
          const pill = chorePill(t, now);
          return (
            <div key={t.id} className={mark ? `tk3 ${mark}` : 'tk3'}>
              <button
                type="button"
                className="ck"
                aria-label={`Done: ${t.title}`}
                disabled={mark === 'done'}
                onClick={() => complete(t.id)}
              >
                <span className="ck-ring" aria-hidden="true">
                  {mark === 'done' && <IconCheck size={20} stroke={2.4} />}
                </span>
              </button>
              <button type="button" className="n chore-open" title={t.title} aria-label={`Open ${t.title}`} onClick={() => openTask(t.id)}>
                {t.title}
              </button>
              {mark === 'failed' ? <span className="xs warn-text">not saved</span> : pill && <span className="est">{pill}</span>}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <section className="chores" aria-label="Around the house">
      <div className="chores-head">
        <span className="k">Around the house</span>
        <span className="chores-side">
          {stale && <span className="xs warn-text">Task app not reachable</span>}
          {remaining > 0 && status !== 'unconfigured' && <span className={stale ? 'xs stale' : 'xs'}>{remaining} more can wait</span>}
        </span>
      </div>
      {body}
    </section>
  );
}
