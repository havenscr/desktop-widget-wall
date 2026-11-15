import { expect, it } from 'vitest';
import { asksSecondSource, failureFromError, isWindy, NWS_TABLE, nwsCode, parseNws, parseWeather, rainLevel, REFRESH_MS, shouldRefresh, staleText, weatherFailureText } from './model';

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
  expect(staleText(0, 60 * min)).toBe('updated 1 h ago');
  expect(staleText(0, 190 * min)).toBe('updated 3 h ago');
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
  ['Wintry Mix', 66],
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
  ['Areas Of Haze', 45],
  ['Smoke', 45],
  ['Mostly Sunny', 1],
  ['Mostly Clear', 1],
  ['Partly Sunny', 2],
  ['Partly Cloudy', 2],
  ['Mostly Cloudy', 3],
  ['Cloudy', 3],
  ['Overcast', 3],
  ['Sunny', 0],
  ['Clear', 0],
  ['Patchy Frost', 0],
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
  expect(nwsCode('Blowing Dust')).toBe(-1);
  // Frost with clouds reads as the clouds, frost alone as clear.
  expect(nwsCode('Areas Of Frost then Mostly Cloudy')).toBe(3);
  expect(nwsCode('Areas Of Frost')).toBe(0);
  expect(nwsCode('')).toBe(-1);
});

const hour = (iso: string, temperature: number, shortForecast = 'Sunny', isDaytime = true, temperatureUnit = 'F') => ({ startTime: iso, isDaytime, temperature, temperatureUnit, shortForecast });
const hourly = (periods: ReturnType<typeof hour>[]) => ({ properties: { periods } });

// A morning answer: 8 AM, the hours of the rest of the day, and the 12 hour forecast starting at "Today".
const morningHours = [
  hour('2026-11-11T08:00:00-08:00', 51, 'Mostly Cloudy'),
  hour('2026-11-11T09:00:00-08:00', 53, 'Light Rain'),
  hour('2026-11-11T10:00:00-08:00', 55),
  hour('2026-11-11T17:00:00-08:00', 47, 'Clear', false),
  hour('2026-11-11T18:00:00-08:00', 45, 'Clear', false),
  hour('2026-11-11T19:00:00-08:00', 44, 'Patchy Fog', false),
  hour('2026-11-11T20:00:00-08:00', 43, 'Clear', false),
  hour('2026-11-12T08:00:00-08:00', 70),
];
const morningForecast = hourly([
  hour('2026-11-11T06:00:00-08:00', 58, 'Partly Sunny'),
  hour('2026-11-11T18:00:00-08:00', 41, 'Mostly Clear', false),
  hour('2026-11-12T06:00:00-08:00', 66, 'Sunny'),
]);

it('turns the Weather Service reply into a reading: now, today range, next six hours, the source', () => {
  const r = parseNws({ hourly: hourly(morningHours), forecast: morningForecast }, 1000);
  expect(r.temp).toBe(51);
  expect(r.look.label).toBe('Overcast');
  // The 12 hour forecast: today's daytime period is the high, tonight's period the low.
  expect([r.high, r.low]).toEqual([58, 41]);
  expect(r.hours.map((h) => h.label)).toEqual(['9 AM', '10 AM', '5 PM', '6 PM', '7 PM', '8 PM']);
  expect(r.hours.map((h) => h.temp)).toEqual([53, 55, 47, 45, 44, 43]);
  expect(r.hours[0].look.label).toBe('Light rain');
  // Night hours get the night icons.
  expect(r.hours[2].look.icon).toBe('moon');
  expect(r.fetchedAt).toBe(1000);
  expect(r.source).toBe('nws');
});

it('in the afternoon the high is the afternoon period of the forecast', () => {
  const afternoon = [hour('2026-11-11T15:00:00-08:00', 57), hour('2026-11-11T16:00:00-08:00', 56), hour('2026-11-11T17:00:00-08:00', 54)];
  const forecast = hourly([
    hour('2026-11-11T14:00:00-08:00', 60, 'Sunny'),
    hour('2026-11-11T18:00:00-08:00', 43, 'Clear', false),
    hour('2026-11-12T06:00:00-08:00', 62),
  ]);
  const r = parseNws({ hourly: hourly(afternoon), forecast }, 0);
  expect([r.temp, r.high, r.low]).toEqual([57, 60, 43]);
});

