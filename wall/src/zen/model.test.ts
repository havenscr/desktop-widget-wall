import { expect, it } from 'vitest';
import {
  FLAME_ROTATE_MS,
  breathAt,
  ease,
  flamePair,
  formatLeft,
  dimDue,
  dimHint,
  hourLabel,
  isDimHour,
  showDimHint,
  sessionSecondsLeft,
} from './model';

it('breath phase, word, seconds left and scale across the 12 second cycle', () => {
  const at = (t: number) => breathAt(t);
  expect(at(0)).toMatchObject({ phase: 0, word: 'Breathe in', left: 4 });
  expect(at(0).scale).toBeCloseTo(0.8, 6);
  expect(at(1)).toMatchObject({ phase: 0, left: 3 });
  expect(at(1).scale).toBeCloseTo(0.8 + 0.26 * ease(0.25), 6);
  expect(at(2).scale).toBeCloseTo(0.8 + 0.26 * 0.5, 6);
  expect(at(3.5)).toMatchObject({ phase: 0, left: 1 });
  expect(at(4)).toMatchObject({ phase: 1, word: 'Hold', left: 2 });
  expect(at(4).scale).toBeCloseTo(1.06, 6);
  expect(at(5.5)).toMatchObject({ phase: 1, left: 1 });
  expect(at(6)).toMatchObject({ phase: 2, word: 'Breathe out', left: 6 });
  expect(at(6).scale).toBeCloseTo(1.06, 6);
  expect(at(9).scale).toBeCloseTo(0.8 + 0.26 * 0.5, 6);
  expect(at(11.9)).toMatchObject({ phase: 2, left: 1 });
  expect(at(12)).toMatchObject({ phase: 0, left: 4 });
  expect(at(12).scale).toBeCloseTo(0.8, 6);
});

it('wraps the cycle', () => {
  expect(breathAt(27).word).toBe('Breathe in'); // 27 % 12 = 3
  expect(breathAt(124).word).toBe('Hold'); // 124 % 12 = 4
  expect(breathAt(-5).word).toBe('Breathe in');
});

it('session countdown', () => {
  const start = 1_000_000;
  expect(sessionSecondsLeft(start, 3, start)).toBe(180);
  expect(sessionSecondsLeft(start, 3, start + 500)).toBe(180);
  expect(sessionSecondsLeft(start, 3, start + 1500)).toBe(179);
  expect(sessionSecondsLeft(start, 3, start + 180_000)).toBe(0);
  expect(sessionSecondsLeft(start, 3, start + 999_999)).toBe(0);
  expect(formatLeft(180)).toBe('3:00 left');
  expect(formatLeft(65)).toBe('1:05 left');
  expect(formatLeft(0)).toBe('0:00 left');
});

it('dim hours: the set hour to 6 AM local', () => {
  const t = (h: number, m: number) => new Date(2026, 10, 11, h, m);
  expect(isDimHour(t(21, 59), 22)).toBe(false);
  expect(isDimHour(t(22, 0), 22)).toBe(true);
  expect(isDimHour(t(23, 59), 22)).toBe(true);
  expect(isDimHour(t(0, 0), 22)).toBe(true);
  expect(isDimHour(t(5, 59), 22)).toBe(true);
  expect(isDimHour(t(6, 0), 22)).toBe(false);
  expect(isDimHour(t(12, 0), 22)).toBe(false);
  expect(isDimHour(t(19, 0), 18)).toBe(true);
});

it('dimDue needs a dim hour and the full quiet wait', () => {
  const now = new Date(2026, 10, 11, 22, 30);
  const ms = now.getTime();
  expect(dimDue(now, ms - 9 * 60_000, 22, 600_000)).toBe(false);
  expect(dimDue(now, ms - 10 * 60_000, 22, 600_000)).toBe(true);
  expect(dimDue(new Date(2026, 10, 11, 21, 30), ms - 99 * 60_000, 22, 600_000)).toBe(false);
});

it('the dim hint is written from the two values', () => {
  expect(hourLabel(22)).toBe('10 PM');
  expect(hourLabel(18)).toBe('6 PM');
  expect(hourLabel(0)).toBe('12 AM');
  expect(dimHint(22, 10)).toBe('Dims by itself after 10 PM and 10 quiet minutes');
  expect(dimHint(23, 1)).toBe('Dims by itself after 11 PM and 1 quiet minute');
  expect(showDimHint(new Date(2026, 10, 11, 17, 59))).toBe(false);
  expect(showDimHint(new Date(2026, 10, 11, 18, 0))).toBe(true);
  expect(showDimHint(new Date(2026, 10, 11, 3, 0))).toBe(true);
  expect(showDimHint(new Date(2026, 10, 11, 6, 0))).toBe(false);
});

it('flame rotation: the pair advances every few minutes round the list', () => {
  expect(flamePair(0, 3)).toEqual({ step: 0, base: 0, top: 1 });
  expect(flamePair(FLAME_ROTATE_MS - 1, 3)).toEqual({ step: 0, base: 0, top: 1 });
  expect(flamePair(FLAME_ROTATE_MS, 3)).toEqual({ step: 1, base: 1, top: 2 });
  expect(flamePair(2 * FLAME_ROTATE_MS, 3)).toEqual({ step: 2, base: 2, top: 0 });
  expect(flamePair(3 * FLAME_ROTATE_MS, 3)).toEqual({ step: 3, base: 0, top: 1 });
});
