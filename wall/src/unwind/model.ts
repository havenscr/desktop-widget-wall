import { cards, laneWorks, needsYouCount, waitingIds, type Lane, type OmniSummary } from '../agents/model';
import { playerProcesses, procName } from '../music/players';
import type { DayEvent } from '../ribbon/model';
import type { WeatherReading } from '../weather/model';

/** Day names by `getDay()`; plain local time, so the line follows the zone the wall runs in. */
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Until this local hour the night still belongs to the day before (date line and Tomorrow). */
export const NIGHT_ENDS_HOUR = 5;

/** "morning", "afternoon", "evening" or "night" for the local hour of `d`. */
export function dayPart(d: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = d.getHours();
  if (h >= NIGHT_ENDS_HOUR && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

/**
 * The line under the Unwind clock: "Wednesday night, 49° and clear". Before 5 AM the
 * night still belongs to the day before. Without a reading it is the day part alone.
 */
export function dateLine(d: Date, reading: Pick<WeatherReading, 'temp' | 'look'> | null): string {
  const day = new Date(d.getTime());
  if (d.getHours() < NIGHT_ENDS_HOUR) day.setDate(day.getDate() - 1);
  const head = `${WEEKDAY[day.getDay()]} ${dayPart(d)}`;
  if (!reading || !Number.isFinite(reading.temp)) return head;
  return `${head}, ${Math.round(reading.temp)}° and ${reading.look.label.toLowerCase()}`;
}

/** A weather reading older than this is left off the date line. */
export const WEATHER_FRESH_MS = 60 * 60_000;

/** The reading when it was fetched under an hour before `nowMs`, otherwise null. */
export function freshReading<T extends Pick<WeatherReading, 'fetchedAt'>>(reading: T | null, nowMs: number): T | null {
  if (!reading || !Number.isFinite(reading.fetchedAt)) return null;
  const age = nowMs - reading.fetchedAt;
  return age >= 0 && age < WEATHER_FRESH_MS ? reading : null;
}

/** Local midnight at the start of the day after the one holding `now`. */
export function nextMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** `9:00` for a morning time, `1:30 PM` after noon, as the concept writes "AE sync at 9:00". */
export function tomorrowTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const t = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  return h < 12 ? t : `${t} PM`;
}

/**
 * The span "Tomorrow" covers, by local calendar date. After 5 AM it is the next local day
 * (midnight to midnight, so 23 or 25 hours on a clock change). Between midnight and 5 AM,
 * while the date line still says the previous day's night, it is the day that has just
 * begun, from now to its end.
 */
export function tomorrowSpan(now: number): { from: number; to: number } {
  if (new Date(now).getHours() < NIGHT_ENDS_HOUR) return { from: now, to: nextMidnight(now) };
  const from = nextMidnight(now);
  return { from, to: nextMidnight(from) };
}

/** The first event that starts inside `tomorrowSpan(now)`, or null. */
export function firstTomorrow(events: readonly DayEvent[], now: number): DayEvent | null {
  const { from, to } = tomorrowSpan(now);
  let best: DayEvent | null = null;
  let bestMs = Infinity;
  for (const e of events) {
    const s = Date.parse(e.start);
    if (!Number.isFinite(s) || s < from || s >= to) continue;
    if (s < bestMs) {
      best = e;
      bestMs = s;
    }
  }
  return best;
}

/** The part of `wall2_omni_summary` the status line reads. */
export interface StatusSummary {
  stale?: boolean;
  /** The helper's clock; with the lanes and your-move it lets a "Later" snooze tell a new request from the old one. */
  now?: string;
  lanes: ReadonlyArray<{ state: string; id?: string; waiting?: boolean }>;
  sessionsList?: ReadonlyArray<Lane> | null;
  yourMove: { total: number; first?: { sessionId?: string } | null; ids?: readonly string[] };
  /** The helper can open a chat (`wall2_open_session`). */
  linksAvailable?: boolean;
}

/** The focus timer as the status line sees it: not loaded yet, a session on, or none. */
export type FocusSeen = 'unknown' | 'on' | 'off';

/** A weather part that is missing: the date line then ends with this, in dim text. */
export const WEATHER_UNAVAILABLE = 'weather unavailable';

/** The volume as a whole percent for the hover and drag readout. */
export function volumePercent(v: number): number {
  return Math.round(clampVolume(v) * 100);
}

/** Cells in the collapsed Room grid: three columns, two rows. With more moods than this, one cell is "More". */
export const ROOM_COLLAPSED_CHIPS = 6;

/**
 * The chips to show. All of them when expanded or when they fit the grid. Otherwise one fewer
 * than the grid has cells (the last cell is "More"), and the mood that is on takes the place
 * of the last ordinary one when it would not show, so it never hides and the grid never grows.
 */
export function visibleMoods<T extends { id: string }>(moods: readonly T[], on: string | null, expanded: boolean): T[] {
  if (expanded || moods.length <= ROOM_COLLAPSED_CHIPS) return [...moods];
  const first = moods.slice(0, ROOM_COLLAPSED_CHIPS - 1);
  const extra = on && !first.some((m) => m.id === on) ? moods.find((m) => m.id === on) : undefined;
  return extra ? [...first.slice(0, -1), extra] : first;
}

/** How the helper last answered, as the status marks see it: no answer yet or not set up, failing, stale, or current. */
export type AgentsRead = 'current' | 'stale' | 'failed' | 'unset';

/**
 * The numbers behind the status marks (the capsule, its dots, the amber pill), counted by the same rules
 * as the old sentence (`statusParts`, now a frozen test reference) (top-level sessions only; a waiting session is not running). `agents` says how far the
 * helper can be trusted: only `current` carries counts, `stale` and `failed` draw the grey ring ("no fresh
 * answer") and `unset` (not set up, or no read yet) draws neither. `needs` is null when the count is not a
 * number; `snoozedWaiting` counts waiting chats quietened with "Later", which are not counted in `needs`.
 */
export interface StatusMarks {
  focus: FocusSeen;
  agents: AgentsRead;
  running: number;
  needs: number | null;
  snoozedWaiting: number;
  open: string | null;
}

/** The most dots the capsule draws; more running agents end in "+N". */
export const STATUS_MAX_DOTS = 6;

/**
 * The status line as numbers instead of sentences. `failed` says whether a missing summary is a read that
 * failed (a ring) rather than a helper that is not set up (nothing). Counting is the same as the old sentence (`statusParts` in the test helper);
 * a table test holds the two to the same answers.
 */
export function statusMarks(focus: FocusSeen, summary: StatusSummary | null, snoozed: ReadonlySet<string> = new Set(), failed = false): StatusMarks {
  const marks: StatusMarks = { focus, agents: 'unset', running: 0, needs: null, snoozedWaiting: 0, open: null };
  if (!summary) {
    marks.agents = failed ? 'failed' : 'unset';
    return marks;
  }
  if (summary.stale === true) {
    marks.agents = 'stale';
    return marks;
  }
  marks.agents = 'current';
  const lanes = cards({ lanes: summary.lanes as Lane[], sessionsList: (summary.sessionsList as Lane[] | null | undefined) ?? null });
  marks.running = lanes.filter(laneWorks).length;
  const total = summary.yourMove.total;
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
    const partial = { yourMove: summary.yourMove, lanes } as unknown as OmniSummary;
    marks.needs = Math.floor(needsYouCount(partial, snoozed));
    marks.snoozedWaiting = waitingIds(partial).filter((w) => snoozed.has(w)).length;
    if (marks.needs > 0) {
      const first = summary.yourMove.first?.sessionId;
      const id =
        (first && !snoozed.has(first) ? first : null) ||
        waitingIds(partial).find((w) => !snoozed.has(w)) ||
        summary.lanes.find((l) => (l.waiting || l.state === 'blocked') && !(l.id && snoozed.has(l.id)))?.id ||
        null;
      marks.open = summary.linksAvailable === true && id ? id : null;
    }
  }
  return marks;
}

