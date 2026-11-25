/**
 * On Air: the pure parts. The show timer's arithmetic and its saved form, the run of show's
 * answer from Rust, a part's planned time against the time spent in it, and the fixed lines for
 * every refusal. No clock is read here; every function takes `now`.
 */

/** One part of the run of show, as Rust parsed it from `run-of-show.txt`. */
export interface Part {
  name: string;
  minutes: number | null;
  notes: string[];
}

/** `wall2_onair_show`: the file parsed (never its own text). */
export interface Show {
  state: 'ok' | 'missing' | 'refused';
  title: string | null;
  parts: Part[];
  skipped: number;
  reason: string | null;
  readAt: number;
}

/** `wall2_onair_mark` and `wall2_onair_marks_today`: today's count and the last show times. */
export interface MarkResult {
  today: number;
  last: string[];
  /** The part of each of those marks, in the same order, as Rust cut them; an empty text for a mark with no part. Missing in an answer from an older native side. */
  lastParts?: string[];
}

/** The show timer and the current part, as kept in local storage (`wall2-onair`). */
export interface Saved {
  running: boolean;
  /** When the running stretch began (epoch ms); null while stopped. */
  startedAt: number | null;
  /** Show time banked by earlier stretches. */
  accumulatedMs: number;
  /** When the timer was first started since the last reset (for "Started 9:42 AM"); null before. */
  firstStartAt: number | null;
  /** When it was last stopped; null while running or before a start. */
  stoppedAt: number | null;
}

export const STORAGE_KEY = 'wall2-onair';
/** The longest show time the wall keeps (Rust refuses a mark past it too). */
export const MAX_SHOW_MS = 24 * 60 * 60 * 1000;
/** The run of show is never read again sooner than this. */
export const READ_FLOOR_MS = 5000;
/** A second Mark within this time counts once. */
export const MARK_QUIET_MS = 1000;
/** Reset waits this long for its second click. */
export const RESET_CONFIRM_MS = 3000;

export const IDLE: Saved = { running: false, startedAt: null, accumulatedMs: 0, firstStartAt: null, stoppedAt: null };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const time = (v: unknown, now: number): number | null => (num(v) && v > 0 && v <= now + 60_000 ? v : null);
/** A clock that stepped back by up to this much does not make a running start invalid. */
export const START_TOLERANCE_MS = 2000;
/** A running start: not in the future (past a couple of seconds of clock jitter). */
const startTime = (v: unknown, now: number): number | null => (num(v) && v > 0 && v <= now + START_TOLERANCE_MS ? v : null);

/** True once the timer has stopped itself at 24 hours (until Reset). */
export const atLimit = (s: Pick<Saved, 'running' | 'accumulatedMs'>): boolean => !s.running && s.accumulatedMs >= MAX_SHOW_MS;

/** The stopped state of a timer that reached 24 hours at `reachedAt`. */
export function stoppedAtLimit(s: Saved, reachedAt: number): Saved {
  return { ...s, running: false, startedAt: null, accumulatedMs: MAX_SHOW_MS, stoppedAt: reachedAt };
}

/**
 * The saved form, checked field by field: anything missing, of the wrong type, a running start
 * in the future or past the limits makes the whole thing idle (never a half-trusted timer); the part fields older versions stored are ignored. A
 * running timer that has run past 24 hours since it was stored comes back as the stopped state.
 */
export function parseSaved(raw: string | null, now: number): Saved {
  if (!raw) return IDLE;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return IDLE;
  }
  if (!v || typeof v !== 'object') return IDLE;
  const running = v.running === true;
  const startedAt = startTime(v.startedAt, now);
  const acc = v.accumulatedMs;
  if (typeof v.running !== 'boolean' || !num(acc) || acc < 0 || acc > MAX_SHOW_MS) return IDLE;
  if (running !== (startedAt !== null)) return IDLE;
  const saved: Saved = {
    running,
    startedAt,
    accumulatedMs: acc,
    firstStartAt: time(v.firstStartAt, now),
    stoppedAt: running ? null : time(v.stoppedAt, now),
  };
  if (saved.startedAt !== null && saved.accumulatedMs + Math.max(0, now - saved.startedAt) >= MAX_SHOW_MS) {
    return stoppedAtLimit(saved, saved.startedAt + (MAX_SHOW_MS - saved.accumulatedMs));
  }
  return saved;
}

