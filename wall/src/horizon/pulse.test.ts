import { describe, expect, it } from 'vitest';
import { WAVE_ALPHA, WAVE_LIFE_S, WAVE_SLOTS, clearGridPulse, createGridPulse, stepGridPulse } from './pulse';
import { CAMERAS, HOME_MORNING } from './cameras';
import { draw, when } from './renderer';
import { stubContext } from './canvasStub';
import { createBeatDetector } from '../audio/beat';

/** Seeded random numbers. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const playing = (beats: number, extra: Partial<{ lag: number; bass: number; gp: number }> = {}) => ({
  playing: true,
  beats,
  lag: 0,
  bass: 0,
  gp: 1,
  ...extra,
});

const live = (g: { waves: { p: number; a: number }[] }) => g.waves.filter((w) => w.a > 0);

describe('grid pulse state', () => {
  it('per-camera strength: subtle on Work, Home and Rainier, full on Unwind', () => {
    expect(CAMERAS.work.gp).toBe(0.5);
    expect(CAMERAS.meet.gp).toBe(0.5);
    expect(CAMERAS.home.gp).toBe(0.5);
    expect(HOME_MORNING.gp).toBe(0.5);
    expect(CAMERAS.unwind.gp).toBe(1);
  });

  it('passes nothing while silent, and nothing changes on a beat that arrives while silent', () => {
    const s = createGridPulse();
    expect(stepGridPulse(s, 0.033, { ...playing(0), playing: false })).toBeNull();
    expect(stepGridPulse(s, 0.033, { ...playing(3), playing: false })).toBeNull();
    // Music starts: the beats counted during silence are not replayed.
    expect(live(stepGridPulse(s, 0.033, playing(3))!)).toHaveLength(0);
  });

  it('a beat starts one band at the horizon that rolls to the bottom in 1.2 s, fading in then out', () => {
    const s = createGridPulse();
    stepGridPulse(s, 0.033, playing(0));
    const ps: number[] = [];
    const as: number[] = [];
    let g = stepGridPulse(s, 0, playing(1))!;
    for (let t = 0; t < WAVE_LIFE_S + 0.2; t += 0.05) {
      const w = live(g);
      ps.push(w[0]?.p ?? -1);
      as.push(w[0]?.a ?? 0);
      g = stepGridPulse(s, 0.05, playing(1))!;
    }
    expect(as[0]).toBe(0); // starts invisible at the horizon (age 0)
    const alive = ps.filter((p) => p >= 0);
    for (let i = 1; i < alive.length; i++) expect(alive[i]).toBeGreaterThan(alive[i - 1]);
    const peak = Math.max(...as);
    expect(peak).toBeLessThanOrEqual(WAVE_ALPHA);
    expect(peak).toBeGreaterThan(WAVE_ALPHA * 0.6);
    expect(as.indexOf(peak)).toBeLessThan(5); // peaks early, then fades as it comes forward
    expect(as[as.length - 1]).toBe(0); // gone after its life
    expect(live(g)).toHaveLength(0);
  });

  it('starts the band already as old as the detector lag, so it lines up with the kick onset', () => {
    const s = createGridPulse();
    stepGridPulse(s, 0.033, playing(0));
    const g = stepGridPulse(s, 0.033, playing(1, { lag: 0.066 }))!;
    const w = g.waves.find((x) => x.p > 0)!;
    expect(w.p).toBeCloseTo(Math.pow(0.066 / WAVE_LIFE_S, 0.75), 9); // depth eases out as u^0.75
  });

  it('scales the bands and the brightening by the camera strength', () => {
    const at = (gp: number) => {
      const s = createGridPulse();
      stepGridPulse(s, 0.033, playing(0, { gp }));
      stepGridPulse(s, 0.033, playing(1, { gp, bass: 0.6 }));
      const g = stepGridPulse(s, 0.1, playing(1, { gp, bass: 0.6 }))!;
      return { a: live(g)[0].a, bright: g.bright };
    };
    const full = at(1);
    const half = at(0.5);
    expect(half.a).toBeCloseTo(full.a / 2, 9);
    expect(half.bright).toBeCloseTo(full.bright / 2, 9);
    expect(full.bright).toBeLessThanOrEqual(1);
  });

  it('eases the lines up over about 80 ms on a beat (never a jump), then settles toward the slow bass level', () => {
    const s = createGridPulse();
    for (let i = 0; i < 120; i++) stepGridPulse(s, 0.033, playing(0, { bass: 0.5 })); // bass settles over 4 s
    const before = s.grid.bright;
    expect(before).toBeCloseTo(0.35 * 0.5, 2);
    const ramp: number[] = [];
    let g = stepGridPulse(s, 0.033, playing(1, { bass: 0.5 }))!;
    ramp.push(g.bright);
    for (let i = 0; i < 3; i++) ramp.push(stepGridPulse(s, 0.033, playing(1, { bass: 0.5 }))!.bright);
    expect(ramp[0] - before).toBeLessThan(0.65 * 0.5); // the first frame is part way up
    expect(ramp[1]).toBeGreaterThan(ramp[0]);
    expect(Math.max(...ramp)).toBeCloseTo(0.65 + 0.35 * 0.5, 2); // full within about 80 ms
    for (let i = 0; i < 60; i++) g = stepGridPulse(s, 0.033, playing(1, { bass: 0.5 }))!;
    expect(g.bright).toBeCloseTo(0.35 * 0.5, 2);
  });

  it('frame-to-frame bass jitter never flickers the lines: the bass part is smoothed', () => {
    const s = createGridPulse();
    const r = rng(5);
    const out: number[] = [];
    for (let i = 0; i < 300; i++) out.push(stepGridPulse(s, 0.033, playing(0, { bass: 0.3 + 0.4 * r() }))!.bright);
    const steps = out.slice(90).map((v, i, a) => (i ? Math.abs(v - a[i - 1]) : 0));
    expect(Math.max(...steps)).toBeLessThan(0.02);
  });

  it('at the detector\'s fastest cadence the lines rise at most three times in any second', () => {
    const quiet = new Array(32).fill(0.3);
    const loud = new Array(32).fill(0.65);
    for (let hits = 1; hits <= 3; hits++) {
      for (let rest = 1; rest <= 12; rest++) {
        const d = createBeatDetector();
        const s = createGridPulse();
        const bright: number[] = [];
        let t = 0;
        let frame = 0;
        const push = (bands: number[]) => {
          d.push(bands, t);
          bright.push(stepGridPulse(s, 0.033, playing(d.count, { lag: d.lag / 1000, bass: 0.5 }))!.bright);
          t += 33;
          frame++;
        };
        for (let i = 0; i < 20; i++) push(quiet);
        while (frame < 400) {
          for (let i = 0; i < hits; i++) push(loud);
          for (let i = 0; i < rest; i++) push(quiet);
        }
        // A rise starts on a frame brighter than the one before, after one that was not.
        const starts: number[] = [];
        for (let i = 1; i < bright.length; i++) {
          if (bright[i] > bright[i - 1] + 1e-9 && !(i > 1 && bright[i - 1] > bright[i - 2] + 1e-9)) starts.push(i * 33);
        }
        for (const s0 of starts) expect(starts.filter((x) => x >= s0 && x < s0 + 1000).length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('with real bass movement (passed from the detector, as the canvas does) the lines rise above a small threshold at most three times a second', () => {
    const RISE = 0.02; // a rise counts once the lines have climbed this far from their last low
    for (const seed of [3, 11, 29]) {
      for (const period of [11, 12, 15, 20]) {
        const r = rng(seed);
        const d = createBeatDetector();
        const s = createGridPulse();
        const bright: number[] = [];
        for (let frame = 0, t = 0; frame < 600; frame++, t += 33) {
          // A bed whose low bands wander slowly and jitter every frame, a kick every `period` frames.
          const wobble = 0.35 + 0.1 * Math.sin(t / 700) + 0.06 * (r() - 0.5);
          const hit = frame > 20 && frame % period < 3;
          const bands = Array.from({ length: 32 }, (_, i) => (i < 12 ? (hit ? 0.7 : wobble) : 0.3 + 0.05 * r()));
          d.push(bands, t);
          bright.push(stepGridPulse(s, 0.033, playing(d.count, { lag: d.lag / 1000, bass: d.bass }))!.bright);
        }
        expect(d.count).toBeGreaterThan(10); // it really beats
        const starts: number[] = [];
        let low = bright[0];
        let rising = false;
        for (let i = 1; i < bright.length; i++) {
          if (bright[i] < bright[i - 1]) {
            if (rising) low = bright[i];
            rising = false;
            low = Math.min(low, bright[i]);
          } else if (!rising && bright[i] - low > RISE) {
            rising = true;
            starts.push(i * 33);
          }
        }
        expect(starts.length).toBeGreaterThan(5);
        for (const s0 of starts) expect(starts.filter((x) => x >= s0 && x < s0 + 1000).length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('reuses the same fixed slots every frame (no allocation in the wave loop); a fifth band takes the oldest slot', () => {
    const s = createGridPulse();
    const grid = s.grid;
    const waves = s.grid.waves;
    const objs = [...waves];
    let beats = 0;
    for (let i = 0; i < 400; i++) {
      if (i % 5 === 0) beats++; // a beat every 0.15 s: more bands than slots
      const g = stepGridPulse(s, 0.03, playing(beats))!;
      expect(g).toBe(grid);
      expect(g.waves).toBe(waves);
      expect(g.waves).toHaveLength(WAVE_SLOTS);
      g.waves.forEach((w, k) => expect(w).toBe(objs[k]));
      if (i % 80 === 40) {
        // Through the renderer too: drawing reads the option and leaves every object in place.
        draw(stubContext(), { W: 2560, H: 720, scale: 1, hy: 505, az0: 246, ppd: 49.2, ms: when(2026, 11, 11, 21.7), grain: false, grid: g });
        expect(g).toBe(grid);
        expect(g.waves).toBe(waves);
        g.waves.forEach((w, k) => expect(w).toBe(objs[k]));
      }
    }
    // With all slots busy, the newest band replaced the oldest: the youngest is near the horizon.
    expect(Math.min(...s.ages)).toBeLessThan(0.15);
    expect(Math.max(...s.ages)).toBeLessThan(WAVE_LIFE_S);
  });

  it('clearing frees every band and drops the brightness; a detector reset is followed', () => {
    const s = createGridPulse();
    stepGridPulse(s, 0.033, playing(0));
    stepGridPulse(s, 0.033, playing(2, { bass: 1 }));
    clearGridPulse(s);
    expect(s.grid.bright).toBe(0);
    expect(live(s.grid)).toHaveLength(0);
    // The detector restarted from zero: its next beat still starts a band.
    stepGridPulse(s, 0.033, playing(0));
    stepGridPulse(s, 0.033, playing(1));
    expect(s.ages.some((a) => Number.isFinite(a))).toBe(true);
  });
});