/** What the capsule's hover card says: a title, today's sentences for the state (or none), and what a click does. */
export function statusCard(m: StatusMarks): { title: string; detail: string; hint: string } {
  const title = m.focus === 'on' ? 'Focus is still on' : m.focus === 'off' ? 'Work is put away' : 'Work';
  const words: string[] = [];
  if (m.agents === 'current') {
    if (m.running > 0) words.push(`${m.running} ${m.running === 1 ? 'agent' : 'agents'} still running.`);
    if (m.needs === 0 && m.snoozedWaiting === 0) words.push('No agent needs you.');
    else if (m.needs === 1) words.push('One thing needs you.');
    else if (m.needs !== null && m.needs > 1) words.push(`${m.needs} things need you.`);
  } else if (m.agents === 'stale' || m.agents === 'failed') words.push('Agents: no fresh answer');
  return { title, detail: words.join(' '), hint: 'Click to see the agents on Work' };
}

/** The first line of the amber pill's card, and what a click does. */
export function needsCard(needs: number, canOpen: boolean): { title: string; hint: string } {
  return { title: needs === 1 ? 'One chat is waiting for you' : `${needs} chats are waiting for you`, hint: canOpen ? (needs === 1 ? 'Click to open it' : 'Click to open the first one') : 'Click to see them on Work' };
}

/** One row of `get_audio_sessions`. */
export interface AudioSession {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
}

/**
 * The audio session of the app that is playing. `source` is the media session's app id
 * (`source_app_id`, for example `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify` or
 * `Spotify.exe`) or, from an older answer, its label ("Spotify", "Edge"). The id gives the
 * process names through the explicit table in `music/players.ts` ("Spotify" to
 * `Spotify.exe`, "Edge" to `msedge.exe`); a session matches only by its exact normalised
 * process name, never a part of one, so one music app is never taken for another. Null
 * when none matches.
 */
export function playingSession(sessions: readonly AudioSession[], source: string | null | undefined): AudioSession | null {
  const want = playerProcesses(source);
  if (want.length === 0) return null;
  return sessions.find((s) => want.includes(procName(s.name))) ?? null;
}

/** A slider value clamped to 0..1 (anything not a number is 0). */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** The level `set_audio_session_volume` takes: a whole number 0 to 100. */
export function volumeLevel(v: number): number {
  return Math.round(clampVolume(v) * 100);
}

/** What the idle player shows: the last thing played on this wall. */
export interface LastPlayed {
  title: string;
  artist: string;
  source: string;
}

export const LAST_PLAYED_KEY = 'wall2-last-played';

export function readLastPlayed(storage: Pick<Storage, 'getItem'> | null): LastPlayed | null {
  try {
    const raw = storage?.getItem(LAST_PLAYED_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastPlayed> | null;
    if (!v || typeof v.title !== 'string' || !v.title) return null;
    return { title: v.title.slice(0, 200), artist: typeof v.artist === 'string' ? v.artist.slice(0, 200) : '', source: typeof v.source === 'string' ? v.source.slice(0, 60) : '' };
  } catch {
    return null;
  }
}

export function writeLastPlayed(storage: Pick<Storage, 'setItem'> | null, last: LastPlayed): void {
  try {
    storage?.setItem(LAST_PLAYED_KEY, JSON.stringify(last));
  } catch {
    /* storage can be blocked; the idle view then shows the calm line */
  }
}
