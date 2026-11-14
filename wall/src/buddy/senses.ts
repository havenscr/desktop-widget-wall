import { laneWorks, type DaySpan, type Lane } from '../agents/model';
import type { WeatherReading } from '../weather/model';
import type { Topic } from './lines';

/**
 * Small pure readings of the wall's own sources for Watt: the weather, the hour, the agents, the
 * clover times. Anything missing or stale gives nothing, so she simply does not talk about it.
 */

/** A weather reading older than this is too old to talk about. */
export const WEATHER_FRESH_MS = 2 * 60 * 60_000;
/** Below this (Fahrenheit, as the weather card) she wears a scarf; above the other she is warm. */
export const COLD_F = 42;
export const HOT_F = 85;

export interface WeatherSense {
  rain: boolean;
  snow: boolean;
  clear: boolean;
  cloudy: boolean;
  fog: boolean;
  cold: boolean;
  hot: boolean;
}

const NONE: WeatherSense = { rain: false, snow: false, clear: false, cloudy: false, fog: false, cold: false, hot: false };

/** What the weather means for her, or all false when there is no fresh reading. */
export function senseWeather(r: WeatherReading | null, now: number): WeatherSense {
  if (!r || now - r.fetchedAt > WEATHER_FRESH_MS || !Number.isFinite(r.temp)) return NONE;
  const icon = r.look.icon;
  return {
    rain: icon === 'rain' || icon === 'drizzle' || icon === 'storm',
    snow: icon === 'snow',
    clear: icon === 'sun',
    cloudy: icon === 'cloud' || icon === 'cloud-sun' || icon === 'cloud-moon',
    fog: icon === 'fog',
    cold: r.temp < COLD_F,
    hot: r.temp > HOT_F,
  };
}

/** The weather topics true now. */
export function weatherTopics(w: WeatherSense): Topic[] {
  const out: Topic[] = [];
  for (const t of ['rain', 'snow', 'clear', 'cloudy', 'fog', 'cold', 'hot'] as const) if (w[t]) out.push(t);
  return out;
}

/**
 * The part of the day, as a topic: morning to 11:00, midday to 14:00, afternoon to 18:00, then
 * evening (she is asleep and quiet from 9:30 PM to 6:30 AM, so there is no late night topic).
 */
export function dayTopic(hour: number): Topic {
  if (hour < 11) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** Evening with the moon up, before she sleeps at 9:30 PM: she looks up at it. */
export function moonUp(hour: number): boolean {
  return hour >= 18;
}

/** Midday sun: 11:00 to 15:00. */
export function midday(hour: number): boolean {
  return hour >= 11 && hour < 15;
}

/** Lanes that are working (not waiting for an answer). */
export function workingIds(lanes: readonly Lane[]): Set<string> {
  const out = new Set<string>();
  for (const l of lanes) if (laneWorks(l)) out.add(l.id);
  return out;
}

/**
 * How many agents finished between two answers, by the summary's own word: a lane that was
 * working and has now reached a pull request or gone live (not waiting), or a lane that has left
 * the list whose newest span in the day is `done`. A lane that left for any other reason
 * (dismissed, past the cap) does not count.
 */
export function finishedBetween(before: ReadonlySet<string>, lanes: readonly Lane[], day: readonly DaySpan[] = []): number {
  let n = 0;
  for (const id of before) {
    const l = lanes.find((x) => x.id === id);
    if (l) {
      if (!l.waiting && l.state !== 'blocked' && l.state !== 'working' && (l.stage === 'pr' || l.stage === 'live')) n++;
      continue;
    }
    let newest: DaySpan | null = null;
    for (const sp of day) if (sp.lane === id && (!newest || sp.start > newest.start)) newest = sp;
    if (newest?.kind === 'done') n++;
  }
  return n;
}

/** Two clover times a day, minutes after midnight, different each date (10:00 to 12:00 and 15:00 to 16:30). */
export function cloverTimes(dateKey: string): [number, number] {
  let h = 7;
  for (let i = 0; i < dateKey.length; i++) h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
  return [10 * 60 + (h % 120), 15 * 60 + ((h >>> 8) % 90)];
}

/**
 * Whether a clover grows now, and the grown count after it: the first at its time, the second at
 * its own. A wall that starts after the second time grows just one (counted as both), so two
 * never come back to back. Null when none is due.
 */
export function cloverDue(dateKey: string, minutes: number, grown: number): number | null {
  const [a, b] = cloverTimes(dateKey);
  if (grown >= 2) return null;
  if (grown === 0 && minutes >= a) return minutes >= b ? 2 : 1;
  if (grown === 1 && minutes >= b) return 2;
  return null;
}

/** A clover waits this long before she wanders over to eat it by herself, milliseconds. */
export const CLOVER_WAIT_MS = 90_000;
