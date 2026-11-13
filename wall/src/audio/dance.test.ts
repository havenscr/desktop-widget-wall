import { describe, expect, it } from 'vitest';
import {
  DANCE_BANDS,
  DANCE_TURN_HOLD_S,
  DANCE_LIMIT,
  clearDance,
  createDance,
  soft,
  stepDance,
  type DanceState,
} from './dance';

const DT = 1 / 30;
const flat = (v: number) => new Float32Array(DANCE_BANDS).fill(v);

/** Step `rows` rows of `raw(row)` and return the last row's heights and the kick after each row. */
function run(s: DanceState, rows: number, raw: (row: number) => ArrayLike<number>) {
  const out = new Float32Array(DANCE_BANDS);
  const kicks: number[] = [];
  const heights: Float32Array[] = [];
  for (let r = 0; r < rows; r++) {
    kicks.push(stepDance(s, raw(r), DT, out));
    heights.push(out.slice());
  }
  return { out, kicks, heights };
}

describe('soft', () => {
  it('is about x when small, and never reaches the limit', () => {
    expect(soft(0.01, 1.8)).toBeCloseTo(0.01, 4);
    expect(soft(100, 1.8)).toBeLessThanOrEqual(1.8);
    expect(soft(-0.5, 1.8)).toBeLessThan(0);
  });
});

