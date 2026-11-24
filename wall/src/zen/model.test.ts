import { expect, it } from 'vitest';
import {
  BREATH_PATTERNS,
  DREAM_FADE_MS,
  breathAt,
  breathLevel,
  dreamFade,
  idleBreathLevel,
  patternById,
  patternSeconds,
  ease,
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

it('Box 4-4-4-4: in, hold full, out, hold empty', () => {
  const box = patternById('box');
  expect(patternSeconds(box)).toBe(16);
  expect(breathAt(0, box)).toMatchObject({ phase: 0, word: 'Breathe in', left: 4 });
  expect(breathAt(4, box)).toMatchObject({ phase: 1, word: 'Hold', left: 4 });
  expect(breathAt(4, box).scale).toBeCloseTo(1.06, 6);
  expect(breathAt(8, box)).toMatchObject({ phase: 2, word: 'Breathe out', left: 4 });
  expect(breathAt(12, box)).toMatchObject({ phase: 3, word: 'Hold', left: 4 });
  expect(breathAt(12, box).scale).toBeCloseTo(0.8, 6);
  expect(breathAt(15.5, box)).toMatchObject({ phase: 3, left: 1 });
  expect(breathAt(16, box)).toMatchObject({ phase: 0, left: 4 });
});

it('4-7-8 and Even 5-5 phases; zero-length holds are skipped', () => {
  const relax = patternById('relax');
  expect(breathAt(4, relax)).toMatchObject({ phase: 1, left: 7 });
  expect(breathAt(11, relax)).toMatchObject({ phase: 2, left: 8 });
  expect(breathAt(19, relax)).toMatchObject({ phase: 0 });
  const even = patternById('even');
  expect(patternSeconds(even)).toBe(10);
  expect(breathAt(4.9, even)).toMatchObject({ phase: 0, left: 1 });
  expect(breathAt(5, even)).toMatchObject({ phase: 2, word: 'Breathe out', left: 5 });
  expect(breathAt(10, even)).toMatchObject({ phase: 0 });
  for (const p of BREATH_PATTERNS) for (let t = 0; t < 40; t += 0.37) expect(breathAt(t, p).left).toBeGreaterThanOrEqual(1);
});

it('an unknown pattern id is the calm one', () => {
  expect(patternById('nope').id).toBe('calm');
  expect(patternById(undefined).phases).toEqual([4, 2, 6, 0]);
});


it('breathLevel runs 0 to 1 with the phase word and is continuous at every join, for every pattern', () => {
  for (const p of BREATH_PATTERNS) {
    const total = patternSeconds(p) * 1000;
    let prev = breathLevel(p, 0);
    for (let ms = 10; ms <= total * 2; ms += 10) {
      const v = breathLevel(p, ms);
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
  }
  const calm = BREATH_PATTERNS[0];
  expect(breathLevel(calm, 0)).toBeCloseTo(0, 6);
  expect(breathLevel(calm, 4000)).toBeCloseTo(1, 6);
  expect(breathLevel(calm, 6000)).toBeCloseTo(1, 6);
  expect(breathLevel(calm, 12000)).toBeCloseTo(0, 6);
});

it('idleBreathLevel always moves and stays in bounds', () => {
  let lo = 1;
  let hi = 0;
  for (let ms = 0; ms < 60_000; ms += 100) {
    const v = idleBreathLevel(ms);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  expect(lo).toBeGreaterThanOrEqual(0.09);
  expect(hi).toBeLessThanOrEqual(0.51);
  expect(hi - lo).toBeGreaterThan(0.3);
  expect(idleBreathLevel(0)).not.toBe(idleBreathLevel(3000));
});

it('Dream fades the picture to black over its first minute', () => {
  expect(dreamFade(0)).toBe(1);
  expect(dreamFade(DREAM_FADE_MS / 2)).toBeCloseTo(0.5, 6);
  expect(dreamFade(DREAM_FADE_MS)).toBe(0);
  expect(dreamFade(DREAM_FADE_MS * 3)).toBe(0);
});
