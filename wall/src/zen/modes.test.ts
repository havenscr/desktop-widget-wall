import { expect, it } from 'vitest';
import { sun } from '../horizon/renderer';
import { HOME_TZ, SUNDOWN_AFTER_MS, SUNDOWN_BEFORE_MS, SUNDOWN_MINUTES, homeDayStart, isZenMode, sundownLabel, sundownRange, sundownSkyMs, sunsetMs } from './modes';

// Fixed instants, so no result depends on the zone this machine is set to (run under TZ=UTC and TZ=America/Los_Angeles).
const NOON = Date.UTC(2026, 10, 11, 20, 0); // 12:00 PST, Nov 11
const EVENING = Date.UTC(2026, 10, 12, 0, 50); // 4:50 PM PST, Nov 11: a little after sunset
const LATE = Date.UTC(2026, 10, 12, 7, 30); // 11:30 PM PST, Nov 11

const home = (ms: number) => {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: HOME_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

it('finds the evening sunset of the local day, with the sun just under the horizon after it', () => {
  const set = sunsetMs(NOON, sun);
  expect(set).toBeGreaterThan(NOON);
  expect(sun(set - 120_000).alt).toBeGreaterThan(-0.5);
  expect(sun(set + 120_000).alt).toBeLessThan(0.5);
  expect(sun(set).az).toBeGreaterThan(180);
});

it('the sky clock runs from 35 minutes before sunset to 60 minutes after it', () => {
  const set = sunsetMs(NOON, sun);
  const r = sundownRange(NOON, sun);
  expect(r.from).toBe(set - SUNDOWN_BEFORE_MS);
  expect(r.to).toBe(set + SUNDOWN_AFTER_MS);
  expect(sundownSkyMs(NOON, 0, sun)).toBe(r.from);
  expect(sundownSkyMs(NOON, 1, sun)).toBe(r.to);
  expect(sun(sundownSkyMs(NOON, 1, sun)).alt).toBeLessThan(-8);
});

it('starts from the real time when it is already inside that window', () => {
  const r = sundownRange(EVENING, sun);
  const set = sunsetMs(EVENING, sun);
  if (EVENING >= set - SUNDOWN_BEFORE_MS && EVENING <= set + SUNDOWN_AFTER_MS) expect(r.from).toBe(EVENING);
  const inside = set - 10 * 60_000;
  expect(sundownRange(inside, sun)).toEqual({ from: inside, to: set + SUNDOWN_AFTER_MS });
});

it('a real hour after the window still runs the whole window (a false sky, said in the caption)', () => {
  const set = sunsetMs(LATE, sun);
  expect(sundownRange(LATE, sun)).toEqual({ from: set - SUNDOWN_BEFORE_MS, to: set + SUNDOWN_AFTER_MS });
});

it('progress is clamped and the clock only moves forward', () => {
  let prev = -Infinity;
  for (let p = -0.5; p <= 1.5; p += 0.1) {
    const ms = sundownSkyMs(NOON, p, sun);
    expect(ms).toBeGreaterThanOrEqual(prev);
    prev = ms;
  }
  expect(sundownSkyMs(NOON, -1, sun)).toBe(sundownSkyMs(NOON, 0, sun));
  expect(sundownSkyMs(NOON, 2, sun)).toBe(sundownSkyMs(NOON, 1, sun));
});

it('a sun that never sets keeps a day long window from the start', () => {
  const never = () => ({ alt: 20, az: 200 });
  expect(sunsetMs(NOON, never)).toBe(0);
  expect(sundownRange(NOON, never).from).toBe(NOON);
});

it('lengths, label and mode check', () => {
  expect([...SUNDOWN_MINUTES]).toEqual([10, 20, 30]);
  expect(sundownLabel(20)).toBe('TWENTY MINUTES OF SUNDOWN');
  expect(isZenMode('sundown')).toBe(true);
  expect(isZenMode('summit')).toBe(true);
  expect(isZenMode('candle')).toBe(false);
});

it('the sunset is the home zone\'s evening of that day, in any machine zone', () => {
  expect(home(sunsetMs(NOON, sun))).toMatch(/^2026-11-11 16:[0-5]\d$/);
  // 6 PM PST on Nov 11 is already Nov 12 in UTC: still the Nov 11 sunset, not the next day's.
  const sixPm = Date.UTC(2026, 10, 12, 2, 0);
  expect(home(sunsetMs(sixPm, sun))).toMatch(/^2026-11-11 16:[0-5]\d$/);
  // 1 AM PST on Nov 11 is Nov 11 in the home zone, though already Nov 11 UTC at 9: same sunset as noon.
  expect(sunsetMs(Date.UTC(2026, 10, 11, 9, 0), sun)).toBe(sunsetMs(NOON, sun));
});

it('the day starts at home midnight, including on the two days the clocks change', () => {
  expect(home(homeDayStart(NOON))).toBe('2026-11-11 00:00');
  expect(home(homeDayStart(Date.UTC(2026, 10, 1, 20, 0)))).toBe('2026-11-01 00:00'); // fall back, 25 hours
  expect(home(homeDayStart(Date.UTC(2026, 2, 8, 22, 0)))).toBe('2026-03-08 00:00'); // spring forward, 23 hours
  expect(home(homeDayStart(Date.UTC(2026, 2, 9, 3, 0)))).toBe('2026-03-08 00:00'); // 8 PM PDT Mar 8, still that day
  for (const d of [Date.UTC(2026, 10, 1, 20, 0), Date.UTC(2026, 2, 8, 22, 0)]) expect(home(sunsetMs(d, sun))).toMatch(/ 1[6-9]:\d\d$/);
});
