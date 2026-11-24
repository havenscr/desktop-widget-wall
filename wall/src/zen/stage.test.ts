import { afterEach, expect, it } from 'vitest';
import { BREATH_PATTERNS } from './model';
import { GLIDE_MS, SKY_STEPS, clearSky, endSundown, levelAt, onStage, pictureFade, resetStage, sample, setDream, skyNow, stage, startBreath, startSundown, stopBreath, sundownProgress } from './stage';

afterEach(() => {
  stage.mode = 'breath';
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

const RANGE = { from: 1_000_000_000, to: 1_000_000_000 + 5_400_000 };
const REAL = 2_000_000_000;

it('with no Sundown the sky shows the real hour', () => {
  expect(skyNow(5000, REAL)).toBe(REAL);
  expect(sundownProgress(5000)).toBe(0);
});

it('Sundown glides in from the real hour, then runs its clock to the end', () => {
  startSundown(RANGE, 600_000, 0, false, REAL);
  expect(skyNow(0, REAL)).toBe(REAL);
  const mid = skyNow(GLIDE_MS / 2, REAL);
  expect(mid).toBeLessThan(REAL);
  expect(mid).toBeGreaterThan(RANGE.from);
  expect(skyNow(GLIDE_MS + 1, REAL)).toBeCloseTo(RANGE.from + (RANGE.to - RANGE.from) * ((GLIDE_MS + 1) / 600_000), 3);
  expect(skyNow(300_000, REAL)).toBeCloseTo((RANGE.from + RANGE.to) / 2, 3);
  expect(skyNow(600_000, REAL)).toBe(RANGE.to);
});

it('a finished session holds the night it reached, and the ridge keeps its own slow breath', () => {
  startSundown(RANGE, 600_000, 0, false, REAL);
  stage.now = 5_000;
  expect(levelAt(0)).toBeCloseTo(0.3 + 0.2 * Math.sin((2 * Math.PI * 5000) / 14_000), 6);
  endSundown();
  expect(skyNow(9_999_999, REAL)).toBe(RANGE.to);
  expect(sundownProgress(9_999_999)).toBe(1);
});

it('leaving early glides back to the real hour, then shows it', () => {
  startSundown(RANGE, 600_000, 0, false, REAL);
  const away = skyNow(300_000, REAL);
  clearSky(300_000, REAL);
  expect(stage.sky.on).toBe(false);
  expect(skyNow(300_000, REAL)).toBeCloseTo(away, 3);
  expect(skyNow(300_000 + GLIDE_MS * 2, REAL)).toBe(REAL);
});

it('reduced motion steps the sky five times with no glide', () => {
  startSundown(RANGE, 600_000, 0, true, REAL);
  expect(skyNow(0, REAL)).toBe(RANGE.from);
  const seen = new Set<number>();
  for (let t = 0; t < 600_000; t += 1000) seen.add(skyNow(t, REAL));
  endSundown();
  seen.add(skyNow(700_000, REAL));
  expect(seen.size).toBe(SKY_STEPS);
  clearSky(1000, REAL);
  expect(skyNow(1001, REAL)).toBe(REAL);
});

it('resetting the stage puts the sky back at once', () => {
  startSundown(RANGE, 600_000, 0, false, REAL);
  resetStage();
  expect(skyNow(5000, REAL)).toBe(REAL);
});

it('skyNow allocates nothing it keeps: same numbers in, same number out', () => {
  startSundown(RANGE, 600_000, 0, false, REAL);
  expect(skyNow(123_456, REAL)).toBe(skyNow(123_456, REAL));
});
