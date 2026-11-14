import { clockText } from '../meet/model';
import { describeWeather, type WeatherLook } from './codes';

export type WeatherFailure = 'network' | 'timeout' | `http ${number}` | 'parse' | 'dns' | 'connect' | 'tls' | 'read' | 'input';

/** Where a reading came from: the first source, or the United States National Weather Service. */
export type WeatherSource = 'open-meteo' | 'nws';

export const WEATHER_SOURCE_NAMES: Record<WeatherSource, string> = {
  'open-meteo': 'Open-Meteo',
  nws: 'the National Weather Service',
};

/**
 * The failure kinds the native read sends as its error text (`dns`, `connect`, `tls`, `timeout`,
 * `read`, `input`, `http <status>`); anything else is a plain `network` failure.
 */
export function failureFromError(error: unknown): WeatherFailure {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  if (['dns', 'connect', 'tls', 'timeout', 'read', 'input'].includes(text)) return text as WeatherFailure;
  const http = /^http (\d{3})$/.exec(text);
  return http ? `http ${Number(http[1])}` : 'network';
}

/**
 * Plain words for a failure. `retryAt` (epoch ms) is the next planned try after a 429, when
 * there is one.
 */
export function weatherFailureText(failure: WeatherFailure | null | undefined, retryAt?: number | null): string {
  if (failure === 'network') return 'Could not reach Open-Meteo.';
  if (failure === 'dns') return "This PC could not look up Open-Meteo's address.";
  if (failure === 'connect') return 'Open-Meteo refused the connection.';
  if (failure === 'tls') return 'The secure connection to Open-Meteo failed.';
  if (failure === 'timeout') return 'Open-Meteo did not answer in time.';
  if (failure === 'read') return 'The reply from Open-Meteo broke off before the end.';
  if (failure === 'input') return 'The place set for the weather is not valid.';
  if (failure === 'parse') return 'The weather reply could not be read.';
  if (failure === 'http 429') {
    return `Open-Meteo is refusing this address for now (too many requests).${retryAt ? ` Next try at ${clockText(retryAt)}.` : ''}`;
  }
  if (failure?.startsWith('http ')) return `Open-Meteo answered ${failure.slice(5)}.`;
  return 'The weather service did not answer.';
}

/** After a 429 the first source is left alone for 15 minutes, then 30, then 60 at most. */
export const BACKOFF_MS = [15 * 60_000, 30 * 60_000, 60 * 60_000] as const;

/** Failures after which the second source is asked: a refusal (429) or no way to reach the first. */
export function asksSecondSource(failure: WeatherFailure): boolean {
  return failure === 'http 429' || ['network', 'timeout', 'dns', 'connect', 'tls', 'read'].includes(failure);
}

export const REFRESH_MS = 15 * 60 * 1000;
/** Retry interval while there is still no reading at all. */
export const RETRY_MS = 60 * 1000;

export interface HourPoint {
  /** Local hour label such as "3 PM". */
  label: string;
  temp: number;
  look: WeatherLook;
}

export interface WeatherReading {
  temp: number;
  look: WeatherLook;
  high: number;
  low: number;
  hours: HourPoint[];
  /** Epoch ms when this reading was fetched. */
  fetchedAt: number;
  /** Which source it came from (absent reads as Open-Meteo). */
  source?: WeatherSource;
}

export function buildUrl(latitude: number, longitude: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    '&current=temperature_2m,weather_code,is_day' +
    '&hourly=temperature_2m,weather_code,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2'
  );
}

interface OpenMeteo {
  current: { time: string; temperature_2m: number; weather_code: number; is_day: number };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; is_day?: number[] };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
}

