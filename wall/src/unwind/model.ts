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
  lanes: ReadonlyArray<{ state: string; id?: string; waiting?: boolean }>;
  yourMove: { total: number; first?: { sessionId?: string } | null };
  /** The helper can open a chat (`wall2_open_session`). */
  linksAvailable?: boolean;
}

/** The focus timer as the status line sees it: not loaded yet, a session on, or none. */
export type FocusSeen = 'unknown' | 'on' | 'off';

/**
 * One part of the status line: plain text, the running agents (a chip that switches to
 * Work), or the things that need the owner (an amber chip that opens the first waiting
 * chat, `open` being its session id; null when it cannot be opened, then plain text).
 */
export type StatusPart =
  | { kind: 'text'; text: string }
  | { kind: 'running'; text: string }
  | { kind: 'needs'; text: string; open: string | null };

/**
 * "Work is put away. 2 agents still running. Nothing needs you." as parts. The first
 * sentence needs the focus store loaded: a session running or paused says "Focus is still
 * on.", and before it has loaded nothing is said about it. The agent and needs-you parts
 * need a current helper summary: without the helper, or when it says its data is stale,
 * they are left out, and so is a needs-you count that is not a number. "Nothing needs
 * you." is plain text; "N things need you" opens the first waiting chat when links are
 * available (the summary's first your-move session, else the first lane that waits).
 */
export function statusParts(focus: FocusSeen, summary: StatusSummary | null): StatusPart[] {
  const parts: StatusPart[] = [];
  if (focus === 'on') parts.push({ kind: 'text', text: 'Focus is still on.' });
  else if (focus === 'off') parts.push({ kind: 'text', text: 'Work is put away.' });
  if (summary && summary.stale !== true) {
    const running = summary.lanes.filter((l) => l.state === 'working').length;
    if (running > 0) parts.push({ kind: 'running', text: `${running} ${running === 1 ? 'agent' : 'agents'} still running.` });
    const total = summary.yourMove.total;
    if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
      const asks = Math.floor(total);
      if (asks === 0) parts.push({ kind: 'text', text: 'Nothing needs you.' });
      else {
        const id = summary.yourMove.first?.sessionId || summary.lanes.find((l) => l.waiting || l.state === 'blocked')?.id || null;
        parts.push({ kind: 'needs', text: asks === 1 ? 'One thing needs you.' : `${asks} things need you.`, open: summary.linksAvailable === true && id ? id : null });
      }
    }
  }
  return parts;
}

/** The status line as one string (the parts' words, in order). */
export function statusLine(focus: FocusSeen, summary: StatusSummary | null): string {
  return statusParts(focus, summary)
    .map((p) => p.text)
    .join(' ');
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
