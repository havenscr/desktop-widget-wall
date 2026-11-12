import { describeWeather, type WeatherLook } from './codes';

export const REFRESH_MS = 15 * 60 * 1000;

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
    high: Math.round(d.daily.temperature_2m_max[0]),
    low: Math.round(d.daily.temperature_2m_min[0]),
    hours,
    fetchedAt,
  };
}

/**
 * Refresh rule: fetch when nothing has been fetched yet, or when the last
 * attempt is 15 minutes old or more. The interval and the visibility handler
 * both ask this, so a page that comes back after a long hide fetches once.
 */
export function shouldRefresh(lastAttempt: number | null, now: number): boolean {
  return lastAttempt === null || now - lastAttempt >= REFRESH_MS;
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