it('late in the evening the high is the larger of now and the highest reading seen today, the low is tonight', () => {
  const evening = [hour('2026-11-11T23:00:00-08:00', 44, 'Clear', false), hour('2026-11-12T00:00:00-08:00', 43, 'Clear', false), hour('2026-11-12T01:00:00-08:00', 42, 'Clear', false)];
  // The forecast starts at "Tonight": today's daytime period has passed.
  const forecast = hourly([
    hour('2026-11-11T18:00:00-08:00', 41, 'Clear', false),
    hour('2026-11-12T06:00:00-08:00', 59, 'Sunny'),
    hour('2026-11-12T18:00:00-08:00', 40, 'Clear', false),
  ]);
  // Nothing seen earlier today (after a restart): the high is the temperature now, never "high equals low equals now" by accident.
  const none = parseNws({ hourly: hourly(evening), forecast }, 0);
  expect([none.temp, none.high, none.low]).toEqual([44, 44, 41]);
  // A reading of 57 was seen this afternoon.
  const seen = parseNws({ hourly: hourly(evening), forecast }, 0, 57);
  expect([seen.temp, seen.high, seen.low]).toEqual([44, 57, 41]);
  // A seen value under the temperature now never lowers the high.
  expect(parseNws({ hourly: hourly(evening), forecast }, 0, 30).high).toBe(44);
});

it('one malformed forecast period gives its value to the fallback; the reading is still made', () => {
  const afternoon = [hour('2026-11-11T15:00:00-08:00', 57), hour('2026-11-11T16:00:00-08:00', 56), hour('2026-11-11T17:00:00-08:00', 54)];
  const bad = (p: ReturnType<typeof hour>) => ({ ...p, temperature: 'x' as unknown as number });
  const day = bad(hour('2026-11-11T14:00:00-08:00', 60, 'Sunny'));
  const night = hour('2026-11-11T18:00:00-08:00', 43, 'Clear', false);
  // The day period is malformed: the high comes from now and the hours seen, the low from the night period.
  const noDay = parseNws({ hourly: hourly(afternoon), forecast: hourly([day, night]) }, 0, 59);
  expect([noDay.temp, noDay.high, noDay.low]).toEqual([57, 59, 43]);
  // The night period is malformed: the low comes from the hours still ahead.
  const noNight = parseNws({ hourly: hourly(afternoon), forecast: hourly([hour('2026-11-11T14:00:00-08:00', 60, 'Sunny'), bad(night)]) }, 0);
  expect([noNight.high, noNight.low]).toEqual([60, 54]);
  // An empty slot in the list is skipped the same way.
  const hole = parseNws({ hourly: hourly(afternoon), forecast: { properties: { periods: [null, hour('2026-11-11T14:00:00-08:00', 60, 'Sunny')] } } }, 0);
  expect([hole.high, hole.low]).toEqual([60, 54]);
  // A malformed current or hourly period still fails the reading: there is nothing to fall back to.
  expect(() => parseNws({ hourly: hourly([bad(hour('2026-11-11T15:00:00-08:00', 57))]), forecast: hourly([night]) }, 0)).toThrow();
});