function hourLabel(isoLocal: string): string {
  const h = Number(isoLocal.slice(11, 13));
  const m = h % 12 === 0 ? 12 : h % 12;
  return `${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Turn an Open-Meteo response into a reading: now, today's range, the next six hours. */
export function parseWeather(data: unknown, fetchedAt: number): WeatherReading {
  const d = data as OpenMeteo;
  const cur = d.current;
  if (typeof cur?.temperature_2m !== 'number') throw new Error('Unexpected weather response');
  const hi = d.daily?.temperature_2m_max?.[0];
  const lo = d.daily?.temperature_2m_min?.[0];
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || !Array.isArray(d.hourly?.time)) {
    throw new Error('Incomplete weather response');
  }
  // Times are local to the place (timezone=auto) and share a format, so compare as strings.
  const nowHour = cur.time.slice(0, 13);
  const first = d.hourly.time.findIndex((t) => t.slice(0, 13) > nowHour);
  const start = first < 0 ? d.hourly.time.length : first;
  const hours: HourPoint[] = [];
  for (let i = start; i < d.hourly.time.length && hours.length < 6; i++) {
    hours.push({
      label: hourLabel(d.hourly.time[i]),
      temp: Math.round(d.hourly.temperature_2m[i]),
      look: describeWeather(d.hourly.weather_code[i], (d.hourly.is_day?.[i] ?? 1) === 1),
    });
  }
  return {
    temp: Math.round(cur.temperature_2m),
    look: describeWeather(cur.weather_code, cur.is_day === 1),
    high: Math.round(hi),
    low: Math.round(lo),
    hours,
    fetchedAt,
    source: 'open-meteo',
  };
}

/**
 * National Weather Service short forecast words to a WMO weather code the wall already knows
 * (`describeWeather`). The first row whose words are contained in the text wins, so the order
 * matters: precipitation, then fog, then cloud cover, then clear. No match is -1 ("Unknown").
 */
export const NWS_TABLE: ReadonlyArray<readonly [string, number]> = [
  ['thunder', 95],
  ['freezing rain', 66],
  ['sleet', 66],
  ['ice pellets', 66],
  ['freezing drizzle', 56],
  ['heavy snow', 75],
  ['blizzard', 75],
  ['light snow', 71],
  ['flurries', 71],
  ['snow showers', 85],
  ['snow', 73],
  ['heavy rain', 65],
  ['light rain', 61],
  ['showers', 81],
  ['drizzle', 51],
  ['rain', 63],
  ['fog', 45],
  ['mist', 45],
  ['mostly sunny', 1],
  ['mostly clear', 1],
  ['partly sunny', 2],
  ['partly cloudy', 2],
  ['mostly cloudy', 3],
  ['cloudy', 3],
  ['overcast', 3],
  ['sunny', 0],
  ['clear', 0],
];

export function nwsCode(shortForecast: string): number {
  const text = shortForecast.toLowerCase();
  const row = NWS_TABLE.find(([words]) => text.includes(words));
  return row ? row[1] : -1;
}

interface NwsPeriod {
  startTime: string;
  isDaytime?: boolean;
  temperature: number;
  temperatureUnit?: string;
  shortForecast?: string;
}

/**
 * Turn the Weather Service's hourly forecast into a reading. The first hour is "now"; today's
 * high and low come from that day's hours still ahead (so an evening reading's high is the
 * evening's highest hour); the strip is the next six hours. Times are local to the place.
 */
export function parseNws(data: unknown, fetchedAt: number): WeatherReading {
  const periods = (data as { properties?: { periods?: NwsPeriod[] } })?.properties?.periods;
  if (!Array.isArray(periods) || periods.length === 0) throw new Error('Unexpected weather response');
  const temp = (p: NwsPeriod) => {
    if (typeof p?.temperature !== 'number' || !Number.isFinite(p.temperature) || typeof p.startTime !== 'string') throw new Error('Incomplete weather response');
    return p.temperatureUnit === 'C' ? (p.temperature * 9) / 5 + 32 : p.temperature;
  };
  const look = (p: NwsPeriod) => describeWeather(nwsCode(p.shortForecast ?? ''), p.isDaytime !== false);
  const first = periods[0];
  const day = first.startTime.slice(0, 10);
  const today = periods.filter((p) => p.startTime?.slice(0, 10) === day).map(temp);
  const hours: HourPoint[] = periods.slice(1, 7).map((p) => ({ label: hourLabel(p.startTime), temp: Math.round(temp(p)), look: look(p) }));
  return {
    temp: Math.round(temp(first)),
    look: look(first),
    high: Math.round(Math.max(...today)),
    low: Math.round(Math.min(...today)),
    hours,
    fetchedAt,
    source: 'nws',
  };
}

/**
 * Refresh rule: fetch when nothing has been fetched yet, or when the last
 * attempt is 15 minutes old or more (one minute while there is no reading yet). The interval and the visibility handler
 * both ask this, so a page that comes back after a long hide fetches once.
 */
export function shouldRefresh(lastAttempt: number | null, now: number, hasReading = true): boolean {
  if (lastAttempt === null) return true;
  return now - lastAttempt >= (hasReading ? REFRESH_MS : RETRY_MS);
}

/** Small text for a reading that is older than a normal refresh; null while fresh. */
export function staleText(fetchedAt: number, now: number): string | null {
  const age = now - fetchedAt;
  if (age < REFRESH_MS + 60_000) return null;
  const mins = Math.floor(age / 60_000);
  if (mins < 60) return `updated ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? 'updated 1 hour ago' : `updated ${hrs} hours ago`;
}
