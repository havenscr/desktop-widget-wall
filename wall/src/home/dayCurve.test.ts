import { expect, it } from 'vitest';
import { usePacificTime } from '../ribbon/testZone';
import { sunTimes } from '../ribbon/sun';
import { CURVE_BASE, CURVE_DIP, CURVE_H, CURVE_HUMP, CURVE_W, curveGeometry, dayCurve, labelSpots } from './dayCurve';

usePacificTime();

const at = (day: string, t: string) => Date.parse(`${day}T${t}-0${day.startsWith('2026-06') ? 7 : 8}:00`);
const NOV = '2026-11-11';

// A day from 07:13 to 16:33, as fractions of 24 hours.
const RISE = (7 + 13 / 60) / 24;
const SET = (16 + 33 / 60) / 24;
const g = (hours: number) => curveGeometry(RISE, SET, hours / 24);

it('crosses the base line at sunrise and sunset, with the box 458 by 83', () => {
  const geo = g(12);
  expect(geo.xRise).toBeCloseTo(CURVE_W * RISE, 6);
  expect(geo.xSet).toBeCloseTo(CURVE_W * SET, 6);
  expect(CURVE_BASE).toBe(62);
  expect(CURVE_H).toBe(83);
  // The first and last points of the day stroke are on the base line.
  const nums = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const day = nums(geo.day);
  expect(day[0][1]).toBeCloseTo(CURVE_BASE, 1);
  expect(day[day.length - 1][1]).toBeCloseTo(CURVE_BASE, 1);
  expect(Math.min(...day.map((p) => p[1]))).toBeGreaterThanOrEqual(CURVE_BASE - CURVE_HUMP - 0.01);
  // The night parts start at midnight and end at it, on the same dip level.
  const before = nums(geo.nightBefore);
  const after = nums(geo.nightAfter);
  expect(before[0][0]).toBe(0);
  expect(after[after.length - 1][0]).toBeCloseTo(CURVE_W, 0);
  expect(before[0][1]).toBeCloseTo(after[after.length - 1][1], 0);
  expect(Math.max(...after.map((p) => p[1]))).toBeLessThanOrEqual(CURVE_BASE + CURVE_DIP + 0.01);
});

it('places the sun by the time of day, on the hump by day and on the dip at night', () => {
  const table: [number, 'before' | 'day' | 'after'][] = [[0, 'before'], [5, 'before'], [7.5, 'day'], [10.47, 'day'], [12, 'day'], [16.4, 'day'], [16.6, 'after'], [21.17, 'after'], [23.9, 'after']];
  for (const [h, phase] of table) {
    const geo = g(h);
    expect(geo.phase).toBe(phase);
    expect(geo.xSun).toBeCloseTo((CURVE_W * h) / 24, 6);
    if (phase === 'day') expect(geo.ySun).toBeLessThan(CURVE_BASE);
    else expect(geo.ySun).toBeGreaterThan(CURVE_BASE);
  }
  // Highest at the middle of the daylight, deepest at the middle of the night.
  expect(g(((RISE + SET) / 2) * 24).ySun).toBeCloseTo(CURVE_BASE - CURVE_HUMP, 4);
  expect(g(((RISE + SET + 1) / 2) * 24 - 12).ySun).toBeLessThan(CURVE_BASE + CURVE_DIP + 0.01);
});

it('travelled part: nothing before sunrise, up to the sun by day, the whole day after sunset', () => {
  expect(g(5).travelled).toBe(0);
  expect(g(10.47).travelled).toBeCloseTo((CURVE_W * 10.47) / 24, 6);
  expect(g(21).travelled).toBeCloseTo(CURVE_W * SET, 6);
});

it('gives the curve from the horizon sun with words for the hover card and a screen reader', () => {
  const c = dayCurve(at(NOV, '10:28:00'))!;
  const { rise } = sunTimes(at(NOV, '10:28:00'));
  expect(c.phase).toBe('day');
  expect(c.riseText).toMatch(/^7:\d\d AM$/);
  expect(c.setText).toMatch(/^4:\d\d PM$/);
  expect(c.length).toMatch(/^9 h \d+ min$/);
  expect(c.alt).toBe(`Sunrise ${c.riseText}, sunset ${c.setText}, the sun is before its highest point`);
  expect(c.tip).toBe(`Sunrise ${c.riseText}, sunset ${c.setText}. ${c.length} of daylight today.`);
  expect(c.xRise).toBeCloseTo((CURVE_W * (rise! - at(NOV, '00:00:00'))) / 86_400_000, 0);
  expect(dayCurve(at(NOV, '13:30:00'))!.alt).toMatch(/past its highest point$/);
  expect(dayCurve(at(NOV, '21:10:00'))!.alt).toMatch(/the sun has set$/);
  expect(dayCurve(at(NOV, '05:00:00'))!.alt).toMatch(/the sun has not risen yet$/);
});

it('keeps both labels inside the box on a short winter day and a long summer day', () => {
  for (const day of ['2026-12-21', '2026-06-21']) {
    const c = dayCurve(Date.parse(`${day}T12:00:00-0${day.startsWith('2026-06') ? 7 : 8}:00`))!;
    const { rise, set } = labelSpots(c.xRise, c.xSet, c.riseText, c.setText);
    // Estimated widths: 9.6 px a character, 26 px more for the glyph.
    const w = (t: string, compact: boolean) => t.length * 9.6 + (compact ? 0 : 26);
    const riseLeft = rise.side === 'right' ? CURVE_W - rise.px - w(c.riseText, rise.compact) : rise.px;
    const setLeft = set.side === 'left' ? set.px : CURVE_W - set.px - w(c.setText, set.compact);
    expect(riseLeft).toBeGreaterThanOrEqual(0);
    expect(setLeft + w(c.setText, set.compact)).toBeLessThanOrEqual(CURVE_W + 0.01);
    // The two labels never meet.
    expect(riseLeft + w(c.riseText, rise.compact)).toBeLessThan(setLeft);
  }
});

it('drops the glyph, then holds the label in the box, when a crossing is near an edge', () => {
  const near = labelSpots(40, 400, '4:20 AM', '9:35 PM');
  expect(near.rise).toEqual({ side: 'left', px: 0, compact: true });
  expect(near.set.compact).toBe(true);
  const roomy = labelSpots(140, 300, '7:13 AM', '4:33 PM');
  expect(roomy.rise).toEqual({ side: 'right', px: CURVE_W - 140 + 12, compact: false });
  expect(roomy.set).toEqual({ side: 'left', px: 312, compact: false });
});
