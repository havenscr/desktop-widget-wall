import { expect, it } from 'vitest';
import { sun } from '../horizon/renderer';
import { SUNDOWN_AFTER_MS, SUNDOWN_BEFORE_MS, SUNDOWN_MINUTES, isZenMode, sundownLabel, sundownRange, sundownSkyMs, sunsetMs } from './modes';

const NOON = new Date(2026, 10, 11, 12, 0, 0).getTime();
const EVENING = new Date(2026, 10, 11, 17, 0, 0).getTime();
const LATE = new Date(2026, 10, 11, 23, 30, 0).getTime();

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
  expect(isZenMode('summit')).toBe(false);
});
