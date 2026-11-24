import { cards, laneWorks, type OmniSummary } from '../agents/model';

/** The default breath: 4 s in, 2 s hold, 6 s out. */
export const CYCLE_SECONDS = 12;
export const SESSION_MINUTES = [3, 5, 10] as const;
export type SessionMinutes = (typeof SESSION_MINUTES)[number];

const WORDS = ['Breathe in', 'Hold', 'Breathe out', 'Hold'] as const;
export const SCALE_MIN = 0.8;
export const SCALE_SPAN = 0.26;

/** A breathing pattern: seconds in, hold, out, hold (a zero phase is skipped). */
export interface BreathPattern {
  id: string;
  label: string;
  phases: readonly [number, number, number, number];
  tip: string;
}
export const BREATH_PATTERNS: ReadonlyArray<BreathPattern> = [
  { id: 'calm', label: 'Calm 4-2-6', phases: [4, 2, 6, 0], tip: 'In for 4, hold 2, out for 6. A long, slow out-breath' },
  { id: 'box', label: 'Box 4-4-4-4', phases: [4, 4, 4, 4], tip: 'In, hold, out, hold, 4 seconds each' },
  { id: 'relax', label: '4-7-8', phases: [4, 7, 8, 0], tip: 'In for 4, hold 7, out for 8' },
  { id: 'even', label: 'Even 5-5', phases: [5, 0, 5, 0], tip: 'In for 5, out for 5, no hold' },
];
export const DEFAULT_PATTERN: BreathPattern = BREATH_PATTERNS[0];

export function patternById(id: unknown): BreathPattern {
  return BREATH_PATTERNS.find((p) => p.id === id) ?? DEFAULT_PATTERN;
}

/** Seconds in one full breath of the pattern. */
export function patternSeconds(p: BreathPattern): number {
  return p.phases.reduce((a, b) => a + b, 0);
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Working parents and standalone sessions, from the same full card list as Work. */
export function dreamWorkingCount(summary: Pick<OmniSummary, 'lanes' | 'sessionsList'>): number {
  return cards(summary).filter(laneWorks).length;
}

const COUNT_WORDS: Record<number, string> = { 3: 'THREE', 5: 'FIVE', 10: 'TEN' };
/** "FIVE MINUTES OF ZEN" */
export function sessionLabel(minutes: number): string {
  return `${COUNT_WORDS[minutes] ?? String(minutes)} MINUTES OF ZEN`;
}

/** Quadrants that are not urgent (important only, neither). Hotfix and admin are urgent. */
const NOT_URGENT = new Set(['feature', 'neither']);

/**
 * The lines under "After this": null when nothing waits. The urgency line appears only for a list shorter
 * than the feed limit, when every task carries a quadrant and none is urgent; a missing quadrant says nothing.
 */
/** The task feed returns at most this many open tasks (`TASK_LIMIT` in `wall2_feeds.rs`), so a full list means "or more". */
export const TASK_FEED_LIMIT = 3;

export function waitingLines(tasks: ReadonlyArray<{ quadrant: string | null }>): { count: string; urgent: string | null } | null {
  const n = tasks.length;
  if (n === 0) return null;
  // A full list may be cut off by the feed: say "or more" and make no claim about urgency.
  if (n >= TASK_FEED_LIMIT) return { count: `After this: ${n} or more things are waiting.`, urgent: null };
  const q = tasks.map((t) => (t.quadrant ?? '').toLowerCase());
  const none = q.every((x) => NOT_URGENT.has(x));
  const urgent = !none ? null : n === 1 ? 'It is not urgent.' : 'Neither is urgent.';
  return { count: `After this: ${n} ${n === 1 ? 'thing is' : 'things are'} waiting.`, urgent };
}

/** The remembered breath pattern is saved under this key (the key kept from the activity picker, so a saved pattern survives). */
export const PATTERN_KEY = 'wall2-zen-activity';

/** The remembered breath pattern. Anything unreadable gives the calm pattern. */
export function loadPattern(): BreathPattern {
  try {
    const o = JSON.parse(localStorage.getItem(PATTERN_KEY) ?? '{}') as { pattern?: unknown };
    return patternById(o.pattern);
  } catch {
    return DEFAULT_PATTERN;
  }
}

export function savePattern(pattern: BreathPattern): void {
  try {
    localStorage.setItem(PATTERN_KEY, JSON.stringify({ pattern: pattern.id }));
  } catch {
    // Storage blocked: the choice is simply not remembered.
  }
}

/** Cubic ease in and out, 0 to 1. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface Breath {
  /** 0 in, 1 hold (full), 2 out, 3 hold (empty). */
  phase: 0 | 1 | 2 | 3;
  word: (typeof WORDS)[number];
  /** Whole seconds left in the phase. */
  left: number;
  /** Circle scale, 0.8 (empty) to 1.06 (full). */
  scale: number;
}

/** The breathing guide `seconds` into the guide's run, for a pattern (default: calm 4-2-6). Zero-length phases are skipped. */
export function breathAt(seconds: number, pattern: BreathPattern = DEFAULT_PATTERN): Breath {
  const total = patternSeconds(pattern);
  const c = ((Math.max(0, seconds) % total) + total) % total;
  let start = 0;
  let phase = 0;
  for (let i = 0; i < 4; i++) {
    const len = pattern.phases[i];
    if (len > 0 && c < start + len) {
      phase = i;
      break;
    }
    start += len;
  }
  const len = pattern.phases[phase];
  const into = c - start;
  const k = phase === 0 ? ease(into / len) : phase === 1 ? 1 : phase === 2 ? 1 - ease(into / len) : 0;
  return { phase: phase as Breath['phase'], word: WORDS[phase], left: Math.ceil(len - into), scale: SCALE_MIN + SCALE_SPAN * k };
}

