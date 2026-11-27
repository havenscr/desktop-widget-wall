import { describe, expect, it } from 'vitest';
import { draw, when, type HorizonDrawOptions } from './renderer';
import { echoPaths, pathContext } from './canvasStub';
import hz from './HorizonCanvas.tsx?raw';
import { CAMERAS } from './cameras';
import { REST_LOOK, createEchoMotion, echoOptions, stepEchoMotion } from './echo';
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

/** The echo lines' heights while music plays for `seconds`, at a Mountain dance level, read from the renderer's real strokes. */
function playedLines(level: 'off' | 'low' | 'medium' | 'high', seconds: number, frames: number[]) {
  const cam = CAMERAS.unwind;
  const motion = createEchoMotion(true);
  const out: number[][][] = [];
  let f = Math.min(1, mountainGain(level));
  const dt = 1 / 60;
  const total = Math.round(seconds * 60);
  for (let i = 1; i <= total; i++) {
    // Music is playing the whole time: the drift advances unless the factor holds it.
    stepEchoMotion(motion, true, dt, f);
    if (frames.includes(i)) {
      const echo = echoOptions(cam, 1, i * dt, 1, motion.rest, REST_LOOK)!;
      echo.drift = motion.drift;
      echo.n = Math.max(1, cam.en);
      applyMountainGain(echo, mountainGain(level));
      const o: HorizonDrawOptions = { W: 2560, H: 720, scale: 1, hy: cam.hy, az0: cam.az0, ppd: cam.ppd, vex: cam.vex, snowDeg: cam.snowDeg, cityScale: cam.cs, vx: cam.vx, ms: when(2026, 11, 11, 21.7), t: i * dt, phase: 0.4, grain: false, echo };
      const { ctx, strokes } = pathContext();
      draw(ctx, o);
      out.push(echoPaths(strokes, cam.hy).echo.map((l) => l.h));
    }
    f = Math.min(1, mountainGain(level));
  }
  return out;
}

describe('Mountain dance Off holds the lines still while music plays', () => {
  it('the drift stops: stepping with a factor of 0 never moves it, and a factor of 1 or more runs at 1x', () => {
    const a = createEchoMotion(true);
    const b = createEchoMotion(true);
    const c = createEchoMotion(true);
    for (let i = 0; i < 400; i++) {
      stepEchoMotion(a, true, 1 / 60, 0);
      stepEchoMotion(b, true, 1 / 60, 1);
      stepEchoMotion(c, true, 1 / 60, 1.5);
    }
    expect(a.drift).toBe(createEchoMotion(true).drift);
    expect(b.drift).not.toBe(a.drift);
    expect(c.drift).toBe(b.drift);
  });

  it('every line keeps its y values from frame to frame at Off, with music playing and the rest settle over', () => {
    const [a, b, c] = playedLines('off', 6, [300, 330, 359]);
    expect(a.length).toBeGreaterThan(3);
    for (const other of [b, c]) {
      expect(other.length).toBe(a.length);
      for (let l = 0; l < a.length; l++) for (let i = 0; i < a[l].length; i++) expect(other[l][i]).toBe(a[l][i]);
    }
  });

  it('control: at Medium the same frames differ, so the check can fail', () => {
    const [a, b] = playedLines('medium', 6, [300, 330]);
    let moved = 0;
    for (let l = 0; l < a.length; l++) for (let i = 0; i < a[l].length; i++) moved = Math.max(moved, Math.abs(b[l][i] - a[l][i]));
    expect(moved).toBeGreaterThan(0.5);
  });

  it('the horizon passes the eased factor to the drift and scales the ribbon kick', () => {
    const src = hz.replace(/\r\n/g, '\n');
    expect(src).toContain('stepEchoMotion(motion.current, driving, dt, Math.min(1, ' + 'mountainF.current))');
    expect(src).toContain('tf.kick = danceKick() * Math.min(1, ' + 'mountainF.current)');
    expect(src.indexOf('mountainF.current = stepMountain' + 'Gain')).toBeLessThan(src.indexOf('stepEchoMotion(motion.current'));
  });
});