it('reads the forecast in either unit, and never puts the high under now or the low over it', () => {
  const c = (t: number) => ({ temperature: t, temperatureUnit: 'C' });
  const evening = hourly([{ ...hour('2026-11-11T23:00:00-08:00', 0, 'Clear', false), ...c(10) }, { ...hour('2026-11-12T00:00:00-08:00', 0, 'Clear', false), ...c(9) }]);
  const forecast = hourly([{ ...hour('2026-11-11T18:00:00-08:00', 0, 'Clear', false), ...c(5) }, { ...hour('2026-11-12T06:00:00-08:00', 0), ...c(15) }]);
  // 10 C is 50 F, 5 C is 41 F; today's daytime period has passed, so the high is now (50) when nothing was seen.
  const r = parseNws({ hourly: evening, forecast }, 0);
  expect([r.temp, r.high, r.low]).toEqual([50, 50, 41]);
  // A morning in Celsius: day 14 C is 57 F, night 4 C is 39 F.
  const morning = hourly([{ ...hour('2026-11-11T08:00:00-08:00', 0), ...c(8) }]);
  const fc = hourly([{ ...hour('2026-11-11T06:00:00-08:00', 0), ...c(14) }, { ...hour('2026-11-11T18:00:00-08:00', 0, 'Clear', false), ...c(4) }]);
  const m = parseNws({ hourly: morning, forecast: fc }, 0);
  expect([m.temp, m.high, m.low]).toEqual([46, 57, 39]);
  // A forecast that says today's high is under the temperature now does not show a high under it.
  const warm = parseNws({ hourly: hourly([hour('2026-11-11T15:00:00-08:00', 62)]), forecast: hourly([hour('2026-11-11T14:00:00-08:00', 58), hour('2026-11-11T18:00:00-08:00', 40, 'Clear', false)]) }, 0);
  expect([warm.high, warm.low]).toEqual([62, 40]);
});

it('without the 12 hour forecast the high and low come from the hours still ahead, and the plain hourly reply still reads', () => {
  const r = parseNws({ hourly: hourly(morningHours), forecast: null }, 0);
  expect([r.high, r.low]).toEqual([55, 43]);
  const plain = parseNws(hourly(morningHours), 0);
  expect([plain.high, plain.low]).toEqual([55, 43]);
  // With nothing but the hour left, the high can still take a reading seen today.
  const late = hourly([hour('2026-11-11T23:00:00-08:00', 44, 'Clear', false)]);
  expect(parseNws({ hourly: late, forecast: null }, 0, 57).high).toBe(57);
});

it('marks an Open-Meteo reading with its source', () => {
  expect(parseWeather(sample, 0).source).toBe('open-meteo');
});

it('rejects a Weather Service reply without hours or with a bad temperature', () => {
  expect(() => parseNws({}, 0)).toThrow();
  expect(() => parseNws({ properties: { periods: [] } }, 0)).toThrow();
  expect(() => parseNws({ properties: { periods: [{ startTime: '2026-11-11T10:00:00-08:00', temperature: 'warm' }] } }, 0)).toThrow();
});

const withWind = (cur: Record<string, unknown>, units?: Record<string, unknown>) => ({
  ...sample,
  current: { ...sample.current, ...cur },
  ...(units ? { current_units: units } : {}),
});

it('reads the wind from the first source and drops every unusable value', () => {
  expect(parseWeather(withWind({ wind_speed_10m: 22, wind_gusts_10m: 34 }), 0).wind).toEqual({ speed: 22, gust: 34 });
  for (const bad of [null, '22', -1, Number.NaN, 201, Infinity, {}]) {
    expect(parseWeather(withWind({ wind_speed_10m: bad, wind_gusts_10m: 34 }), 0).wind).toEqual({ gust: 34 });
  }
  for (const bad of [null, '34', -1, Number.NaN, 251]) {
    expect(parseWeather(withWind({ wind_speed_10m: 22, wind_gusts_10m: bad }), 0).wind).toEqual({ speed: 22 });
  }
  expect(parseWeather(withWind({ wind_speed_10m: 200, wind_gusts_10m: 250 }), 0).wind).toEqual({ speed: 200, gust: 250 });
  expect(parseWeather(withWind({ wind_speed_10m: 0 }), 0).wind).toEqual({ speed: 0 });
  expect(parseWeather(withWind({ wind_speed_10m: null, wind_gusts_10m: 'x' }), 0).wind).toBeUndefined();
});

