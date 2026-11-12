import type { DayEvent } from '../ribbon/model';
import type { WeatherReading } from '../weather/model';

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

/** "morning", "afternoon", "evening" or "night" for the local hour of `d`. */
export function dayPart(d: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
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
  if (d.getHours() < 5) day.setDate(day.getDate() - 1);
  const head = `${WEEKDAY.format(day)} ${dayPart(d)}`;
  if (!reading || !Number.isFinite(reading.temp)) return head;
  return `${head}, ${Math.round(reading.temp)}° and ${reading.look.label.toLowerCase()}`;
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

/** The first event that starts on or after the coming midnight, or null. */
export function firstTomorrow(events: readonly DayEvent[], now: number): DayEvent | null {
  const from = nextMidnight(now);
  const to = from + 24 * 3_600_000;
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
  lanes: ReadonlyArray<{ state: string }>;
  yourMove: { total: number };
}

/**
 * "Work is put away. 2 agents still running. Nothing needs you." A focus session still
 * on says so instead of the first sentence. Without the helper the agent and needs-you
 * parts are left out, since there is nothing to say them from.
 */
export function statusLine(focusOn: boolean, summary: StatusSummary | null): string {
  const parts = [focusOn ? 'Focus is still on.' : 'Work is put away.'];
  if (summary) {
    const running = summary.lanes.filter((l) => l.state === 'working').length;
    if (running > 0) parts.push(`${running} ${running === 1 ? 'agent' : 'agents'} still running.`);
    const asks = Math.max(0, Math.floor(summary.yourMove.total));
    parts.push(asks === 0 ? 'Nothing needs you.' : asks === 1 ? 'One thing needs you.' : `${asks} things need you.`);
  }
  return parts.join(' ');
}

/** One row of `get_audio_sessions`. */
export interface AudioSession {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
}

const squash = (s: string) => s.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');

/** Process names for the source labels `get_now_playing` gives that do not match their process. */
const PROCESS_FOR: Record<string, string> = { edge: 'msedge', groovemusic: 'music', applemusic: 'applemusic' };

/**
 * The audio session of the app that is playing, matched by name ("Spotify" to
 * "Spotify.exe", "Edge" to "msedge.exe"), or null when none matches.
 */
export function playingSession(sessions: readonly AudioSession[], sourceApp: string | null | undefined): AudioSession | null {
  if (!sourceApp) return null;
  const src = squash(sourceApp);
  if (!src) return null;
  const want = PROCESS_FOR[src] ?? src;
  return sessions.find((s) => squash(s.name) === want) ?? sessions.find((s) => squash(s.name).includes(want)) ?? null;
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
