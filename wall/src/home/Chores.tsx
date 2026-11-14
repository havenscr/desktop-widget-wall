import { IconCheck } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { reviewNow } from '../ui/reviewClock';
import { openTask, type TaskItem } from '../tasks/model';
import { usePendingTicks } from '../tasks/pendingTick';
import { TickWait } from '../tasks/TaskCard';
import { clockText } from './sunLine';
import { useShield } from './NetworkTile';
import { alertsOpen } from './shieldModel';
import { useChores } from './useChores';

/** Rows in view: five, or three while the network card is tall with open alerts. */
export const ROWS_QUIET = 5;
export const ROWS_ALERTS = 3;

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
 * Around the house: the next tasks tagged `home`, five rows in view (three while network
 * alerts are open and the shield card is tall), the rest a scroll away (a slim scrollbar
 * and the wheel, with the pointer over the list), and "N more can wait" under them. The
 * tick circle finishes a chore after a five second undo window; a click on its title opens
 * it in the task app.
 */
export function Chores() {
  const { status, tasks, remaining, marks, hidden, complete } = useChores();
  const fit = alertsOpen(useShield()) ? ROWS_ALERTS : ROWS_QUIET;
  const ticks = usePendingTicks(complete);
  const now = reviewNow ? reviewNow() : Date.now();
  const rows = tasks.filter((t) => !hidden.has(t.id));
  // A failed refresh after a good read keeps the rows, dimmed, with a quiet sign by the heading.
  const stale = status === 'error' && tasks.length > 0;
  // Out of view: the rows below the fold, and those past the twenty read.
  const more = Math.max(0, rows.length - fit) + remaining;
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
      <div className={[`chore-rows fit${fit}`, stale ? 'stale' : '', rows.length > fit ? 'scrolls' : ''].filter(Boolean).join(' ')}>
        {rows.map((t) => {
          const mark = marks[t.id];
          const pending = ticks.pending.has(t.id);
          const ticked = mark === 'done' || pending;
          const pill = chorePill(t, now);
          const cls = pending ? 'tk3 done pending' : mark ? `tk3 ${mark}` : 'tk3';
          return (
            <div key={t.id} className={cls}>
              <button
                type="button"
                className="ck"
                aria-label={`Done: ${t.title}`}
                disabled={ticked}
                onClick={() => (mark === 'failed' ? complete(t.id) : ticks.tick(t.id))}
              >
                <span className="ck-ring" aria-hidden="true">
                  {ticked && <IconCheck size={20} stroke={2.4} />}
                </span>
              </button>
              {pending ? (
                <TickWait title={t.title} onUndo={() => ticks.undo(t.id)} />
              ) : (
                <>
                  <button type="button" className="n chore-open" title={t.title} aria-label={`Open ${t.title}`} onClick={() => openTask(t.id)}>
                    {t.title}
                  </button>
                  {mark === 'failed' ? (
                    <>
                      <span className="xs warn-text">Could not complete.</span>
                      <button type="button" className="tick-act" onClick={() => complete(t.id)} title={`Try completing ${t.title} again`}>
                        Retry
                      </button>
                    </>
                  ) : (
                    pill && <span className="est">{pill}</span>
                  )}
                </>
              )}
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
        </span>
      </div>
      {body}
      {more > 0 && status !== 'unconfigured' && (
        <div className={stale ? 'chores-foot xs stale' : 'chores-foot xs'} {...tip(rows.length > fit ? `${rows.length + remaining} in all. The wheel scrolls the list.` : `${rows.length + remaining} in all, the rest in the task app`)}>
          {more} more can wait
        </div>
      )}
    </section>
  );
}
