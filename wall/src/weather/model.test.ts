import { expect, it } from 'vitest';
import { asksSecondSource, buildUrl, failureFromError, NWS_TABLE, nwsCode, parseNws, parseWeather, REFRESH_MS, shouldRefresh, staleText, weatherFailureText } from './model';

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

it('reads the failure kind the native side sends, and anything else as a network failure', () => {
  for (const k of ['dns', 'connect', 'tls', 'timeout', 'read', 'input']) expect(failureFromError(k)).toBe(k);
  expect(failureFromError('http 429')).toBe('http 429');
  expect(failureFromError('http 503')).toBe('http 503');
  expect(failureFromError(new Error('timeout'))).toBe('timeout');
  expect(failureFromError('http 4290')).toBe('network');
  expect(failureFromError('http 42')).toBe('network');
  expect(failureFromError('boom')).toBe('network');
  expect(failureFromError(undefined)).toBe('network');
});

it('has plain words for every failure kind', () => {
  expect(weatherFailureText('dns')).toBe("This PC could not look up Open-Meteo's address.");
  expect(weatherFailureText('connect')).toBe('Open-Meteo refused the connection.');
  expect(weatherFailureText('tls')).toBe('The secure connection to Open-Meteo failed.');
  expect(weatherFailureText('timeout')).toBe('Open-Meteo did not answer in time.');
  expect(weatherFailureText('read')).toBe('The reply from Open-Meteo broke off before the end.');
  expect(weatherFailureText('input')).toBe('The place set for the weather is not valid.');
  expect(weatherFailureText('parse')).toBe('The weather reply could not be read.');
  expect(weatherFailureText('network')).toBe('Could not reach Open-Meteo.');
  expect(weatherFailureText('http 500')).toBe('Open-Meteo answered 500.');
  expect(weatherFailureText(null)).toBe('The weather service did not answer.');
});

it('words a 429 as a refusal and names the next try when there is one', () => {
  expect(weatherFailureText('http 429')).toBe('Open-Meteo is refusing this address for now (too many requests).');
  const at = new Date(2026, 10, 14, 15, 15).getTime();
  expect(weatherFailureText('http 429', at)).toBe('Open-Meteo is refusing this address for now (too many requests). Next try at 3:15 PM.');
});

it('asks the second source only for a refusal or an unreachable first source', () => {
  for (const f of ['http 429', 'network', 'timeout', 'dns', 'connect', 'tls', 'read'] as const) expect(asksSecondSource(f)).toBe(true);
  for (const f of ['http 403', 'http 500', 'parse', 'input'] as const) expect(asksSecondSource(f)).toBe(false);
});

// One phrase per row of the table (the order of the rows is part of what is tested: a phrase that
// holds two rows' words takes the earlier row).
const NWS_PHRASES: [string, number][] = [
  ['Thunderstorms Likely', 95],
  ['Freezing Rain', 66],
  ['Sleet', 66],
  ['Ice Pellets', 66],
  ['Freezing Drizzle', 56],
  ['Heavy Snow', 75],
  ['Blizzard', 75],
  ['Light Snow Likely', 71],
  ['Snow Flurries', 71],
  ['Snow Showers', 85],
  ['Snow', 73],
  ['Heavy Rain', 65],
  ['Light Rain', 61],
  ['Chance Rain Showers', 81],
  ['Patchy Drizzle', 51],
  ['Rain Likely', 63],
  ['Patchy Fog', 45],
  ['Mist', 45],
  ['Mostly Sunny', 1],
  ['Mostly Clear', 1],
  ['Partly Sunny', 2],
  ['Partly Cloudy', 2],
  ['Mostly Cloudy', 3],
  ['Cloudy', 3],
  ['Overcast', 3],
  ['Sunny', 0],
  ['Clear', 0],
];

