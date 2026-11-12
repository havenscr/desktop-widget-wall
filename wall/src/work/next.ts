import type { Meeting } from '../meet/model';

const MIN = 60_000;

/** 12:00 or 9:30, as the concept writes the Next time (no AM or PM). */
export function shortClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 36 m, 1 h, or 1 h 36 m. */
function span(mins: number): string {
  if (mins < 60) return `${mins} m`;
  const h = Math.floor(mins / 60);
  return mins % 60 === 0 ? `${h} h` : `${h} h ${mins % 60} m`;
}

/** Whole local days from `a` to `b` (0 on the same day). */
function daysApart(a: number, b: number): number {
  const x = new Date(a);
  const y = new Date(b);
  const ax = new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const by = new Date(y.getFullYear(), y.getMonth(), y.getDate()).getTime();
  return Math.round((by - ax) / 86_400_000);
}

/**
 * The line under the Next title: "12:00, in 1 h 36 m", "now, 12 m left" once it has
 * started, "tomorrow 9:30" for a meeting tomorrow, or "Friday 9:30" further out.
 *
 * A `stale` list may be wrong about the meeting, so the line drops every countdown and
 * keeps only the times: "12:00", or "10:00 to 10:36" once it has started.
 */
export function nextLine(m: Pick<Meeting, 'start' | 'end'>, now: number, stale = false): string {
  const start = Date.parse(m.start);
  const end = Date.parse(m.end);
  if (start <= now) {
    return stale ? `${shortClock(start)} to ${shortClock(end)}` : `now, ${span(Math.max(1, Math.ceil((end - now) / MIN)))} left`;
  }
  const days = daysApart(now, start);
  if (days === 1) return `tomorrow ${shortClock(start)}`;
  if (days > 1) return `${WEEKDAYS[new Date(start).getDay()]} ${shortClock(start)}`;
  if (stale) return shortClock(start);
  return `${shortClock(start)}, in ${span(Math.max(1, Math.ceil((start - now) / MIN)))}`;
}
