import { afterEach, expect, it } from 'vitest';
import { BREATH_PATTERNS } from './model';
import { levelAt, onStage, pictureFade, resetStage, sample, setDream, stage, startBreath, stopBreath } from './stage';

afterEach(() => {
  resetStage();
  stage.now = 0;
  stage.echoT = 0;
});

it('sample is finite and in the range the renderer reads, running or idle', () => {
  for (const running of [false, true]) {
    if (running) startBreath(BREATH_PATTERNS[0], 0);
    else stopBreath();
    for (let now = 0; now < 30_000; now += 700) {
      stage.now = now;
      stage.echoT = now / 1000;
      for (let u = 0; u <= 1.2; u += 0.2) {
        for (let tau = stage.echoT - 7; tau <= stage.echoT; tau += 1) {
          const v = sample(u, tau);
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1.3);
        }
      }
    }
  }
});

it('a line shows the breath as it was a moment ago', () => {
  startBreath(BREATH_PATTERNS[0], 0);
  stage.now = 4000;
  stage.echoT = 4;
  expect(levelAt(0)).toBeCloseTo(1, 6);
  expect(levelAt(4)).toBeCloseTo(0, 6);
  expect(sample(0, 4)).toBeCloseTo(1.1, 6);
});

it('the picture is whole while Zen is lit and fades to nothing a minute into Dream', () => {
  expect(pictureFade(5000)).toBe(1);
  setDream(1000);
  expect(pictureFade(1000)).toBe(1);
  expect(pictureFade(31_000)).toBeCloseTo(0.5, 6);
  expect(pictureFade(61_000)).toBe(0);
  setDream(null);
  expect(pictureFade(61_000)).toBe(1);
});

it('listeners hear a change and can leave', () => {
  let n = 0;
  const off = onStage(() => n++);
  startBreath(BREATH_PATTERNS[0], 0);
  stopBreath();
  setDream(5);
  off();
  setDream(null);
  expect(n).toBe(3);
});

it('sample allocates nothing: it returns a number from plain fields', () => {
  stage.now = 100;
  expect(typeof sample(0.5, 0)).toBe('number');
});
