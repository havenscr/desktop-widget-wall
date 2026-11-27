import { describe, expect, it } from 'vitest';
import hz from './HorizonCanvas.tsx?raw';
import { CAMERAS } from './cameras';
import { echoOptions } from './echo';
import { ampScale } from './lineTypes';
import { applyMountainGain, MOUNTAIN_EASE_S, mountainGain, stepMountainGain } from './mountainDance';
import { fractionsAt, withMusicLevel } from './offTabMusic';
import { MOUNTAIN_GAIN, MOUNTAIN_LEVELS } from './vibeSettings';

describe('Mountain dance', () => {
  it('the factor is 0 for Off, 0.5 for Low, 1 for Medium and 1.5 for High', () => {
    expect(MOUNTAIN_LEVELS).toEqual(['off', 'low', 'medium', 'high']);
    expect([0, 0.5, 1, 1.5]).toEqual(MOUNTAIN_LEVELS.map((l) => mountainGain(l)));
    expect(MOUNTAIN_GAIN.medium).toBe(1);
  });

  it('multiplies the ridge amplitude by the factor, so Medium leaves the look as it is', () => {
    for (const [level, f] of [['off', 0], ['low', 0.5], ['medium', 1], ['high', 1.5]] as const) {
      const e = echoOptions(CAMERAS.unwind, 1, 3, 1)!;
      const before = e.amp;
      applyMountainGain(e, mountainGain(level));
      expect(e.amp).toBeCloseTo(before * f, 10);
    }
  });

  it('Off holds the lines still even at full Music on other tabs, the liveliest Lines setting and a drop swell', () => {
    const f = fractionsAt(2, { amp: 0, a: 0, n: 0, gp: 0, vw: 0 });
    const cam = withMusicLevel(CAMERAS.work, f, 1, { ...CAMERAS.work });
    const e = echoOptions(cam, 1, 3, 1, 0, undefined, undefined, 1)!;
    expect(e.amp).toBeGreaterThan(0);
    e.amp *= ampScale(100);
    applyMountainGain(e, mountainGain('off'));
    expect(e.amp).toBe(0);
    expect(e.swell ?? 0).toBe(0);
  });

  it('a drop swell is not made stronger past Medium, and is halved at Low', () => {
    const e = { amp: 10, swell: 0.8 };
    applyMountainGain(e, 1.5);
    expect(e.swell).toBeCloseTo(0.8, 10);
    const l = { amp: 10, swell: 0.8 };
    applyMountainGain(l, 0.5);
    expect(l.swell).toBeCloseTo(0.4, 10);
  });

  it('a change eases in over about a second with no jump, and lands exactly', () => {
    let f = 1;
    const steps: number[] = [];
    for (let t = 0; t < MOUNTAIN_EASE_S + 0.3; t += 1 / 60) {
      const next = stepMountainGain(f, 'off', 1 / 60);
      steps.push(f - next);
      f = next;
    }
    expect(Math.max(...steps)).toBeLessThan(0.1);
    expect(steps.every((d) => d >= 0)).toBe(true);
    expect(f).toBe(0);
    // Halfway through the first second it has moved, but not arrived.
    let g = 1;
    for (let i = 0; i < 18; i++) g = stepMountainGain(g, 'off', 1 / 60);
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(0.6);
    expect(stepMountainGain(NaN, 'high', 0.016)).toBe(1.5);
  });

  it('the horizon applies the factor after the Lines setting, from the eased value', () => {
    const src = hz.replace(/\r\n/g, '\n');
    const lively = src.indexOf('echo.amp *= ' + 'ampScale(lines.lively)');
    const apply = src.indexOf('applyMountain' + 'Gain(echo, mountainF.current)');
    expect(lively).toBeGreaterThan(0);
    expect(apply).toBeGreaterThan(lively);
    expect(src).toContain('mountainF.current = stepMountain' + "Gain(mountainF.current, vibeSettings().mountain, dt)");
  });
});