/** Whole seconds left in a session that started at `startMs`, never below 0. */
export function sessionSecondsLeft(startMs: number, minutes: number, nowMs: number): number {
  return Math.max(0, Math.ceil((startMs + minutes * 60_000 - nowMs) / 1000));
}

/** "N:NN left" */
export function formatLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
}

/** The early morning hour at which the late-night dimming ends. */
export const DIM_END_HOUR = 6;

/** True from `startHour` (local time) until 6 AM: the hours in which a quiet Zen may dim by itself. */
export function isDimHour(date: Date, startHour: number): boolean {
  const h = date.getHours();
  return h >= startHour || h < DIM_END_HOUR;
}

/** True when Zen should dim by itself: a dim hour, and no input on the wall for `waitMs`. */
export function dimDue(now: Date, lastInputMs: number, startHour: number, waitMs: number): boolean {
  return isDimHour(now, startHour) && now.getTime() - lastInputMs >= waitMs;
}

/** "10 PM" for an hour 0 to 23. */
export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The quiet line on Zen in the evening, from the two settings. */
export function dimHint(startHour: number, waitMinutes: number): string {
  return `Dims by itself after ${hourLabel(startHour)} and ${waitMinutes} quiet minute${waitMinutes === 1 ? '' : 's'}`;
}

/** The hint shows from 6 PM, so the line is there for the hours before the dimming starts. */
export function showDimHint(date: Date): boolean {
  const h = date.getHours();
  return h >= 18 || h < DIM_END_HOUR;
}

/**
 * Dream's quiet status line: how many agents are still working and whether an agent needs the owner
 * (both null when the agents store is stale or off, then neither is said), then the lights mood that
 * is on (null when the home feed does not say). Empty string when there is nothing to say.
 */
export function dreamStatusText(working: number | null, needs: number | null, mood: string | null): string {
  return dreamStatusParts(working, needs, mood)
    .map((p) => p.text)
    .join(' · ');
}

/** The same parts as `dreamStatusText`, each marked: `needs` is the part that says an agent needs the owner (drawn amber). */
export function dreamStatusParts(working: number | null, needs: number | null, mood: string | null): { text: string; needs: boolean }[] {
  const parts: { text: string; needs: boolean }[] = [];
  if (working !== null && working > 0) parts.push({ text: working === 1 ? '1 agent still working' : `${working} agents still working`, needs: false });
  if (needs !== null) parts.push({ text: needs === 0 ? 'No agent needs you' : needs === 1 ? 'An agent needs you' : `${needs} agents need you`, needs: needs > 0 });
  if (mood) parts.push({ text: `Lights: ${mood}`, needs: false });
  return parts;
}

/** Dream's text layer drifts along a closed ellipse 30 px wide and 20 px tall, once round in this long. */
export const DRIFT_PERIOD_MS = 20 * 60_000;
/** Under reduced motion it holds one of four points on that ellipse for this long, then jumps to the next. */
export const DRIFT_STEP_MS = 7.5 * 60_000;
/** How often the layer's offset is set again; the CSS transition fills the gap in between. */
export const DRIFT_TICK_MS = 5_000;
/** Half the width and height of the path, in px. */
export const DRIFT_RX = 15;
export const DRIFT_RY = 10;

const round1 = (n: number) => Math.round(n * 10) / 10 + 0;

/**
 * Where Dream's text layer sits at `ms`, in px from its resting place (a point on the closed
 * path, always within DRIFT_RX and DRIFT_RY). Continuous, one lap per DRIFT_PERIOD_MS; with
 * `stepped` (reduced motion) one of four fixed points, changing every DRIFT_STEP_MS.
 */
export function driftOffset(ms: number, stepped: boolean): { x: number; y: number } {
  const turn = stepped ? Math.floor(ms / DRIFT_STEP_MS) / 4 : ms / DRIFT_PERIOD_MS;
  const a = 2 * Math.PI * (turn - Math.floor(turn));
  return { x: round1(DRIFT_RX * Math.cos(a)), y: round1(DRIFT_RY * Math.sin(a)) };
}

/** The breath as a level, 0 (empty) to 1 (full), `elapsedMs` into a session of the pattern. The same curve the phase word follows. */
export function breathLevel(pattern: BreathPattern, elapsedMs: number): number {
  const b = breathAt(elapsedMs / 1000, pattern);
  return (b.scale - SCALE_MIN) / SCALE_SPAN;
}

/** How long one soft swell of the start screen takes. */
export const IDLE_BREATH_MS = 14_000;

/** The start screen's own slow breath at `ms` (any clock): always moving, between 0.1 and 0.5, so the ridge never sits still. */
export function idleBreathLevel(ms: number): number {
  return 0.3 + 0.2 * Math.sin((2 * Math.PI * ms) / IDLE_BREATH_MS);
}

/** Dream fades the picture to black over this long, then stops drawing it. */
export const DREAM_FADE_MS = 60_000;

/** The picture's share of its light (1 to 0) `sinceMs` after Dream opened. */
export function dreamFade(sinceMs: number): number {
  return Math.min(1, Math.max(0, 1 - sinceMs / DREAM_FADE_MS));
}