describe('stepDance', () => {
  it('a steady tone settles low: after a few seconds the hit part is gone and only the soft level is left', () => {
    const s = createDance();
    const tone = flat(0.5);
    const { heights } = run(s, 30 * 8, () => tone);
    const early = Math.max(...heights[4]);
    const late = Math.max(...heights[heights.length - 1]);
    // 0.5 over the floor 0.3 is (0.2 / 0.7) * 1.3 = 0.371 of base, times 0.32 = 0.119.
    expect(late).toBeCloseTo(soft(((0.5 - 0.3) / 0.7) * 1.3 * 0.32, DANCE_LIMIT), 3);
    expect(late).toBeLessThan(0.15);
    expect(early).toBeGreaterThan(late);
  });

  it('one hit in one band rises within two steps and falls back to the settled level', () => {
    const s = createDance();
    const quiet = flat(0.4);
    const hit = flat(0.4);
    hit[10] = 0.95;
    const rows: ArrayLike<number>[] = [];
    for (let r = 0; r < 90; r++) rows.push(quiet);
    rows.push(hit, hit, hit, hit); // about 0.13 s of a hit
    for (let r = 0; r < 90; r++) rows.push(quiet);
    const { heights } = run(s, rows.length, (r) => rows[r]);
    const before = heights[89][10];
    expect(heights[91][10]).toBeGreaterThan(before + 0.5); // up within two steps of the first hit row
    const peak = Math.max(...heights.slice(90, 100).map((h) => h[10]));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(DANCE_LIMIT);
    expect(heights[heights.length - 1][10]).toBeLessThan(before + 0.1); // and back down
    // A band that did not move stays near its level while its neighbour jumps.
    expect(Math.max(...heights.slice(90, 100).map((h) => h[20]))).toBeLessThan(0.4);
  });

  it('all bands rising together add little: the contrast step takes the common part off', () => {
    // Both start with the same history: a lone hit every 0.7 s, so the running peak is set by it.
    const lone = (r: number, last: ArrayLike<number>) => {
      const v = Float32Array.from(last);
      if (r % 21 < 3) v[10] = 0.9;
      return v;
    };
    const train = (s: DanceState) => run(s, 210, (r) => lone(r, flat(0.4)));
    const a = createDance();
    train(a);
    const b = createDance();
    train(b);
    // Then one more lone hit against one where every band rises by the same amount.
    const loneHit = run(a, 4, () => lone(0, flat(0.4))).heights;
    const allRise = run(b, 4, () => flat(0.9)).heights;
    const loneTop = Math.max(...loneHit.map((h) => h[10]));
    const allTop = Math.max(...allRise.map((h) => h[10]));
    expect(loneTop).toBeGreaterThan(1);
    expect(allTop).toBeLessThan(loneTop * 0.75);
  });

  it('the soft limit is never exceeded, whatever the input', () => {
    const s = createDance();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const { heights } = run(s, 600, () => flat(0).map(() => rnd()));
    for (const h of heights) for (const v of h) expect(v).toBeLessThanOrEqual(DANCE_LIMIT);
    const hot = createDance();
    const { heights: h2 } = run(hot, 200, (r) => flat(r % 6 < 3 ? 0 : 1));
    for (const h of h2) for (const v of h) expect(v).toBeLessThanOrEqual(DANCE_LIMIT);
  });

  it('quiet music, levels around 0.35 to 0.45, still reaches n near 1 on its hits', () => {
    const s = createDance();
    const bar = (r: number) => {
      const v = flat(0.36);
      // a soft hit every half second on the bass bands, to 0.47
      if (r % 15 < 3) for (let b = 0; b < 6; b++) v[b] = 0.47;
      return v;
    };
    const { heights } = run(s, 30 * 8, bar);
    // Over the last two seconds the hit part is n times 1.35; n of 0.7 or more reads 0.7 * 1.35 through the soft limit.
    const hitTop = Math.max(...heights.slice(-60).map((h) => h[2]));
    expect(hitTop).toBeGreaterThan(soft(0.7 * 1.35, DANCE_LIMIT));
  });

  it('silence and clearing leave no stale peak: the first hit after a pause is as big as the first hit of a fresh start', () => {
    const loud = (r: number) => {
      const v = flat(0.5);
      if (r % 10 < 2) v[3] = 1;
      return v;
    };
    const hit = (r: number) => {
      const v = flat(0.4);
      if (r >= 30) v[3] = 0.85;
      return v;
    };
    const fresh = createDance();
    const first = Math.max(...run(fresh, 40, hit).heights.map((h) => h[3]));
    const paused = createDance();
    run(paused, 200, loud);
    clearDance(paused);
    expect(paused.peak).toBe(0.1);
    expect(paused.kick).toBe(0);
    expect(Array.from(paused.level).every((v) => v === 0)).toBe(true);
    const after = Math.max(...run(paused, 40, hit).heights.map((h) => h[3]));
    expect(after).toBeCloseTo(first, 6);
  });

  it('silence lets everything fall to zero height', () => {
    const s = createDance();
    run(s, 120, (r) => flat(r % 8 < 2 ? 0.9 : 0.5));
    const { out } = run(s, 30 * 6, () => flat(0));
    for (const v of out) expect(v).toBeLessThan(0.002);
  });
});

describe('the kick', () => {
  // A steady tone for 6 s first (music starting is itself a hit), then three rows of a bass hit at row 180.
  const kickRows = (r: number) => {
    const v = flat(0.4);
    if (r >= 180 && r < 183) for (let b = 0; b < 6; b++) v[b] = 0.95;
    return v;
  };

  it('stays 0 on a steady tone and rises fast on a bass hit, then falls back slowly', () => {
    const s = createDance();
    const { kicks } = run(s, 270, kickRows);
    expect(Math.max(...kicks.slice(150, 180))).toBeLessThan(0.001);
    expect(kicks[181]).toBeGreaterThan(0.4); // attack 0.02 s: most of the way up on the second hit row
    const top = Math.max(...kicks);
    expect(top).toBeGreaterThan(0.6);
    expect(top).toBeLessThanOrEqual(1);
    // Release 0.26 s: a quarter second after the hit it is still over a third of the top, two seconds later it is gone.
    expect(kicks[183 + 8]).toBeGreaterThan(top * 0.3);
    expect(kicks[269]).toBeLessThan(0.01);
  });

  it('ignores a hit above the kick bands (band 12 and up)', () => {
    const s = createDance();
    const { kicks } = run(s, 270, (r) => {
      const v = flat(0.4);
      if (r >= 180 && r < 183) for (let b = 12; b < 20; b++) v[b] = 0.95;
      return v;
    });
    expect(Math.max(...kicks.slice(150))).toBeLessThan(0.001);
  });
});

