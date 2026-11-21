import { cards, laneWorks, type OmniSummary } from '../agents/model';

/** The default breath: 4 s in, 2 s hold, 6 s out. */
export const CYCLE_SECONDS = 12;
export const SESSION_MINUTES = [3, 5, 10] as const;
export type SessionMinutes = (typeof SESSION_MINUTES)[number];

const WORDS = ['Breathe in', 'Hold', 'Breathe out', 'Hold'] as const;
export const SCALE_MIN = 0.8;
export const SCALE_SPAN = 0.26;

/** The ring is drawn this wide (px) at scale 1; it breathes between SCALE_MIN and SCALE_MIN + SCALE_SPAN of it. */
export const RING_BASE_PX = 370;
/** Fixed text sizes (px) inside the ring. The text never scales with the ring. */
export const WORD_FONT_PX = 28;
export const NUM_FONT_PX = 22;
export const WORD_NUM_GAP_PX = 10;
/** Rough glyph width of the display font, in em, plus its letter spacing. Measured on the longest word. */
export const GLYPH_EM = 0.62;
export const WORD_TRACK_EM = 0.04;
/** The words keep at least this much room to the ring's edge. */
export const RING_PAD_PX = 40;
export const LONGEST_WORD = 'Breathe out';

/** Width (px) of the longest word at the guessed glyph width. */
export function longestWordWidth(): number {
  return LONGEST_WORD.length * WORD_FONT_PX * (GLYPH_EM + WORD_TRACK_EM);
}

/** Smallest ring diameter (px) that keeps the longest word and the number clear of the edge by RING_PAD_PX. */
export function minRingDiameter(): number {
  const w = longestWordWidth();
  const h = WORD_FONT_PX + WORD_NUM_GAP_PX + NUM_FONT_PX;
  return 2 * (Math.hypot(w / 2, h / 2) + RING_PAD_PX);
}

/** Share of today's flame brightness that stays behind the veil (0 to 1). The veil itself is the rest. */
export const ZEN_BRIGHTNESS = 0.45;
export const ZEN_VEIL = 1 - ZEN_BRIGHTNESS;
/** The Candle activity darkens the flames further. */
export const ZEN_VEIL_CANDLE = 0.65;

export type Activity = 'breathe' | 'scan' | 'candle' | 'intention';
export const ACTIVITIES: ReadonlyArray<{ id: Activity; label: string; of: string; tip: string }> = [
  { id: 'breathe', label: 'Breathe', of: 'ZEN', tip: 'A ring that grows and shrinks to pace your breathing' },
  { id: 'scan', label: 'Body scan', of: 'BODY SCAN', tip: 'A figure and one calm line at a time, from your jaw down to your feet' },
  { id: 'candle', label: 'Candle', of: 'CANDLE', tip: 'The room dims and one candle flickers. Rest your eyes on it' },
  { id: 'intention', label: 'Intention', of: 'INTENTION', tip: 'Write what matters for the next hour; it stays faintly behind the session' },
];

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

export const ACTIVITY_KEY = 'wall2-zen-activity';
export const INTENTION_KEY = 'wall2-zen-intention';

/** The remembered activity and breath pattern. Anything unreadable gives Breathe with the calm pattern. */
export function loadChoice(): { activity: Activity; pattern: BreathPattern } {
  try {
    const o = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '{}') as { activity?: unknown; pattern?: unknown };
    const activity = ACTIVITIES.find((a) => a.id === o.activity)?.id ?? 'breathe';
    return { activity, pattern: patternById(o.pattern) };
  } catch {
    return { activity: 'breathe', pattern: DEFAULT_PATTERN };
  }
}

export function saveChoice(activity: Activity, pattern: BreathPattern): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ activity, pattern: pattern.id }));
  } catch {
    // Storage blocked: the choice is simply not remembered.
  }
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's intention line, or an empty string when none is saved for today. */
export function loadIntention(now: Date): string {
  try {
    const o = JSON.parse(localStorage.getItem(INTENTION_KEY) ?? 'null') as { day?: unknown; text?: unknown } | null;
    return o && o.day === dayKey(now) && typeof o.text === 'string' ? o.text : '';
  } catch {
    return '';
  }
}

