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
import { busyPeak, workingSpans } from './busy';

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
  /** Rust holds a join link (`wall2_meet_join`). */
  canJoin?: boolean;
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
  /** Its lane in its group of overlapping events, from 0 (`chipLayout`). */
  lane: number;
  /** How many lanes its group stacks in the row: 1, or 2 or 3 at a reduced height. */
  lanes: number;
  /** Too narrow for its title. */
  narrow: boolean;
  /** Width of the title written beside a narrow chip, or null when there is no room (hover only). */
  beside: number | null;
  start: number;
  end: number;
  accountId: string | null;
  canOpen: boolean;
  /** The calendar holds a join link for it. */
  canJoin?: boolean;
}

const DAY_MS = 86_400_000;

/** Local midnight at the start of the day holding `ms`. */
function midnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** An all-day event: a day or more long, or midnight to a later midnight on the local clock. */
export function isAllDay(start: number, end: number): boolean {
  if (end - start >= DAY_MS - 60_000) return true;
  return end > start && midnight(start) === start && midnight(end) === end;
}

function toChip(e: DayEvent, start: number, end: number, x: number, width: number, now: number): Chip {
  return {
    key: e.key,
    title: e.title,
    x,
    width,
    state: end <= now ? 'past' : start <= now ? 'now' : 'next',
    live: e.isLive === true,
    lane: 0,
    lanes: 1,
    narrow: false,
    beside: null,
    start,
    end,
    accountId: typeof e.accountId === 'string' ? e.accountId : null,
    canOpen: e.canOpen === true,
    canJoin: e.canJoin === true,
  };
}

/**
 * Calendar chips for row 1: today's timed events between 6 AM and 12 AM, clipped to that
 * span (all-day events fold into one chip, `allDayChips`). An event that has ended is
 * `past`; one under the needle is `now`. Lanes come from `chipLayout`.
 */
export function chips(events: readonly DayEvent[], now: number): Chip[] {
  const out: Chip[] = [];
  for (const e of events) {
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (isAllDay(start, end)) continue;
    const sh = clampHour(wallHour(start, now));
    const eh = clampHour(wallHour(end, now));
    if (eh <= sh) continue;
    const x = RX(sh);
    out.push(toChip(e, start, end, x, Math.max(MIN_CHIP_PX, RX(eh) - x), now));
  }
  out.sort((a, b) => a.x - b.x);
  for (const c of out) c.narrow = c.width < NARROW_CHIP_PX;
  return out;
}

