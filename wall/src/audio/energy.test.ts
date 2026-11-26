import { describe, expect, it } from 'vitest';
import {
  CALM_S,
  DROP_RATIO,
  LONG_S,
  SHORT_S,
  ENERGY_WINDOW_S,
  GAP_HOLD_MS,
  MAX_STEP_MS,
  energyIdle,
  REFRACTORY_S,
  createEnergy,
  resetEnergy,
  stepEnergy,
  type EnergyState,
} from './energy';

const DT = 33;

/** A little clock around one state: run for `ms` at a loudness, with optional beats every `beatEvery` ms. */
function rig() {
  const s: EnergyState = createEnergy();
  let now = 0;
  let beats = 0;
  let sinceBeat = 0;
  return {
    s,
    get now() {
      return now;
    },
    run(ms: number, level: number, playing = true, beatEvery = 0) {
      for (let t = 0; t < ms; t += DT) {
        now += DT;
        if (beatEvery > 0) {
          sinceBeat += DT;
          if (sinceBeat >= beatEvery) {
            sinceBeat = 0;
            beats++;
          }
        }
        stepEnergy(s, now, DT, level, playing, beats);
      }
    },
    beat() {
      beats++;
    },
  };
}

describe('slow energy', () => {
  it('rises to about 63 percent of a step in one window and settles on the level', () => {
    const r = rig();
    r.run(ENERGY_WINDOW_S * 1000, 1);
    expect(r.s.energy).toBeGreaterThan(0.6);
    expect(r.s.energy).toBeLessThan(0.66);
    r.run(ENERGY_WINDOW_S * 1000 * 3, 1);
    expect(r.s.energy).toBeGreaterThan(0.98);
    expect(r.s.energy).toBeLessThanOrEqual(1);
  });

  it('is the same at any tick rate', () => {
    const a = createEnergy();
    const b = createEnergy();
    for (let t = 1; t <= 6000; t++) stepEnergy(a, t, 1, 0.8, true, 0);
    for (let t = 100; t <= 6000; t += 100) stepEnergy(b, t, 100, 0.8, true, 0);
    expect(a.energy).toBeCloseTo(b.energy, 2);
  });

  it('holds through a short gap, then decays to exactly 0 in silence', () => {
    const r = rig();
    r.run(20000, 0.8);
    const before = r.s.energy;
    r.run(GAP_HOLD_MS - 200, 0, false);
    expect(r.s.energy).toBe(before);
    r.run(ENERGY_WINDOW_S * 1000, 0, false);
    expect(r.s.energy).toBeLessThan(before * 0.5);
    expect(r.s.energy).toBeGreaterThan(0);
    r.run(60000, 0, false);
    expect(r.s.energy).toBe(0);
  });

  it('stays 0 in silence from the start', () => {
    const r = rig();
    r.run(10000, 0, false);
    expect(r.s.energy).toBe(0);
  });

  it('resumes from the held value after a short gap', () => {
    const r = rig();
    r.run(20000, 0.8);
    const before = r.s.energy;
    r.run(1000, 0, false);
    r.run(DT * 3, 0.8);
    expect(Math.abs(r.s.energy - before)).toBeLessThan(0.01);
  });
});

