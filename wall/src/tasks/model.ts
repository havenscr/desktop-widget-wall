export interface TaskItem {
  id: string;
  title: string;
  due_at: string | null;
  due_is_all_day: boolean;
  quadrant: string | null;
  /** Effort estimate in minutes: '15', '30', '45' or '60plus'. */
  est?: '15' | '30' | '45' | '60plus' | null;
}

/** The error text the native side sends when `feeds.json` has no address for the service. */
export const NOT_CONFIGURED = 'not-configured';

export const REFRESH_MS = 120_000;
export const FADE_MS = 2000;
/** Holding a task row this long starts focus on it. */
export const LONG_PRESS_MS = 500;
/** A finger that moves further than this from where it went down cancels the hold. */
export const HOLD_SLOP_PX = 12;

/** The estimate chip: "15 m", "45 m", "60+ m", or null when there is no estimate. */
export function estText(est: TaskItem['est']): string | null {
  if (est === '15' || est === '30' || est === '45') return `${est} m`;
  if (est === '60plus') return '60+ m';
  return null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 3 PM, or 3:30 PM. */
function clockText(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** An all-day date is a calendar date: read its year, month and day as local, ignoring any time part. */
function allDayDate(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * The small due line under a task title: "today 3 PM", "today", "tomorrow",
 * "Fri" (within the next six days), "Nov 20" (later), "overdue", or null.
 */
export function dueLine(task: Pick<TaskItem, 'due_at' | 'due_is_all_day'>, now: Date): string | null {
  if (!task.due_at) return null;
  // A bare date (no time) is a calendar date, read as local, never shifted by time zone.
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(task.due_at);
  const dateOnly = task.due_is_all_day || bare;
  const when = dateOnly ? allDayDate(task.due_at) : new Date(task.due_at);
  if (!when || Number.isNaN(when.getTime())) return null;
  const days = Math.round((startOfDay(when) - startOfDay(now)) / DAY_MS);
  if (days < 0) return 'overdue';
  if (days === 0) return dateOnly ? 'today' : `today ${clockText(when)}`;
  if (days === 1) return 'tomorrow';
  if (days <= 6) return DAYS[when.getDay()] ?? null;
  return `${MONTHS[when.getMonth()]} ${when.getDate()}`;
}

/** Small text for a list that could not be refreshed; null while it is recent. */
export function updatedText(lastOk: number | null, now: number): string | null {
  if (lastOk === null) return null;
  const mins = Math.max(1, Math.floor((now - lastOk) / 60_000));
  if (mins < 60) return `updated ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? 'updated 1 hour ago' : `updated ${hrs} hours ago`;
}

export type RowMark = 'done' | 'failed' | undefined;

/** Rows to show: the server list minus rows that have faded out. */
export function visibleRows(tasks: TaskItem[], hidden: ReadonlySet<string>): TaskItem[] {
  return tasks.filter((t) => !hidden.has(t.id));
}
