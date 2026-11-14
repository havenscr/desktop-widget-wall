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
  /** The current part's index in the run of show. */
  partIndex: number;
  /** The show time at which the current part became current. */
  partSinceMs: number;
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
export const MAX_PARTS = 40;

export const IDLE: Saved = { running: false, startedAt: null, accumulatedMs: 0, firstStartAt: null, stoppedAt: null, partIndex: 0, partSinceMs: 0 };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const time = (v: unknown, now: number): number | null => (num(v) && v > 0 && v <= now + 60_000 ? v : null);

/**
 * The saved form, checked field by field: anything missing, of the wrong type, in the future or
 * past the limits makes the whole thing idle (never a half-trusted timer).
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
  const startedAt = time(v.startedAt, now);
  const acc = v.accumulatedMs;
  const part = v.partIndex;
  const since = v.partSinceMs;
  if (typeof v.running !== 'boolean' || !num(acc) || acc < 0 || acc > MAX_SHOW_MS) return IDLE;
  if (running !== (startedAt !== null)) return IDLE;
  if (!num(part) || !Number.isInteger(part) || part < 0 || part >= MAX_PARTS) return IDLE;
  if (!num(since) || since < 0 || since > MAX_SHOW_MS) return IDLE;
  const saved: Saved = {
    running,
    startedAt,
    accumulatedMs: acc,
    firstStartAt: time(v.firstStartAt, now),
    stoppedAt: running ? null : time(v.stoppedAt, now),
    partIndex: part,
    partSinceMs: since,
  };
  if (saved.accumulatedMs + (saved.startedAt !== null ? now - saved.startedAt : 0) > MAX_SHOW_MS) return IDLE;
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

/** A clock time as the wall writes it: `9:42 AM`. */
export function clockText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** The line under the timer: when and how it started, and that no stream service is connected. */
export function startedLine(s: Saved, now: number): string {
  const tail = 'No stream service connected.';
  if (s.firstStartAt === null && elapsedMs(s, now) === 0) return `Not started. Start it when the show begins. ${tail}`;
  const started = s.firstStartAt !== null ? `Started ${clockText(s.firstStartAt)} by hand` : 'Started by hand';
  if (!s.running && s.stoppedAt !== null) return `${started}, stopped at ${clockText(s.stoppedAt)}. ${tail}`;
  return `${started}. ${tail}`;
}

/** Whole minutes, rounded up, for "7 min left". */
const minutesUp = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** What a row of the run of show says on its right. */
export interface PartTime {
  text: string;
  /** Past its planned minutes (the current part only). */
  over: boolean;
}

/**
 * The time beside a part: planned minutes for parts done and to come; for the current part the
 * minutes left, or a quiet "N min over" once the time in it passes the plan. A part with no
 * planned minutes says nothing.
 */
export function partTime(part: Part, current: boolean, inPartMs: number): PartTime {
  if (part.minutes === null) return { text: current && inPartMs >= 60_000 ? `${Math.floor(inPartMs / 60_000)} min in` : '', over: false };
  if (!current) return { text: `${part.minutes} min`, over: false };
  const left = part.minutes * 60_000 - inPartMs;
  if (left > 0) return { text: `${minutesUp(left)} min left`, over: false };
  const over = -left;
  return { text: over < 60_000 ? 'on time' : `${Math.floor(over / 60_000)} min over`, over: over >= 60_000 };
}

/** The index held to the parts there are (0 when there are none). */
export function clampIndex(index: number, count: number): number {
  return count <= 0 ? 0 : Math.min(Math.max(0, Math.floor(index)), count - 1);
}

/** "Next: Audience questions, 15 min", or what is true when there is no next part. */
export function nextLine(parts: Part[], index: number): string {
  if (parts.length === 0) return 'No parts yet';
  const next = parts[index + 1];
  if (!next) return 'This is the last part';
  return `Next: ${next.name}${next.minutes !== null ? `, ${next.minutes} min` : ''}`;
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
  return !!v && typeof v === 'object' && typeof (v as MarkResult).today === 'number' && Array.isArray((v as MarkResult).last);
}