export function saveIntention(now: Date, text: string): void {
  try {
    localStorage.setItem(INTENTION_KEY, JSON.stringify({ day: dayKey(now), text }));
  } catch {
    // Storage blocked: the line is kept for this session only.
  }
}

/** The Body scan steps, top to bottom, ending on the whole body. */
export const BODY_STEPS: ReadonlyArray<{ caption: string; x: number; y: number; r: number }> = [
  { caption: 'Let your jaw soften.', x: 60, y: 26, r: 12 },
  { caption: 'Smooth your forehead.', x: 60, y: 16, r: 12 },
  { caption: 'Rest your eyes.', x: 60, y: 22, r: 10 },
  { caption: 'Let your shoulders drop.', x: 60, y: 52, r: 30 },
  { caption: 'Feel the weight of your arms.', x: 60, y: 68, r: 40 },
  { caption: 'Let your hands open.', x: 60, y: 90, r: 40 },
  { caption: 'Notice your chest rise and fall.', x: 60, y: 62, r: 20 },
  { caption: 'Let your belly be soft.', x: 60, y: 82, r: 16 },
  { caption: 'Feel your back against the chair.', x: 60, y: 66, r: 28 },
  { caption: 'Release your legs.', x: 60, y: 114, r: 30 },
  { caption: 'Feel your feet on the floor.', x: 60, y: 140, r: 16 },
  { caption: 'Rest in your whole body.', x: 60, y: 76, r: 62 },
];

/** Which Body scan step shows `elapsedSeconds` into a session of `minutes`, and how far through the session it is (0 to 1). */
export function bodyScanAt(elapsedSeconds: number, minutes: number): { step: number; progress: number } {
  const total = minutes * 60;
  const e = Math.min(total, Math.max(0, elapsedSeconds));
  const stepSeconds = total / BODY_STEPS.length;
  return { step: Math.min(BODY_STEPS.length - 1, Math.floor(e / stepSeconds + 1e-9)), progress: total > 0 ? e / total : 0 };
}

/** The Candle line shows this long after a session starts, then fades. */
export const CANDLE_LINE_MS = 10_000;
export const CANDLE_LINE = 'Rest your eyes here. When the mind wanders, come back.';
export const INTENTION_QUESTION = 'What matters for the next hour?';

/** Working parents and standalone sessions, from the same full card list as Work. */
export function dreamWorkingCount(summary: Pick<OmniSummary, 'lanes' | 'sessionsList'>): number {
  return cards(summary).filter(laneWorks).length;
}

const COUNT_WORDS: Record<number, string> = { 3: 'THREE', 5: 'FIVE', 10: 'TEN' };
/** "FIVE MINUTES OF ZEN", or "... OF BODY SCAN", "... OF CANDLE", "... OF INTENTION". */
export function sessionLabel(minutes: number, activity: Activity = 'breathe'): string {
  const of = ACTIVITIES.find((a) => a.id === activity)?.of ?? 'ZEN';
  return `${COUNT_WORDS[minutes] ?? String(minutes)} MINUTES OF ${of}`;
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

/** How long one pair of flames stays, and how long the change to the next pair takes. */
export const FLAME_ROTATE_MS = 4 * 60_000;
export const FLAME_FADE_MS = 30_000;

/**
 * Which flames show `elapsedMs` after Zen opened. Pair 0 is flames 0 and 1, pair 1 is 1 and 2,
 * and so on round the list; `base` is the full layer, `top` the screen-blended one.
 */
export function flamePair(elapsedMs: number, count: number): { step: number; base: number; top: number } {
  const step = Math.max(0, Math.floor(elapsedMs / FLAME_ROTATE_MS));
  return { step, base: step % count, top: (step + 1) % count };
}

/** Flames dim to this share in Dream. */
export const DREAM_DIM = 0.35;

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
