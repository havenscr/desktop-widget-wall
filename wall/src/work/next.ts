import type { Meeting } from '../meet/model';

const MIN = 60_000;

/** 12:00 or 9:30, as the concept writes the Next time (no AM or PM). */
export function shortClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 36 m, or 1 h 36 m. */
function span(mins: number): string {
  if (mins < 60) return `${mins} m`;
  return `${Math.floor(mins / 60)} h ${mins % 60} m`;
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/**
 * The line under the Next title: "12:00, in 1 h 36 m", "now, 12 m left" once it has
 * started, or "tomorrow 9:30" for a meeting on a later day.
 */
export function nextLine(m: Pick<Meeting, 'start' | 'end'>, now: number): string {
  const start = Date.parse(m.start);
  const end = Date.parse(m.end);
  if (start <= now) return `now, ${span(Math.max(1, Math.ceil((end - now) / MIN)))} left`;
  if (!sameDay(start, now)) return `tomorrow ${shortClock(start)}`;
  return `${shortClock(start)}, in ${span(Math.max(1, Math.ceil((start - now) / MIN)))}`;
}