it('a reply in another wind unit counts as no wind, an mp/h reply stays', () => {
  const cur = { wind_speed_10m: 22, wind_gusts_10m: 34 };
  expect(parseWeather(withWind(cur, { wind_speed_10m: 'km/h' }), 0).wind).toEqual({ gust: 34 });
  expect(parseWeather(withWind(cur, { wind_gusts_10m: 'm/s' }), 0).wind).toEqual({ speed: 22 });
  expect(parseWeather(withWind(cur, { wind_speed_10m: 'mp/h', wind_gusts_10m: 'mp/h' }), 0).wind).toEqual({ speed: 22, gust: 34 });
  expect(parseWeather(withWind(cur, {}), 0).wind).toEqual({ speed: 22, gust: 34 });
  expect(parseWeather(withWind(cur, 'weird' as unknown as Record<string, unknown>), 0).wind).toEqual({ speed: 22, gust: 34 });
});

it('a reply without wind fields parses as before and keeps the code', () => {
  const r = parseWeather(sample, 0);
  expect('wind' in r).toBe(false);
  expect(r.code).toBe(3);
  expect(parseWeather(withWind({ weather_code: 61.5 }), 0).code).toBe(-1);
  expect(parseWeather(withWind({ weather_code: 'x' }), 0).code).toBe(-1);
  expect(parseWeather(withWind({ weather_code: 65 }), 0).code).toBe(65);
});

const nwsHourly = (extra: Record<string, unknown>, words = 'Light Rain') => ({
  properties: { periods: Array.from({ length: 8 }, (_, i) => ({ startTime: `2026-11-11T${String(10 + i).padStart(2, '0')}:00:00-08:00`, isDaytime: true, temperature: 40, temperatureUnit: 'F', shortForecast: words, ...(i === 0 ? extra : {}) })) },
});

it('reads the Weather Service wind text and keeps the code', () => {
  expect(parseNws(nwsHourly({ windSpeed: '15 mph' }), 0).wind).toEqual({ speed: 15 });
  expect(parseNws(nwsHourly({ windSpeed: '10 to 20 mph' }), 0).wind).toEqual({ speed: 20 });
  expect(parseNws(nwsHourly({ windSpeed: ' 8 MPH ', windGust: '35 mph' }), 0).wind).toEqual({ speed: 8, gust: 35 });
  for (const bad of ['calm', '15 km/h', 15, null, '', '1500 mph', '300 mph', '15 mph and more']) {
    expect(parseNws(nwsHourly({ windSpeed: bad }), 0).wind).toBeUndefined();
  }
  expect(parseNws(nwsHourly({ windSpeed: '15 mph', windGust: 40 }), 0).wind).toEqual({ speed: 15 });
  expect(parseNws(nwsHourly({}), 0).wind).toBeUndefined();
  expect(parseNws(nwsHourly({}), 0).code).toBe(61);
  expect(parseNws(nwsHourly({}, 'Heavy Rain'), 0).code).toBe(65);
  expect(parseNws(nwsHourly({}, 'Strange'), 0).code).toBe(-1);
});

it('is very windy from a gust of 30 or a speed of 20, holds down to 24 and 16, and is off when unknown', () => {
  expect(isWindy(false, undefined)).toBe(false);
  expect(isWindy(true, undefined)).toBe(false);
  expect(isWindy(false, {})).toBe(false);
  expect(isWindy(false, { gust: 30 })).toBe(true);
  expect(isWindy(false, { gust: 29.9 })).toBe(false);
  expect(isWindy(false, { speed: 20 })).toBe(true);
  expect(isWindy(false, { speed: 19, gust: 28 })).toBe(false);
  // the hold
  expect(isWindy(true, { gust: 24 })).toBe(true);
  expect(isWindy(true, { gust: 23 })).toBe(false);
  expect(isWindy(true, { speed: 16 })).toBe(true);
  expect(isWindy(true, { speed: 15, gust: 20 })).toBe(false);
  expect(isWindy(true, { speed: 15 })).toBe(false);
});

it('maps WMO codes to a rain strength', () => {
  for (const c of [51, 53, 55, 56, 57, 61, 80]) expect(rainLevel(c)).toBe(0);
  for (const c of [63, 66, 67, 81]) expect(rainLevel(c)).toBe(0.5);
  for (const c of [65, 82, 95, 96, 99]) expect(rainLevel(c)).toBe(1);
  for (const c of [-1, 0, 3, 45, 71, 75, 85, 100]) expect(rainLevel(c)).toBe(-1);
});
