import { describe, expect, it } from 'vitest';
import { CALM_RATIO, CALM_S, DROP_RATIO, LONG_FLOOR, createEnergy, dropStrength, dropTuning, stepEnergy } from './energy';

describe('Sensitivity: the drop rule per level', () => {
  it('level 3 is today\'s rule exactly', () => {
    expect(dropTuning(3)).toEqual({ calmS: CALM_S, calmRatio: CALM_RATIO, dropRatio: DROP_RATIO, longFloor: LONG_FLOOR });
    expect(createEnergy().tune).toEqual(dropTuning(3));
  });

  it('level 1 is stricter and level 10 is looser, step by step', () => {
    const t = Array.from({ length: 10 }, (_, i) => dropTuning(i + 1));
    for (let i = 1; i < 10; i++) {
      expect(t[i].calmS).toBeLessThan(t[i - 1].calmS);
      expect(t[i].dropRatio).toBeLessThan(t[i - 1].dropRatio);
      expect(t[i].longFloor).toBeLessThan(t[i - 1].longFloor);
      expect(t[i].calmRatio).toBeGreaterThan(t[i - 1].calmRatio);
    }
    expect(t[0].dropRatio).toBeGreaterThan(DROP_RATIO);
    expect(t[0].calmS).toBeGreaterThan(CALM_S);
    expect(t[9]).toMatchObject({ calmS: 1, dropRatio: 1.08 });
    // At 10 the calm bar sits above the jump bar, so the jump is tested first (see `detectDrop`).
    expect(t[9].calmRatio).toBeGreaterThan(t[9].dropRatio);
  });

  it('clamps and rounds a stray level', () => {
    expect(dropTuning(0)).toEqual(dropTuning(1));
    expect(dropTuning(55)).toEqual(dropTuning(10));
    expect(dropTuning(NaN)).toEqual(dropTuning(3));
    expect(dropTuning(5.4)).toEqual(dropTuning(5));
  });

  it('the strength of a jump counts from the level\'s own bar, and is the same at level 3', () => {
    expect(dropStrength(1.3)).toBe(0.6);
    expect(dropStrength(1.3, dropTuning(3).dropRatio)).toBe(0.6);
    expect(dropStrength(1.08, 1.08)).toBe(0.6);
    expect(dropStrength(2.2, 1.08)).toBe(1);
  });
});

/** Steady loudness for 13 s with a small swell (8 percent) landing on a kick, then 10 s more: how many drops fired. */
function dropsFor(level: number, swell: number): number {
  const s = createEnergy();
  s.tune = dropTuning(level);
  let now = 0;
  let beats = 0;
  const tick = (lvl: number, kick: boolean) => {
    if (kick) beats++;
    now += 100;
    stepEnergy(s, now, 100, lvl, true, beats);
  };
  for (let i = 0; i < 140; i++) tick(0.5, false);
  // The swell, over about 2 s, with a kick every 400 ms.
  for (let i = 0; i < 30; i++) tick(0.5 * swell, i % 4 === 0);
  return s.drops.count;
}

describe('Sensitivity: what fires', () => {
  it('a small swell fires at 10 and not at 3 or 1', () => {
    expect(dropsFor(10, 1.12)).toBeGreaterThan(0);
    expect(dropsFor(3, 1.12)).toBe(0);
    expect(dropsFor(1, 1.12)).toBe(0);
  });
  it('a big jump after a long calm fires at 3, as before', () => {
    expect(dropsFor(3, 2)).toBeGreaterThan(0);
  });
  it('the 8 second refractory holds at every level', () => {
    for (const level of [1, 3, 10]) {
      const s = createEnergy();
      s.tune = dropTuning(level);
      let now = 0;
      let beats = 0;
      const stamps: number[] = [];
      let seen = 0;
      for (let i = 0; i < 1200; i++) {
        now += 100;
        if (i % 4 === 0) beats++;
        const lvl = 0.5 * (1 + 0.5 * Math.max(0, Math.sin(i / 25)));
        stepEnergy(s, now, 100, lvl, true, beats);
        if (s.drops.count !== seen) {
          seen = s.drops.count;
          stamps.push(s.drops.lastAt);
        }
      }
      if (level === 10) expect(stamps.length).toBeGreaterThan(1);
      for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(8000);
    }
  });
});
