import { CONTEXT_TOPICS, EVENT_TOPICS, LINES, type Topic } from './lines';

/** How chatty Watt is: never, now and then (the default), or a little more often. */
export type Chatty = 'off' | 'sometimes' | 'chatty';
export const CHATTY_LEVELS: readonly Chatty[] = ['off', 'sometimes', 'chatty'];

/** Shortest gap between two bubbles, per level (milliseconds). Off never speaks. */
export const GAP_MS: Readonly<Record<Chatty, number>> = { off: Infinity, sometimes: 6 * 60_000, chatty: 3 * 60_000 };

/** How long a bubble stays up, milliseconds (it fades in and out inside this). */
export const BUBBLE_MS = 7000;
/** No bubble in the first minute of a focus session. */
export const FOCUS_QUIET_MS = 60_000;
/** An event is fresh, and wins the next bubble, for this long after it happened. */
export const FRESH_MS = 3 * 60_000;
/** With nothing fresh, the chance per check (every `CHECK_MS`) that she says something anyway. */
export const IDLE_CHANCE = 0.2;
export const CHECK_MS = 30_000;

/** What stops a bubble right now, whatever the clock says. */
export interface Quiet {
  chatty: Chatty;
  /** In a call (or a meeting in progress). */
  inCall: boolean;
  /** The display is idle, off or locked. */
  idle: boolean;
  /** Asleep for the night, away from the place, or the page is hidden. */
  away: boolean;
  /** When the running focus session started (epoch ms), or null. */
  focusSince: number | null;
  /** The wall is recording: he sits quietly (`isQuietForRecording`). */
  recording?: boolean;
  /** At the drive-in for a show: no speech bubble while he watches. */
  watching?: boolean;
}

/** The scheduler's memory. Changed in place by `markSpoken`. */
export interface ChatState {
  /** When the last bubble went up (epoch ms), or -Infinity. */
  lastAt: number;
  /** The last line said, so it is never said twice in a row. */
  lastLine: string | null;
}

export function createChat(): ChatState {
  return { lastAt: -Infinity, lastLine: null };
}

/** True when nothing but the rate limit stands in the way. */
export function quietNow(q: Quiet, now: number): boolean {
  return (
    q.chatty === 'off' || q.inCall || q.idle || q.away || q.recording === true || q.watching === true || (q.focusSince !== null && now - q.focusSince < FOCUS_QUIET_MS)
  );
}

/**
 * True when a bubble may go up at `now`: not quiet, and the level's gap has passed since the last
 * one. A last bubble in the future (the clock stepped back) is brought back to now, so she waits
 * one gap rather than until the clock catches up.
 */
export function maySpeak(st: ChatState, q: Quiet, now: number): boolean {
  if (st.lastAt > now) st.lastAt = now;
  return !quietNow(q, now) && now - st.lastAt >= GAP_MS[q.chatty];
}

export function markSpoken(st: ChatState, line: string, now: number): ChatState {
  st.lastAt = now;
  st.lastLine = line;
  return st;
}

/** What Watt could talk about: events with the time they happened, and what is true now. */
export interface Talk {
  /** Event topics and when each happened (epoch ms). Only fresh ones count. */
  events: Partial<Record<Topic, number>>;
  /** Context topics true right now. */
  context: readonly Topic[];
  /** Plain thought topics (her mood picks which: `sheep` plus `happy`, `sleepy` or `curious`). */
  thoughts: readonly Topic[];
}

/** The freshest event topic in `talk` at `now`, by the order of `EVENT_TOPICS` for ties, or null. */
export function freshEvent(talk: Talk, now: number): Topic | null {
  let best: Topic | null = null;
  let bestAt = -Infinity;
  for (const t of EVENT_TOPICS) {
    const at = talk.events[t];
    if (at === undefined || now - at > FRESH_MS || now < at) continue;
    if (at > bestAt) {
      best = t;
      bestAt = at;
    }
  }
  return best;
}

/** A random line from `topic` that is not `avoid`. */
export function lineFrom(topic: Topic, avoid: string | null, rnd: () => number): string {
  const pool = LINES[topic];
  const choices = pool.length > 1 ? pool.filter((l) => l !== avoid) : pool;
  return choices[Math.floor(rnd() * choices.length) % choices.length];
}

/**
 * The line and topic Watt says next. A fresh event always wins. Otherwise context (what is true
 * now) wins over plain thoughts two times in three, and a plain thought is used only when there
 * is no context. Never `avoid` (the last line).
 */
export function pickLine(talk: Talk, now: number, avoid: string | null, rnd: () => number = Math.random): { topic: Topic; line: string } {
  const ev = freshEvent(talk, now);
  if (ev) return { topic: ev, line: lineFrom(ev, avoid, rnd) };
  const context = talk.context.filter((t) => CONTEXT_TOPICS.includes(t));
  const thoughts = talk.thoughts.length ? talk.thoughts : (['sheep'] as const);
  const useContext = context.length > 0 && rnd() < 2 / 3;
  const pool = useContext ? context : thoughts;
  const topic = pool[Math.floor(rnd() * pool.length) % pool.length];
  return { topic, line: lineFrom(topic, avoid, rnd) };
}

/**
 * One check of the scheduler at `now` (call it every `CHECK_MS` and whenever an event happens):
 * the line to show, or null. Speaks only when `maySpeak`; then always for a fresh event, and
 * otherwise with `IDLE_CHANCE`. Records what it said in `st`.
 */
export function nextBubble(st: ChatState, q: Quiet, talk: Talk, now: number, rnd: () => number = Math.random): { topic: Topic; line: string } | null {
  if (!maySpeak(st, q, now)) return null;
  // A fresh event is spoken only once: one that is older than the last bubble was already used.
  const ev = freshEvent(talk, now);
  const fresh = ev !== null && (talk.events[ev] as number) > st.lastAt;
  if (!fresh && rnd() >= IDLE_CHANCE) return null;
  const pick = fresh ? { topic: ev as Topic, line: lineFrom(ev as Topic, st.lastLine, rnd) } : pickLine({ ...talk, events: {} }, now, st.lastLine, rnd);
  markSpoken(st, pick.line, now);
  return pick;
}