/** The show time now: banked time plus the running stretch, never past the limit. */
export function elapsedMs(s: Pick<Saved, 'running' | 'startedAt' | 'accumulatedMs'>, now: number): number {
  const run = s.running && s.startedAt !== null ? Math.max(0, now - s.startedAt) : 0;
  return Math.min(MAX_SHOW_MS, s.accumulatedMs + run);
}

/** `mm:ss` up to 59:59, then `h:mm:ss`. */
export function formatShowTime(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The local calendar date of a time, `YYYY-MM-DD`. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Milliseconds from `ms` to the next local midnight (the day after `ms`'s local date begins). */
export function untilMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - ms;
}

/** A clock time as the wall writes it: `9:42 AM`. */
export function clockText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** The line under the timer: when and how it started, and that no stream service is connected. */
export function startedLine(s: Saved, now: number): string {
  const tail = 'No stream service connected.';
  if (atLimit(s)) return 'Stopped at 24 hours. Reset to start again.';
  if (s.firstStartAt === null && elapsedMs(s, now) === 0) return `Not started. Start it when the show begins. ${tail}`;
  const started = s.firstStartAt !== null ? `Started ${clockText(s.firstStartAt)} by hand` : 'Started by hand';
  if (!s.running && s.stoppedAt !== null) return `${started}, stopped at ${clockText(s.stoppedAt)}. ${tail}`;
  return `${started}. ${tail}`;
}

/** The fixed word Rust answered with, from an invoke error. */
export function errorWord(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : '';
}

/** A run-of-show read that failed, in one line. */
export function showErrorText(e: unknown): string {
  return errorWord(e) === 'not-configured' ? 'No config folder on this PC' : 'Could not read run-of-show.txt';
}

/** A mark that was refused or failed, in one line. */
export function markErrorText(e: unknown): string {
  switch (errorWord(e)) {
    case 'refused':
      return 'marks.txt is full; move it aside';
    case 'not-configured':
      return 'No config folder on this PC';
    default:
      return 'Could not write marks.txt';
  }
}

/** An Open file that failed, in one line. */
export function openErrorText(e: unknown, which: 'show' | 'marks'): string {
  const name = which === 'show' ? 'run-of-show.txt' : 'marks.txt';
  return errorWord(e) === 'not-configured' ? 'No config folder on this PC' : `Could not open ${name}`;
}

/** The line under "Mark a moment". */
export function markLine(m: MarkResult | null): string {
  if (!m) return 'Saved to marks.txt';
  if (m.today === 0) return 'None yet today. Saved to marks.txt';
  const last = m.last.length ? `: ${m.last.join(', ')}` : '';
  return `${m.today} marked${last}. Saved to marks.txt`;
}

/** A Show answer checked before use (a broken answer is treated as a failed read). */
export function isShow(v: unknown): v is Show {
  if (!v || typeof v !== 'object') return false;
  const s = v as Show;
  return (
    (s.state === 'ok' || s.state === 'missing' || s.state === 'refused') &&
    Array.isArray(s.parts) &&
    s.parts.every((p) => p && typeof p.name === 'string' && Array.isArray(p.notes) && (p.minutes === null || typeof p.minutes === 'number'))
  );
}

/** A MarkResult answer checked before use. */
export function isMarkResult(v: unknown): v is MarkResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as MarkResult;
  return typeof r.today === 'number' && Array.isArray(r.last) && (r.lastParts === undefined || (Array.isArray(r.lastParts) && r.lastParts.every((p) => typeof p === 'string')));
}
