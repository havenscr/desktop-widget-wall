/**
 * Day ribbon layout, as in the concept (`v3.src.html`, the ribbon script). Pure: the
 * component draws what these functions return.
 *
 * The ribbon runs 6 AM to 12 AM on the local clock, 128 px an hour from x 72, inside a
 * ribbon 2416 px wide (the stage minus the shell inset, rail and gap).
 */
import { dayKey, sessionsOn, type FocusSession } from '../focus/day';
import type { TaskItem } from '../tasks/model';
import type { SunTimes } from './sun';

export const RIBBON_WIDTH = 2416;
export const START_HOUR = 6;
export const END_HOUR = 24;
export const HOUR_PX = 128;
/** Hour labels hide this close to the needle, sunrise and sunset labels this close. */
export const HOUR_LABEL_GAP = 70;
export const SUN_LABEL_GAP = 90;
/** Narrowest calendar chip, so a 5 minute event still shows. */
export const MIN_CHIP_PX = 12;
/** A chip narrower than this shows no title (it keeps a tooltip and an accessible name). */
export const NARROW_CHIP_PX = 44;

/** x of local hour `h` (6 to 24). */
export const RX = (h: number) => 72 + (h - START_HOUR) * HOUR_PX;

const clampHour = (h: number) => Math.min(END_HOUR, Math.max(START_HOUR, h));

/** One event from `wall2_meet_day` (the fields the ribbon reads). */
export interface DayEvent {
  key: string;
  title: string;
  /** UTC, `2026-11-11T17:00:00Z`. */
  start: string;
  end: string;
  isLive?: boolean;
  /** Which configured account the event is from (its id, never an address). */
  accountId?: string;
  /** Rust holds a link that opens the event in Outlook (`wall2_open_event`). */
  canOpen?: boolean;
}

/**
 * Local wall-clock hour of `ms` on the day holding `now`: 0 to 24 on that day, -1 for
 * any earlier day and 25 for any later one. Wall clock, so a DST day still lines up.
 */