describe('no allocation in the frame loop', () => {
  it('stepping keeps every array of the state and the output, and writes into the ring in place', () => {
    const s = createDance();
    const arrays = [s.level, s.fast, s.slow, s.trs];
    const out = new Float32Array(DANCE_BANDS * 3);
    for (let r = 0; r < 300; r++) stepDance(s, flat(0.3 + 0.5 * ((r % 7) / 7)), DT, out, (r % 3) * DANCE_BANDS);
    expect([s.level, s.fast, s.slow, s.trs]).toEqual(arrays);
    arrays.forEach((a, i) => expect(a).toBe([s.level, s.fast, s.slow, s.trs][i]));
    // Rows other than the one written stay as they were: a row is written in place at its offset.
    const before = out.slice(DANCE_BANDS, DANCE_BANDS * 2);
    stepDance(s, flat(0.9), DT, out, 0);
    expect(out.slice(DANCE_BANDS, DANCE_BANDS * 2)).toEqual(before);
  });
});

describe('the turn hold', () => {
  /** Direction changes a second (moves of at least `th`) in a series sampled at 30 a second. */
  const turns = (a: number[], th: number) => {
    let n = 0;
    let dir = 0;
    let ext = a[0];
    for (let i = 1; i < a.length; i++) {
      if (dir >= 0) {
        if (a[i] > ext) ext = a[i];
        else if (ext - a[i] >= th) {
          n++;
          dir = -1;
          ext = a[i];
        }
      }
      if (dir < 0) {
        if (a[i] < ext) ext = a[i];
        else if (a[i] - ext >= th) {
          n++;
          dir = 1;
          ext = a[i];
        }
      }
    }
    return n / (a.length / 30);
  };

  it('a hit after quiet is not delayed: it rises on the very row the band jumps, as it would with no hold', () => {
    const s = createDance();
    run(s, 180, () => flat(0.4));
    const hit = flat(0.4);
    hit[10] = 0.95;
    const out = new Float32Array(DANCE_BANDS);
    const before = out.slice();
    stepDance(s, flat(0.4), DT, before);
    stepDance(s, hit, DT, out);
    expect(out[10]).toBeGreaterThan(before[10] + 0.3);
  });

  it('every band pumping on and off 6 times a second turns at most 8 times a second in the shaped output', () => {
    const s = createDance();
    const pump = (r: number) => flat(Math.floor((r / 30) * 12) % 2 === 0 ? 0.9 : 0.43);
    const { heights, kicks } = run(s, 600, pump);
    const mean = heights.slice(60).map((h) => h.reduce((a, b) => a + b, 0) / DANCE_BANDS);
    expect(turns(mean, 0.02)).toBeLessThanOrEqual(8);
    expect(turns(heights.slice(60).map((h) => h[10]), 0.02)).toBeLessThanOrEqual(8);
    expect(turns(kicks.slice(60), 0.05)).toBeLessThanOrEqual(8);
  });

  it('a one-row spike holds its peak for the hold time before it may fall, and then falls', () => {
    const s = createDance();
    run(s, 180, () => flat(0.4));
    const spike = flat(0.4);
    spike[10] = 1;
    const out: number[] = [];
    const o = new Float32Array(DANCE_BANDS);
    for (let r = 0; r < 14; r++) {
      stepDance(s, r === 0 ? spike : flat(0.4), DT, o);
      out.push(o[10]);
    }
    const peak = Math.max(...out);
    const at = out.indexOf(peak);
    const held = Math.ceil(DANCE_TURN_HOLD_S / DT - 1e-9);
    for (let r = at; r <= at + held - 1; r++) expect(out[r]).toBe(peak);
    expect(out[at + held + 2]).toBeLessThan(peak);
  });
});