/** Today's all-day events, in start order, for the one "N all day" chip (its hover lists them). */
export function allDayChips(events: readonly DayEvent[], now: number): Chip[] {
  const dayStart = midnight(now);
  const out: Chip[] = [];
  for (const e of events) {
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !isAllDay(start, end)) continue;
    if (end <= dayStart || start >= dayStart + DAY_MS) continue;
    out.push(toChip(e, start, end, RX(START_HOUR), 0, now));
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

/** "1 all day", "2 all day". */
export function allDayText(n: number): string {
  return `${n} all day`;
}

/** The all-day chip's width at the start of the calendar row, from its words. */
export function allDayWidth(n: number): number {
  return Math.round(24 + allDayText(n).length * 8.6);
}

/** Most lanes a group of overlapping events stacks in; a fourth at once goes into a "+N" chip. */
export const CHIP_LANES = 3;
/** Width of a "+N" chip. */
export const MORE_CHIP_PX = 44;
/** The narrowest a "+N" chip gets when it must squeeze in after its group. */
export const MORE_MIN_PX = 24;
/** Gap between a "+N" chip and the chips beside it. */
const MORE_GAP = 4;
/** Gap between a narrow chip and the title written beside it, and before the next chip. */
const BESIDE_GAP = 6;
/** A title beside its chip needs at least this much room, else it is in the hover only. */
export const BESIDE_MIN_PX = 60;
/** The widest a title beside its chip runs. */
export const BESIDE_MAX_PX = 260;

/** A "+N" chip: the events that did not fit, listed on hover, picked from on click. Full row height. */
export interface MoreChip {
  key: string;
  x: number;
  width: number;
  items: Chip[];
}

/** The "N all day" chip's place: the start of the calendar row, in lane `lane` of `lanes`. */
export interface AllDayBox {
  x: number;
  width: number;
  lane: number;
  lanes: number;
}

/** Estimated width of a title in the chip type: 17 px in a single lane, 13 px when stacked. */
function titleWidth(title: string, lanes: number): number {
  return Math.ceil(title.length * (lanes > 1 ? 6.8 : 8.6)) + 4;
}

const ALL_DAY_KEY = '\u0000all-day';

/**
 * Lanes for the day's chips, so no chip is ever drawn over another. Events that overlap in
 * time (an event that ends exactly when the next begins does not) form a group; a group of
 * one keeps the full row, a group needing two or three lanes stacks them at a reduced
 * height. When more than three overlap at once, the group keeps two lanes of real chips and
 * the rest go into one full-height "+N" chip that covers no chip: at the end of the group's
 * span (the chips there drawn shorter), else just after it. `allDay` is the width of the "N all day" chip, which takes the first
 * lane at the start of the row. A narrow chip gets its title written beside it when the
 * row has room before the next chip.
 */
export function chipLayout(all: readonly Chip[], allDay = 0): { shown: Chip[]; more: MoreChip[]; allDay: AllDayBox | null } {
  const items = [...all].sort((a, b) => a.x - b.x).map((c) => ({ ...c }));
  const pseudo = allDay > 0 ? ({ key: ALL_DAY_KEY, x: RX(START_HOUR), width: allDay } as Chip) : null;
  if (pseudo) items.unshift(pseudo);
  // Groups of chips whose spans overlap, directly or through another.
  const groups: Chip[][] = [];
  let reach = -Infinity;
  for (const c of items) {
    if (groups.length > 0 && c.x < reach) {
      groups[groups.length - 1].push(c);
      reach = Math.max(reach, c.x + c.width);
    } else {
      groups.push([c]);
      reach = c.x + c.width;
    }
  }
  const groupOf = new Map<Chip, number>();
  groups.forEach((g, i) => g.forEach((c) => groupOf.set(c, i)));
  const shown: Chip[] = [];
  const more: MoreChip[] = [];
  let box: AllDayBox | null = null;
  for (const g of groups) {
    const place = (lanes: number) => {
      const ends = Array.from({ length: lanes }, () => -Infinity);
      const over: Chip[] = [];
      for (const c of g) {
        const lane = ends.findIndex((e) => c.x >= e);
        if (lane < 0) over.push(c);
        else {
          c.lane = lane;
          ends[lane] = c.x + c.width;
        }
      }
      return over;
    };
    let over = place(CHIP_LANES);
    let lanes = over.length === 0 ? Math.max(...g.map((c) => c.lane)) + 1 : 2;
    const kept: Chip[] = [];
    const groupMore: MoreChip[] = [];
    if (over.length > 0) {
      // Two lanes of real chips; one full-height "+N" chip holds every other meeting of the group
      // and sits where it covers no chip: inside the group's span at its end (the chips there are
      // drawn shorter to make room), else just after the group, narrower if it must be.
      over = place(2);
      const end = Math.max(...g.map((c) => c.x + c.width));
      const next = groups[groups.indexOf(g) + 1]?.[0]?.x ?? RX(END_HOUR) + 40;
      const inGroup = g.filter((c) => !over.includes(c));
      const nx = end - MORE_CHIP_PX;
      const fitsInside = inGroup.every((c) => c.x + c.width <= nx - MORE_GAP || (c !== pseudo && c.x + MIN_CHIP_PX <= nx - MORE_GAP));
      let mx: number;
      let mw = MORE_CHIP_PX;
      if (fitsInside) {
        mx = nx;
        for (const c of inGroup) if (c.x + c.width > nx - MORE_GAP) c.width = nx - MORE_GAP - c.x;
      } else {
        mx = end + MORE_GAP;
        mw = Math.max(MORE_MIN_PX, Math.min(MORE_CHIP_PX, next - MORE_GAP - mx));
      }
      groupMore.push({ key: `more-${over[0].key}`, x: mx, width: mw, items: [...over] });
    }
    kept.push(...g.filter((c) => !over.includes(c)));
    if (kept.length > 0 && over.length === 0) lanes = Math.max(...kept.map((c) => c.lane)) + 1;
    for (const c of kept) {
      c.lanes = lanes;
      if (c === pseudo) box = { x: c.x, width: c.width, lane: c.lane, lanes };
      else {
        // Three stacked lanes are too thin for a title: it is in the hover only.
        if (lanes >= 3) c.narrow = true;
        shown.push(c);
      }
    }
    for (const m of groupMore) m.items.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
    more.push(...groupMore);
  }
  // Titles beside narrow chips, where the row has room before the next thing in their lane.
  const ribbonEnd = RX(END_HOUR) + 40;
  const others = [...shown.map((c) => ({ c, x: c.x, w: c.width })), ...more.map((m) => ({ c: null, x: m.x, w: m.width })), ...(box ? [{ c: null, x: box.x, w: box.width }] : [])];
  for (const c of shown) {
    if (!c.narrow || c.lanes >= 3) continue;
    const from = c.x + c.width;
    let room = ribbonEnd - from;
    for (const o of others) {
      if (o.c === c || o.x < from) continue;
      // Within its own stacked group only the chip's own lane blocks it.
      if (o.c && c.lanes > 1 && groupOf.get(o.c) === groupOf.get(c) && o.c.lane !== c.lane) continue;
      room = Math.min(room, o.x - from);
    }
    // The title takes the room up to the next chip (cut with an ellipsis only when it is longer).
    const free = Math.floor(room - 2 * BESIDE_GAP);
    c.beside = free >= Math.min(titleWidth(c.title, c.lanes), BESIDE_MIN_PX) ? Math.min(free, BESIDE_MAX_PX) : null;
  }
  return { shown, more, allDay: box };
}

/** True after 9 PM local time: the agent bars and the focus line draw at 40 percent. */
export function isLate(now: number): boolean {
  return new Date(now).getHours() >= 21;
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

/** A due mark's label (diamond, title, time) as an x span, from its title's length. */
export function dueLabelSpan(m: DueMark): { x: number; width: number } {
  return { x: m.x - 6, width: 19 + Math.min(180, m.title.length * 8.6) + 52 };
}

/** True when the span overlaps any of `boxes`. */
export function overlapsAny(a: { x: number; width: number }, boxes: readonly { x: number; width: number }[]): boolean {
  return boxes.some((b) => a.x < b.x + b.width && b.x < a.x + a.width);
}

// The calm strip (Work and Meet): overlapping meetings fold into one chip, agents into one line.

/** A run of overlapping timed meetings drawn as one chip: "3 at 1:30" and the titles. */
export interface FoldChip {
  key: string;
  x: number;
  width: number;
  /** "3 at 1:30": how many, and the latest start in the run (when they all have begun). */
  count: string;
  items: Chip[];
  /** The hour the run starts (local, 0 to 24), for the Day drawer to scroll to. */
  hour: number;
}

/** Room the folded chip's count needs, so it is never cut. */
export function foldCountWidth(count: string): number {
  return Math.ceil(count.length * 9.6) + 20;
}

/**
 * The calm strip's calendar row: a meeting alone keeps its chip (titles of narrow chips go
 * beside them when there is room before the next thing); a run of meetings that overlap in
 * time folds into one chip from the run's start to its end (at least wide enough for its
 * count). Chips are in time order; nothing is stacked.
 */
export function calmLayout(all: readonly Chip[], now: number): { singles: Chip[]; folds: FoldChip[] } {
  const items = [...all].sort((a, b) => a.start - b.start || a.x - b.x).map((c) => ({ ...c }));
  const groups: Chip[][] = [];
  let reach = -Infinity;
  for (const c of items) {
    if (groups.length > 0 && c.start < reach) {
      groups[groups.length - 1].push(c);
      reach = Math.max(reach, c.end);
    } else {
      groups.push([c]);
      reach = c.end;
    }
  }
  const singles: Chip[] = [];
  const folds: FoldChip[] = [];
  for (const g of groups) {
    if (g.length === 1) {
      singles.push(g[0]);
      continue;
    }
    const x = Math.min(...g.map((c) => c.x));
    const end = Math.max(...g.map((c) => c.x + c.width));
    const latest = Math.max(...g.map((c) => c.start));
    const count = `${g.length} at ${shortTime(latest)}`;
    const start = Math.min(...g.map((c) => c.start));
    folds.push({ key: `fold-${g[0].key}`, x, width: Math.max(end - x - 8, foldCountWidth(count)), count, items: g, hour: Math.max(0, wallHour(start, now)) });
  }
  // A narrow single's title goes beside it when the row has room before the next chip.
  const next = [...singles.map((c) => c.x), ...folds.map((f) => f.x)];
  for (const c of singles) {
    if (!c.narrow) continue;
    const from = c.x + c.width;
    const room = Math.min(RX(END_HOUR) + 40, ...next.filter((x) => x >= from)) - from;
    const free = Math.floor(room - 2 * BESIDE_GAP);
    c.beside = free >= Math.min(titleWidth(c.title, 1), BESIDE_MIN_PX) ? Math.min(free, BESIDE_MAX_PX) : null;
  }
  return { singles, folds };
}

/** "All day · Team offsite week" for the thin bar over the calendar row. */
export function allDayBarText(items: readonly Chip[]): string {
  return `All day \u00b7 ${items.map((c) => c.title).join(', ')}`;
}

/** The activity bar's cells: 12 minutes each. */
export const CELL_MIN = 12;

/** One cell of the thin activity bar: the most sessions working at once in it, and whether one waited on the owner. */
export interface ActivityCell {
  x: number;
  width: number;
  start: number;
  end: number;
  busy: number;
  waits: boolean;
}

/**
 * The thin activity bar: 12 minute cells from 6 AM to `until` (now, or the stale cut), each
 * with the most sessions WORKING at once in it (`busy`: run spans, open or finished, as
 * `busy.ts` counts them; the caller passes only parent and standalone sessions) and whether
 * any of them waited on the owner. Cells with no span of any kind are left out.
 */
export function activityCells(spans: readonly { lane: string; kind: string; start: number; end: number }[], now: number, until: number = now): ActivityCell[] {
  const d = new Date(now);
  d.setHours(START_HOUR, 0, 0, 0);
  const from = d.getTime();
  const out: ActivityCell[] = [];
  for (let t = from; t < until; t += CELL_MIN * 60_000) {
    const end = Math.min(until, t + CELL_MIN * 60_000);
    const inCell = spans.filter((g) => g.start < end && g.end > t);
    if (inCell.length === 0) continue;
    const busy = busyPeak(workingSpans(inCell, new Set(inCell.map((g) => g.lane))), t, end);
    const x = RX(clampHour(wallHour(t, now)));
    const x1 = RX(clampHour(wallHour(end, now)));
    out.push({ x, width: Math.max(1, x1 - x - 1), start: t, end, busy, waits: inCell.some((g) => g.kind === 'wait') });
  }
  return out;
}


/** The agents line's counts: open sessions, how many need the owner, work, or sit idle. */
export interface AgentCounts {
  total: number;
  need: number;
  working: number;
  idle: number;
}

/** "12 sessions: 2 need you, 5 working" or, with none needing him, "3 sessions: 2 working, 1 idle". */
export function agentsLineParts(c: AgentCounts): { head: string; need: string | null; tail: string } {
  const head = `${c.total} session${c.total === 1 ? '' : 's'}: `;
  if (c.need > 0) return { head, need: `${c.need} need${c.need === 1 ? 's' : ''} you`, tail: `, ${c.working} working` };
  return { head, need: null, tail: `${c.working} working, ${c.idle} idle` };
}

/** Width the agents line takes, estimated from its words (16 px type). */
export function agentsLineWidth(text: string): number {
  return Math.ceil(text.length * 8.2) + 4;
}

/** Fewer than this many pixels right of the needle and the agents line goes before it. */
export const LINE_ROOM_PX = 360;

/** Where the agents line sits: just after the needle, or right-aligned before it late in the day. */
export function agentsLineX(needleX: number, width: number): number {
  return RIBBON_WIDTH - (needleX + 14) < LINE_ROOM_PX ? needleX - 14 - width : needleX + 14;
}

/** "2 h 05 m", as the panels write durations. */
export function hm(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
}

/** The Day drawer handle's hit area on the strip: 80 by 26 at the top edge, above the all-day bar (y 27). */
export const HANDLE_W = 80;
export const HANDLE_H = 26;

/**
 * Where the handle's hit area starts: centred on the strip, or the nearest place either side
 * (in 40 px steps) where it covers none of `blocks` (the hour and sun labels and the needle's
 * time pill), so it never sits on a label.
 */
export function handleX(blocks: readonly { x: number; width: number }[]): number {
  const centre = Math.round(RIBBON_WIDTH / 2 - HANDLE_W / 2);
  const free = (x: number) => !blocks.some((b) => x < b.x + b.width + 4 && b.x - 4 < x + HANDLE_W);
  for (let k = 0; k <= 12; k++) {
    for (const x of [centre - k * 40, centre + k * 40]) if (free(x)) return x;
  }
  return centre;
}

/** The x span a label centred on `x` takes in the hour row (15 px type, wide letter spacing). */
export function labelBox(x: number, text: string, px = 10): { x: number; width: number } {
  const width = Math.ceil(text.length * px) + 8;
  return { x: x - width / 2, width };
}