export function wallHour(ms: number, now: number): number {
  const today = dayKey(now);
  const key = dayKey(ms);
  if (key < today) return -1;
  if (key > today) return 25;
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** `h:mm` with no AM or PM, as the concept writes the needle and sun times. */
export function shortTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `6 AM`, `12 PM`, `12 AM` (for 24). */
export function hourText(h: number): string {
  return `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
}

/** The needle: clamped to the ribbon before 6 AM, always showing the real time. */
export function needle(now: number): { x: number; text: string } {
  return { x: RX(clampHour(wallHour(now, now))), text: shortTime(now) };
}

/** A tick every hour, 6 AM to 12 AM. */
export function ticks(): number[] {
  const out: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) out.push(RX(h));
  return out;
}

/** Labels every two hours, leaving out any within 70 px of the needle. */
export function hourLabels(needleX: number): { x: number; text: string }[] {
  const out: { x: number; text: string }[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h += 2) {
    const x = RX(h);
    if (Math.abs(x - needleX) > HOUR_LABEL_GAP) out.push({ x, text: hourText(h) });
  }
  return out;
}

/** Sunrise and sunset labels inside the ribbon, leaving out any within 90 px of the needle. */
export function sunLabels(sun: SunTimes, now: number, needleX: number): { x: number; text: string }[] {
  const out: { x: number; text: string }[] = [];
  for (const [ms, word] of [
    [sun.rise, 'sunrise'],
    [sun.set, 'sunset'],
  ] as const) {
    if (ms === null) continue;
    const h = wallHour(ms, now);
    if (h < START_HOUR || h > END_HOUR) continue;
    const x = RX(h);
    // Rounded to the nearest minute, as almanacs print them.
    if (Math.abs(x - needleX) > SUN_LABEL_GAP) out.push({ x, text: `${word} ${shortTime(Math.round(ms / 60_000) * 60_000)}` });
  }
  return out;
}

/** The concept's sky stops, placed around sunrise and sunset as percentages of the ribbon. */
const SKY_COLORS = ['#0d0a2c', '#1a1446', '#e08f7a', '#7c7ab8', '#3f86b8', '#2f9bc0', '#5a8fb0', '#ff9a52', '#ff4d8a', '#8a2a8a', '#221456', '#0b0826'];
const CONCEPT_SKY = [0, 5, 9, 13, 17, 35, 53, 59.5, 62, 64.5, 72, 100];

/** The sky gradient behind the ribbon. The concept's stops sit on 7:08 and 4:40; here they follow the real day. */
export function skyGradient(sun: SunTimes, now: number): string {
  let stops = CONCEPT_SKY;
  if (sun.rise !== null && sun.set !== null) {
    const pct = (ms: number) => (RX(clampHour(wallHour(ms, now))) / RIBBON_WIDTH) * 100;
    const r = pct(sun.rise);
    const s = pct(sun.set);
    if (s - r > 20) {
      stops = [0, r - 4, r, r + 4, r + 8, (r + 8 + s - 6.5) / 2, s - 6.5, s, s + 2.5, s + 5, s + 12.5, 100].map((p) => Math.min(100, Math.max(0, p)));
    }
  }
  const parts = SKY_COLORS.map((c, i) => `${c} ${+stops[i].toFixed(2)}%`);
  return `linear-gradient(90deg,${parts.join(',')})`;
}

export type ChipState = 'past' | 'now' | 'next';

export interface Chip {
  key: string;
  title: string;
  x: number;
  width: number;
  state: ChipState;
  live: boolean;
  /** 0, or 1 when it overlaps an earlier chip in lane 0 (drawn 4 px lower and shorter). */
  lane: 0 | 1;
  /** Too narrow for its title. */
  narrow: boolean;
  start: number;
  end: number;
  accountId: string | null;
  canOpen: boolean;
}

/**
 * Calendar chips for row 1: today's events between 6 AM and 12 AM, clipped to that span.
 * An event that has ended is `past`; one under the needle is `now`. A chip that starts
 * before the last lane 0 chip ends goes in lane 1.
 */
export function chips(events: readonly DayEvent[], now: number): Chip[] {
  const out: Chip[] = [];
  for (const e of events) {
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const sh = clampHour(wallHour(start, now));
    const eh = clampHour(wallHour(end, now));
    if (eh <= sh) continue;
    const x = RX(sh);
    out.push({
      key: e.key,
      title: e.title,
      x,
      width: Math.max(MIN_CHIP_PX, RX(eh) - x),
      state: end <= now ? 'past' : start <= now ? 'now' : 'next',
      live: e.isLive === true,
      lane: 0,
      narrow: false,
      start,
      end,
      accountId: typeof e.accountId === 'string' ? e.accountId : null,
      canOpen: e.canOpen === true,
    });
  }
  out.sort((a, b) => a.x - b.x);
  const ends = [-Infinity, -Infinity];
  for (const c of out) {
    c.lane = c.x >= ends[0] ? 0 : 1;
    ends[c.lane] = Math.max(ends[c.lane], c.x + c.width);
    c.narrow = c.width < NARROW_CHIP_PX;
  }
  return out;
}

/** Focus bars: today's sessions up to now, inside 6 AM to 12 AM. */
export function focusBars(sessions: readonly FocusSession[], now: number): { x: number; width: number }[] {
  const out: { x: number; width: number }[] = [];
  for (const s of sessionsOn(sessions, now)) {
    if (s.start >= now) continue;
    const sh = clampHour(wallHour(s.start, now));
    const eh = clampHour(wallHour(Math.min(s.end, now), now));
    if (eh <= sh) continue;
    out.push({ x: RX(sh), width: Math.max(2, RX(eh) - RX(sh)) });
  }
  return out;
}

export interface DueMark {
  key: string;
  title: string;
  /** `3:00`, as the concept writes times on the ribbon. */
  time: string;
  x: number;
}

/**
 * Due marks for row 2: one for each of the next three tasks that is due at a time today
 * (not all day, not undated), at that hour. A time before 6 AM sits at the ribbon start.
 */
export function dueMarks(tasks: readonly TaskItem[], now: number): DueMark[] {
  const out: DueMark[] = [];
  for (const task of tasks.slice(0, 3)) {
    if (task.due_is_all_day || !task.due_at) continue;
    const ms = Date.parse(task.due_at);
    if (!Number.isFinite(ms) || dayKey(ms) !== dayKey(now)) continue;
    out.push({ key: task.id, title: task.title, time: shortTime(ms), x: RX(clampHour(wallHour(ms, now))) });
  }
  return out;
}

/** Milliseconds until the next whole minute, so the needle moves on the minute. */
export function msToNextMinute(now: number): number {
  return 60_000 - (now % 60_000) + 50;
}

/** "1 h 36 m" or "12 min" until a time (at least 1 min). */
export function untilText(ms: number, now: number): string {
  const mins = Math.max(1, Math.round((ms - now) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 === 0 ? `${h} h` : `${h} h ${mins % 60} m`;
}

/**
 * The needle's tooltip: the time and the countdown to the next meeting today ("4:10. Next
 * meeting in 1 h 36 m: Weekly planning"), "in progress" for one under the needle when no
 * other is coming, or "No more meetings today" after a good read; just the time otherwise.
 */
export function needleTip(chipsToday: readonly Chip[], now: number, known: boolean): string {
  const head = shortTime(now);
  const next = chipsToday.filter((c) => c.start > now).sort((a, b) => a.start - b.start)[0];
  if (next) return `${head}. Next meeting in ${untilText(next.start, now)}: ${next.title}`;
  const current = chipsToday.find((c) => c.state === 'now');
  if (current) return `${head}. In ${current.title} until ${shortTime(current.end)}, nothing after it today`;
  return known ? `${head}. No more meetings today` : head;
}

/** "10:30 to 11:30" for a chip's hover card, with AM or PM on the end. */
export function spanText(start: number, end: number): string {
  const ampm = (ms: number) => (new Date(ms).getHours() < 12 ? 'AM' : 'PM');
  return `${shortTime(start)} to ${shortTime(end)} ${ampm(end)}`;
}
