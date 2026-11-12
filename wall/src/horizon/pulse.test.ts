import { describe, expect, it } from 'vitest';
import { WAVE_ALPHA, WAVE_LIFE_S, WAVE_SLOTS, clearGridPulse, createGridPulse, stepGridPulse } from './pulse';
import { CAMERAS, HOME_MORNING } from './cameras';

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
    expect(w.p).toBeCloseTo(0.066 / WAVE_LIFE_S, 9);
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

  it('brightens on the kick and settles to the bass level between kicks', () => {
    const s = createGridPulse();
    stepGridPulse(s, 0.033, playing(0, { bass: 0.5 }));
    const on = stepGridPulse(s, 0.033, playing(1, { bass: 0.5 }))!.bright;
    let g = stepGridPulse(s, 0.033, playing(1, { bass: 0.5 }))!;
    for (let i = 0; i < 60; i++) g = stepGridPulse(s, 0.033, playing(1, { bass: 0.5 }))!;
    expect(on).toBeCloseTo(0.65 + 0.35 * 0.5, 9);
    expect(g.bright).toBeCloseTo(0.35 * 0.5, 2);
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
