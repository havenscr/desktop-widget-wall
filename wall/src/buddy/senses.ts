import type { Lane } from '../agents/model';
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

/** The part of the day, as a topic: morning to 11:00, midday to 14:00, afternoon to 18:00, evening to 22:00, then late. */
export function dayTopic(hour: number): Topic {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'late';
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
  for (const l of lanes) if (l.state === 'working' && !l.waiting) out.add(l.id);
  return out;
}

/**
 * How many agents finished between two answers: lanes that were working and are now gone, or have
 * reached a pull request or gone live, without waiting for an answer.
 */
export function finishedBetween(before: ReadonlySet<string>, lanes: readonly Lane[]): number {
  let n = 0;
  for (const id of before) {
    const l = lanes.find((x) => x.id === id);
    if (!l) n++;
    else if (!l.waiting && l.state !== 'blocked' && (l.stage === 'pr' || l.stage === 'live') && l.state !== 'working') n++;
  }
  return n;
}

/** Two clover times a day, minutes after midnight, different each date (10:00 to 12:00 and 15:00 to 16:30). */
export function cloverTimes(dateKey: string): [number, number] {
  let h = 7;
  for (let i = 0; i < dateKey.length; i++) h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
  return [10 * 60 + (h % 120), 15 * 60 + ((h >>> 8) % 90)];
}

/** A clover waits this long before she wanders over to eat it by herself, milliseconds. */
export const CLOVER_WAIT_MS = 90_000;