it('maps the Weather Service short forecast words through the table, one test per row', () => {
  // Every row has a phrase here and every phrase lands on its row's code.
  expect(NWS_PHRASES).toHaveLength(NWS_TABLE.length);
  NWS_PHRASES.forEach(([phrase, code], i) => {
    expect(nwsCode(phrase), phrase).toBe(code);
    expect(NWS_TABLE[i][1], phrase).toBe(code);
    expect(phrase.toLowerCase()).toContain(NWS_TABLE[i][0]);
  });
});

it('reads phrases that hold two rows words by the earlier row, and an unknown phrase as -1', () => {
  expect(nwsCode('Slight Chance Light Rain then Thunderstorms')).toBe(95);
  expect(nwsCode('Rain And Snow')).toBe(73);
  expect(nwsCode('Mostly Cloudy then Chance Light Snow')).toBe(71);
  expect(nwsCode('Areas Of Frost')).toBe(-1);
  expect(nwsCode('')).toBe(-1);
});

const nws = {
  properties: {
    periods: [
      { startTime: '2026-11-11T10:00:00-08:00', isDaytime: true, temperature: 51, temperatureUnit: 'F', shortForecast: 'Mostly Cloudy' },
      { startTime: '2026-11-11T11:00:00-08:00', isDaytime: true, temperature: 53, temperatureUnit: 'F', shortForecast: 'Light Rain' },
      { startTime: '2026-11-11T12:00:00-08:00', isDaytime: true, temperature: 55, temperatureUnit: 'F', shortForecast: 'Sunny' },
      { startTime: '2026-11-11T17:00:00-08:00', isDaytime: false, temperature: 47, temperatureUnit: 'F', shortForecast: 'Clear' },
      { startTime: '2026-11-11T18:00:00-08:00', isDaytime: false, temperature: 45, temperatureUnit: 'F', shortForecast: 'Clear' },
      { startTime: '2026-11-11T19:00:00-08:00', isDaytime: false, temperature: 44, temperatureUnit: 'F', shortForecast: 'Patchy Fog' },
      { startTime: '2026-11-11T20:00:00-08:00', isDaytime: false, temperature: 43, temperatureUnit: 'F', shortForecast: 'Clear' },
      { startTime: '2026-11-12T08:00:00-08:00', isDaytime: true, temperature: 70, temperatureUnit: 'F', shortForecast: 'Sunny' },
    ],
  },
};

it('turns the Weather Service hourly reply into a reading: now, today range, next six hours, the source', () => {
  const r = parseNws(nws, 1000);
  expect(r.temp).toBe(51);
  expect(r.look.label).toBe('Overcast');
  // Today's hours only: tomorrow's 70 is not today's high.
  expect([r.high, r.low]).toEqual([55, 43]);
  expect(r.hours.map((h) => h.label)).toEqual(['11 AM', '12 PM', '5 PM', '6 PM', '7 PM', '8 PM']);
  expect(r.hours.map((h) => h.temp)).toEqual([53, 55, 47, 45, 44, 43]);
  expect(r.hours[0].look.label).toBe('Light rain');
  // Night hours get the night icons.
  expect(r.hours[2].look.icon).toBe('moon');
  expect(r.fetchedAt).toBe(1000);
  expect(r.source).toBe('nws');
});

it('converts a Celsius reply and marks an Open-Meteo reading with its source', () => {
  const c = { properties: { periods: [{ startTime: '2026-11-11T10:00:00-08:00', isDaytime: true, temperature: 10, temperatureUnit: 'C', shortForecast: 'Sunny' }] } };
  expect(parseNws(c, 0).temp).toBe(50);
  expect(parseWeather(sample, 0).source).toBe('open-meteo');
});

it('rejects a Weather Service reply without hours or with a bad temperature', () => {
  expect(() => parseNws({}, 0)).toThrow();
  expect(() => parseNws({ properties: { periods: [] } }, 0)).toThrow();
  expect(() => parseNws({ properties: { periods: [{ startTime: '2026-11-11T10:00:00-08:00', temperature: 'warm' }] } }, 0)).toThrow();
});
