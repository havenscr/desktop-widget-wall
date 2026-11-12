import { expect, it } from 'vitest';
import {
  FLAME_ROTATE_MS,
  breathAt,
  ease,
  flamePair,
  formatLeft,
  isDreamTime,
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

it('night rule: 9:30 PM to 6:30 AM local', () => {
  const t = (h: number, m: number) => new Date(2026, 10, 11, h, m);
  expect(isDreamTime(t(21, 29))).toBe(false);
  expect(isDreamTime(t(21, 30))).toBe(true);
  expect(isDreamTime(t(23, 59))).toBe(true);
  expect(isDreamTime(t(0, 0))).toBe(true);
  expect(isDreamTime(t(6, 29))).toBe(true);
  expect(isDreamTime(t(6, 30))).toBe(false);
  expect(isDreamTime(t(12, 0))).toBe(false);
});

it('flame rotation: the pair advances every few minutes round the list', () => {
  expect(flamePair(0, 3)).toEqual({ step: 0, base: 0, top: 1 });
  expect(flamePair(FLAME_ROTATE_MS - 1, 3)).toEqual({ step: 0, base: 0, top: 1 });
  expect(flamePair(FLAME_ROTATE_MS, 3)).toEqual({ step: 1, base: 1, top: 2 });
  expect(flamePair(2 * FLAME_ROTATE_MS, 3)).toEqual({ step: 2, base: 2, top: 0 });
  expect(flamePair(3 * FLAME_ROTATE_MS, 3)).toEqual({ step: 3, base: 0, top: 1 });
});
