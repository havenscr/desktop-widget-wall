import { expect, it } from 'vitest';
import { buildUrl, parseWeather, REFRESH_MS, shouldRefresh, staleText } from './model';

const sample = {
  current: { time: '2026-11-11T10:15', temperature_2m: 57.6, weather_code: 3, is_day: 1 },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => `2026-11-11T${String(i).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 24 }, (_, i) => 40 + i),
    weather_code: Array.from({ length: 24 }, () => 61),
    is_day: Array.from({ length: 24 }, (_, i) => (i >= 7 && i < 17 ? 1 : 0)),
  },
  daily: { temperature_2m_max: [61.4], temperature_2m_min: [44.2] },
};

it('builds the request the old app uses', () => {
  const u = buildUrl(47.68, -122.21);
  expect(u).toContain('latitude=47.68&longitude=-122.21');
  expect(u).toContain('temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto');
});

it('parses now, today range and the next six hours', () => {
  const r = parseWeather(sample, 1000);
  expect(r.temp).toBe(58);
  expect(r.look.label).toBe('Overcast');
  expect([r.high, r.low]).toEqual([61, 44]);
  expect(r.hours.map((h) => h.label)).toEqual(['11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM']);
  expect(r.hours[0].temp).toBe(51);
  expect(r.fetchedAt).toBe(1000);
});

it('rejects a malformed response', () => {
  expect(() => parseWeather({}, 0)).toThrow();
});

it('refreshes when never fetched or 15 minutes old', () => {
  expect(shouldRefresh(null, 5)).toBe(true);
  expect(shouldRefresh(0, REFRESH_MS - 1)).toBe(false);
  expect(shouldRefresh(0, REFRESH_MS)).toBe(true);
});

it('words the age of an old reading', () => {
  const min = 60_000;
  expect(staleText(0, 10 * min)).toBeNull();
  expect(staleText(0, 15 * min)).toBeNull();
  expect(staleText(0, 40 * min)).toBe('updated 40 min ago');
  expect(staleText(0, 60 * min)).toBe('updated 1 hour ago');
  expect(staleText(0, 190 * min)).toBe('updated 3 hours ago');
});

it('treats a missing or short daily array as a parse failure', () => {
  expect(() => parseWeather({ ...sample, daily: { temperature_2m_max: [], temperature_2m_min: [] } }, 0)).toThrow();
  expect(() => parseWeather({ ...sample, daily: undefined }, 0)).toThrow();
});

it('retries every minute while there is no reading', () => {
  expect(shouldRefresh(0, 59_000, false)).toBe(false);
  expect(shouldRefresh(0, 60_000, false)).toBe(true);
  expect(shouldRefresh(0, 60_000, true)).toBe(false);
});
