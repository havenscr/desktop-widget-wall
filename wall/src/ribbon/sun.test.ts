import { expect, it } from 'vitest';
import { localMidnight, sunTimes } from './sun';
import { usePacificTime } from './testZone';

usePacificTime();

const MIN = 60_000;

// The almanac for this place on 2026-11-11 gives sunrise 7:08 AM and sunset 4:37 PM.
it('finds sunrise within two minutes of 7:08 AM and sunset within two minutes of 4:37 PM on 2026-11-11', () => {
  const day = Date.parse('2026-11-11T12:00:00-08:00');
  const { rise, set } = sunTimes(day);
  expect(Math.abs(rise! - Date.parse('2026-11-11T07:08:00-08:00'))).toBeLessThanOrEqual(2 * MIN);
  expect(Math.abs(set! - Date.parse('2026-11-11T16:37:00-08:00'))).toBeLessThanOrEqual(2 * MIN);
});

it('works from any time on the day, and across a DST change', () => {
  const a = sunTimes(Date.parse('2026-11-11T00:10:00-08:00'));
  const b = sunTimes(Date.parse('2026-11-11T23:50:00-08:00'));
  expect(a).toEqual(b);
  // 2026-11-01: clocks go back at 2 AM. Sunrise is still in the morning, sunset in the afternoon.
  const d = sunTimes(Date.parse('2026-11-01T12:00:00-08:00'));
  expect(new Date(d.rise!).getHours()).toBe(6);
  expect(new Date(d.set!).getHours()).toBe(16);
});

it('local midnight is the start of the local day', () => {
  expect(localMidnight(Date.parse('2026-11-11T16:36:00-08:00'))).toBe(Date.parse('2026-11-11T00:00:00-08:00'));
});