describe('drop flag', () => {
  /** A trace given as [seconds, loudness] pieces, with a kick every 500 ms (or none). */
  function trace(pieces: [number, number][], beatEvery = 500) {
    const r = rig();
    for (const [sec, level] of pieces) r.run(sec * 1000, level, true, beatEvery);
    return r;
  }

  it('fires for a build and a chorus, 2 s against 12 s', () => {
    const r = trace([[16, 0.3], [4, 0.45], [6, 0.9]]);
    expect(r.s.drops.count).toBe(1);
    expect(SHORT_S).toBe(2);
    expect(LONG_S).toBe(12);
    expect(DROP_RATIO).toBe(1.3);
  });

  it('fires for loud-but-not-maxed music: 0.4 verse then 0.7 chorus', () => {
    expect(trace([[16, 0.4], [8, 0.7]]).s.drops.count).toBe(1);
  });

  it('never fires on steady loud mastered music, 0.6 to 0.7 the whole time', () => {
    const r = rig();
    for (let i = 0; i < 120; i++) r.run(1000, 0.6 + 0.1 * (i % 2), true, 500);
    for (let i = 0; i < 120; i++) r.run(500, 0.6 + 0.1 * ((i * 7) % 3) / 2, true, 500);
    expect(r.s.drops.count).toBe(0);
  });

  it('does not fire when there is no kick on the rise', () => {
    expect(trace([[16, 0.3], [4, 0.45], [10, 0.9]], 0).s.drops.count).toBe(0);
  });

  it('fires at the same time at 10 ms and 33 ms ticks, within 100 ms', () => {
    const fireAt = (tick: number): number => {
      const e = createEnergy();
      let beats = 0;
      let nextBeat = 500;
      for (let t = tick; t <= 40000; t += tick) {
        while (nextBeat <= t) {
          beats++;
          nextBeat += 500;
        }
        stepEnergy(e, t, tick, t < 18000 ? 0.3 : 0.9, true, beats);
      }
      expect(e.drops.count).toBe(1);
      return e.drops.lastAt;
    };
    expect(Math.abs(fireAt(10) - fireAt(33))).toBeLessThanOrEqual(100);
  });

  it('keeps the history gapless while a crossing waits for its kick', () => {
    const r = rig();
    r.run(16000, 0.3);
    const before = r.s.histCount;
    r.run(200, 1);
    expect(r.s.crossedAt === -Infinity || r.s.histCount >= before).toBe(true);
    expect(r.s.histCount).toBe(120);
    expect(r.s.hist.slice().filter((x) => x > 0.9).length).toBeGreaterThanOrEqual(1);
  });

  it('never fires with only 4 s of quiet intro, then loud music', () => {
    expect(trace([[4, 0.3], [20, 0.9]]).s.drops.count).toBe(0);
    expect(trace([[11, 0.3], [20, 0.9]]).s.drops.count).toBe(0);
  });

  it('a brief swell during the calm does not revoke the arming', () => {
    const r = trace([[16, 0.4], [1.5, 0.55], [5, 0.4]]);
    expect(r.s.drops.count).toBe(0);
    r.run(6000, 0.7, true, 500);
    expect(r.s.drops.count).toBe(1);
  });

  it('locks out for 8 s after a drop, then fires the next', () => {
    const r = trace([[16, 0.3], [6, 0.9]]);
    expect(r.s.drops.count).toBe(1);
    // A second build and chorus right away: the chorus lands inside the lockout, so nothing.
    r.run(1000, 0.3, true, 500);
    r.run(3000, 0.9, true, 500);
    expect(r.s.drops.count).toBe(1);
    // After a calmer stretch, the next chorus fires.
    r.run(20000, 0.3, true, 500);
    r.run(6000, 0.9, true, 500);
    expect(r.s.drops.count).toBe(2);
    expect(REFRACTORY_S).toBe(8);
  });

  /** Quiet stretch, then loud: the classic build and jump. Beats every 500 ms throughout. */
  function buildAndJump(r: ReturnType<typeof rig>) {
    r.run(16000, 0.3, true, 500);
    r.run(30000, 1, true, 500);
  }

  it('flags one drop for a build then a jump', () => {
    const r = rig();
    buildAndJump(r);
    expect(r.s.drops.count).toBe(1);
    expect(r.s.drops.lastAt).toBeGreaterThan(12000);
    expect(r.s.energy).toBeGreaterThan(0.5);
  });

  it('never drops on steady loud music, from silence or mid track', () => {
    const r = rig();
    r.run(60000, 0.85, true, 500);
    expect(r.s.drops.count).toBe(0);
    const q = rig();
    q.run(3000, 0, false);
    q.run(60000, 1, true, 400);
    expect(q.s.drops.count).toBe(0);
  });

  it('never drops on steady quiet music', () => {
    const r = rig();
    r.run(60000, 0.35, true, 500);
    expect(r.s.drops.count).toBe(0);
  });

  it('needs a beat to confirm the crossing', () => {
    const r = rig();
    r.run(16000, 0.3);
    r.run(30000, 1);
    expect(r.s.drops.count).toBe(0);
  });

  it('confirms with a beat that arrives just after the crossing', () => {
    const q = rig();
    q.run(16000, 0.3);
    while (q.s.crossedAt === -Infinity) q.run(DT, 1);
    expect(q.s.drops.count).toBe(0);
    q.beat();
    q.run(DT * 2, 1);
    expect(q.s.drops.count).toBe(1);
  });

  it('does not count a beat from long before the crossing', () => {
    const r = rig();
    r.run(16000, 0.3);
    r.beat();
    r.run(1000, 0.3);
    r.run(30000, 1);
    expect(r.s.drops.count).toBe(0);
  });

  it('does not flag a drop out of silence, nor after a quiet stretch under the floor', () => {
    const r = rig();
    r.run(10000, 0.1, true, 500);
    r.run(30000, 1, true, 500);
    expect(r.s.drops.count).toBe(0);
    const q = rig();
    q.run(10000, 0, false);
    q.run(30000, 1, true, 500);
    expect(q.s.drops.count).toBe(0);
  });

  it('needs the full arm time below the arm level', () => {
    const r = rig();
    r.run((CALM_S - 1.5) * 1000, 0.3, true, 500);
    r.run(30000, 1, true, 500);
    expect(r.s.drops.count).toBe(0);
  });

  it('keeps a refractory gap, then flags the next drop', () => {
    const r = rig();
    buildAndJump(r);
    expect(r.s.drops.count).toBe(1);
    const first = r.s.drops.lastAt;
    // Fall back quiet and jump again inside the refractory time: ignored.
    r.run(1000, 0, true, 500);
    r.run(500, 1, true, 500);
    expect(r.s.drops.count).toBe(1);
    // A full second build and jump after the refractory time counts.
    r.run(40000, 0.3, true, 500);
    r.run(30000, 1, true, 500);
    expect(r.s.drops.count).toBe(2);
    expect(r.s.drops.lastAt - first).toBeGreaterThan(REFRACTORY_S * 1000);
  });

  it('count only goes up and lastAt only moves on a drop', () => {
    const r = rig();
    expect(r.s.drops.lastAt).toBe(-Infinity);
    buildAndJump(r);
    const at = r.s.drops.lastAt;
    r.run(10000, 1, true, 500);
    expect(r.s.drops.count).toBe(1);
    expect(r.s.drops.lastAt).toBe(at);
  });

  it('resets to nothing', () => {
    const r = rig();
    buildAndJump(r);
    resetEnergy(r.s);
    expect(r.s.energy).toBe(0);
    expect(r.s.drops.count).toBe(0);
    expect(r.s.drops.lastAt).toBe(-Infinity);
  });

  it('flags the drop for a realistic build then 0.8 or 0.85 loudness', () => {
    for (const level of [0.8, 0.85]) {
      const r = rig();
      r.run(16000, 0.3, true, 500);
      r.run(30000, level, true, 500);
      expect(r.s.drops.count).toBe(1);
    }
  });

  it('does not count decaying silence as a build-up', () => {
    const r = rig();
    r.run(30000, 1, true, 500);
    r.run(12000, 0, false);
    r.run(30000, 1, true, 500);
    expect(r.s.drops.count).toBe(0);
  });

  it('a hidden page (one long step) neither snaps the energy nor fakes a stretch', () => {
    const r = rig();
    r.run(5000, 0.3, true, 500);
    const before = r.s.energy;
    stepEnergy(r.s, r.now + 60000, 60000, 1, true, 0);
    expect(r.s.energy - before).toBeLessThan(1 - Math.exp(-MAX_STEP_MS / 1000 / ENERGY_WINDOW_S) + 1e-9);
    expect(r.s.armed).toBe(false);
    // The loudness history starts over at the wake-up tick; none carries across the gap.
    expect(r.s.histCount).toBeLessThanOrEqual(3);
  });

  it('is idle only when silent, at 0 and nothing armed', () => {
    const r = rig();
    expect(energyIdle(r.s, false)).toBe(true);
    expect(energyIdle(r.s, true)).toBe(false);
    r.run(2000, 0.5);
    expect(energyIdle(r.s, false)).toBe(false);
    r.run(90000, 0, false);
    expect(energyIdle(r.s, false)).toBe(true);
  });
});
