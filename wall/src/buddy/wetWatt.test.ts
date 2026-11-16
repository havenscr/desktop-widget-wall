import { describe, expect, it } from 'vitest';
import { POSES, SPRITES } from './sprites';
import {
  DRIPS,
  DRIP_EVERY_S,
  DRIP_PIX,
  DRIP_POSES,
  FLUFFY_S,
  LEAN_POSES,
  SHAKE_GAP_S,
  STRAND_POSES,
  THROWN,
  WATER_PIX,
  WAIT_POLL_S,
  createShakeClock,
  createWater,
  dripAt,
  fluffyAt,
  parseWattWx,
  shakeFrame,
  shakeGap,
  shakeRows,
  shaking,
  stepShake,
  thrownAt,
  wetRestFor,
} from './wetWatt';

const IDLE = SPRITES.idle;
const drip = (T: number, map: readonly string[] = IDLE) => {
  const w = createWater();
  dripAt(T, map, w);
  return w;
};

describe('the drip', () => {
  it('hangs for half a second at its first row, then falls a small pixel every 70 ms', () => {
    // The first drip is DRIPS[0] = column 8, row 10: small pixel (16, 20).
    expect(DRIPS[0]).toEqual([8, 10]);
    for (const T of [0, 0.25, 0.49]) expect(drip(T)[0]).toMatchObject({ on: true, x: 16, y: 20, a: 0.9 });
    expect(drip(0.5)[0]).toMatchObject({ on: true, x: 16, y: 20 });
    expect(drip(0.5 + 0.07 * 1.01)[0]).toMatchObject({ on: true, x: 16, y: 21 });
    expect(drip(0.5 + 0.07 * 3.5)[0]).toMatchObject({ on: true, x: 16, y: 23 });
    // Four steps take it from row 20 to the last small row above the ground (24 small rows).
    expect(drip(0.5 + 0.07 * 3.5)[0].y).toBe(23);
  });

  it('lands: two pixels at half strength either side for 140 ms, then nothing until the next drip', () => {
    const rowsDown = (12 - 10) * 2;
    const land = drip(0.5 + 0.07 * (rowsDown + 0.5));
    expect(land[0]).toMatchObject({ on: true, x: 15, y: 23, a: 0.5 });
    expect(land[1]).toMatchObject({ on: true, x: 17, y: 23, a: 0.5 });
    const after = drip(0.5 + 0.07 * (rowsDown + 2.5));
    expect(after[0].on).toBe(false);
    expect(after[1].on).toBe(false);
  });

  it('takes the six places in turn, one every 1.7 s, the fourth under the chin', () => {
    DRIPS.forEach(([c, r], n) => {
      const w = drip(n * DRIP_EVERY_S + 0.1);
      expect(w[0]).toMatchObject({ on: true, x: c * 2, y: r * 2 });
    });
    expect(DRIPS[3]).toEqual([16, 7]);
    expect(drip(6 * DRIP_EVERY_S + 0.1)[0]).toMatchObject({ x: 16, y: 20 });
  });

  it('is skipped when its start cell has no pixel above it or sits on a pixel itself', () => {
    // No wool above column 8 in a flat map.
    expect(drip(0.1, ['................', '................'])[0].on).toBe(false);
    // The walking frame has a leg at column 11: the sixth drip (11, 10) is skipped there.
    const n5 = 5 * DRIP_EVERY_S + 0.1;
    expect(drip(n5, SPRITES.idle)[0].on).toBe(true);
    expect(drip(n5, SPRITES.walk)[0].on).toBe(false);
    // The map's own height decides the ground.
    expect(drip(0.1, SPRITES.sleep)[0].on).toBe(false);
  });

  it('every drip pose has wool above the first place', () => {
    for (const pose of DRIP_POSES) {
      const w = createWater();
      let shown = 0;
      for (let n = 0; n < DRIPS.length; n++) {
        dripAt(n * DRIP_EVERY_S + 0.1, SPRITES[pose], w);
        if (w[0].on) shown++;
      }
      expect(shown, pose).toBeGreaterThan(2);
    }
  });
});

describe('the shake clock', () => {
  it('gaps are 45 to 75 seconds from a fixed hash', () => {
    const gaps = Array.from({ length: 200 }, (_, n) => shakeGap(n));
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(SHAKE_GAP_S[0]);
      expect(g).toBeLessThan(SHAKE_GAP_S[1]);
    }
    expect(shakeGap(3)).toBe(shakeGap(3));
    expect(new Set(gaps.map((g) => g.toFixed(3))).size).toBeGreaterThan(100);
    expect(Math.min(...gaps)).toBeLessThan(52);
    expect(Math.max(...gaps)).toBeGreaterThan(68);
  });

  it('schedules the first shake from the moment rain shows, not from the start', () => {
    const c = createShakeClock();
    stepShake(c, 1000, true, false);
    expect(c.armed).toBe(false);
    stepShake(c, 1000, true, true);
    expect(c.armed).toBe(true);
    expect(c.nextShake).toBeCloseTo(1000 + shakeGap(0), 6);
    stepShake(c, 1000 + shakeGap(0) - 0.01, true, true);
    expect(c.shakeFrom).toBe(-1);
    stepShake(c, 1000 + shakeGap(0) + 0.01, true, true);
    expect(c.shakeFrom).toBeCloseTo(1000 + shakeGap(0) + 0.01, 6);
    expect(c.n).toBe(1);
    expect(c.nextShake - c.shakeFrom).toBeCloseTo(shakeGap(1), 6);
  });

  it('a shake that is due while he is not eligible waits for the next eligible moment', () => {
    const c = createShakeClock();
    stepShake(c, 0, true, true);
    const due = c.nextShake;
    for (let t = due; t < due + 30; t += 0.5) stepShake(c, t, false, true);
    expect(c.shakeFrom).toBe(-1);
    stepShake(c, due + 30.2, true, true);
    expect(c.shakeFrom).toBeCloseTo(due + 30.2, 6);
  });

  it('rain that stops disarms it: the next rain starts a fresh gap', () => {
    const c = createShakeClock();
    stepShake(c, 0, true, true);
    stepShake(c, 10, true, false);
    expect(c.armed).toBe(false);
    stepShake(c, 500, true, true);
    expect(c.nextShake).toBeCloseTo(500 + shakeGap(0), 6);
    expect(c.shakeFrom).toBe(-1);
  });

  it('four frames of 80 ms, then droplets to 720 ms, then five seconds of fluffy wool, then damp again', () => {
    const c = createShakeClock();
    stepShake(c, 0, true, true);
    const t0 = c.nextShake;
    stepShake(c, t0, true, true);
    const at = (u: number) => t0 + u;
    expect(shakeFrame(at(0), c)).toBe(0);
    expect(shakeFrame(at(0.079), c)).toBe(0);
    expect(shakeFrame(at(0.081), c)).toBe(1);
    expect(shakeFrame(at(0.241), c)).toBe(3);
    expect(shakeFrame(at(0.321), c)).toBe(4);
    expect(shakeFrame(at(0.71), c)).toBe(8);
    expect(shakeFrame(at(0.73), c)).toBe(-1);
    expect([0, 1, 2, 3, 4, -1].map(shakeRows)).toEqual([1, 2, 3, 4, 0, 0]);
    expect(fluffyAt(at(0.3), c)).toBe(false);
    expect(fluffyAt(at(0.33), c)).toBe(true);
    expect(fluffyAt(at(0.32 + FLUFFY_S - 0.01), c)).toBe(true);
    expect(fluffyAt(at(0.32 + FLUFFY_S + 0.01), c)).toBe(false);
    expect(shaking(at(2), c)).toBe(true);
    expect(shaking(at(6), c)).toBe(false);
    // No new shake while the spell is on, even when asked.
    const n = c.n;
    stepShake(c, at(1), true, true);
    expect(c.n).toBe(n);
  });
});

describe('the droplets', () => {
  const at = (k: number) => {
    const w = createWater();
    thrownAt(k, w);
    return w;
  };
  it('none in the first frame, seven from the second to the ninth frame, then none', () => {
    expect(at(0).filter((p) => p.on)).toHaveLength(0);
    for (const k of [1, 4, 8]) expect(at(k).filter((p) => p.on)).toHaveLength(THROWN.length);
    expect(at(9).filter((p) => p.on)).toHaveLength(0);
    expect(at(-1).filter((p) => p.on)).toHaveLength(0);
    expect(THROWN).toHaveLength(7);
  });
  it('fly as x + 1.25 vx k and y + 1.25 vy k + 0.16 k squared on the small grid, strong at first then half', () => {
    const w = at(2);
    THROWN.forEach(([x, y, vx, vy], i) => {
      const p = w[DRIP_PIX + i];
      expect(p.x).toBe(Math.round((x + vx * 2 * 1.25) * 2));
      expect(p.y).toBe(Math.round((y + vy * 2 * 1.25 + 0.16 * 4) * 2));
      expect(p.a).toBe(0.9);
    });
    expect(at(5)[DRIP_PIX].a).toBe(0.9);
    expect(at(6)[DRIP_PIX].a).toBe(0.45);
    expect(WATER_PIX).toBe(9);
  });
});

describe('how long the loop may rest in rain', () => {
  it('is unbounded when the weather shows nothing', () => {
    const c = createShakeClock();
    expect(wetRestFor(5, c, false, true, 12)).toBe(Infinity);
  });
  it('is at most the time to the next drip step', () => {
    const c = createShakeClock();
    // Not armed, so no shake counts: only the drip. Hanging at 0.1 s: 0.4 s to the end of the hang.
    expect(wetRestFor(0.1, c, true, true, 12)).toBeCloseTo(0.4, 6);
    // Falling: 0.57 s is in the first step, which ends at 0.57; at 0.60 the next ends at 0.64.
    expect(wetRestFor(0.6, c, true, true, 12)).toBeCloseTo(0.04, 6);
    // After the splash the next drip is due at 1.7 s.
    const n = 0.5 + 0.07 * (4 + 2 + 1);
    expect(wetRestFor(n + 0.01, c, true, true, 12)).toBeCloseTo(DRIP_EVERY_S - n - 0.01, 6);
    // A pose that cannot drip has nothing to wake for.
    expect(wetRestFor(0.1, c, true, false, 12)).toBe(Infinity);
  });
  it('wakes for the next shake due, polls when one is due but waiting, and follows a shake frame by frame', () => {
    const c = createShakeClock();
    stepShake(c, 0, true, true);
    expect(wetRestFor(1, c, true, false, 12)).toBeCloseTo(c.nextShake - 1, 6);
    expect(wetRestFor(c.nextShake + 3, c, true, false, 12)).toBe(WAIT_POLL_S);
    stepShake(c, c.nextShake, true, true);
    const t0 = c.shakeFrom;
    expect(wetRestFor(t0 + 0.01, c, true, false, 12)).toBeCloseTo(0.07, 6);
    expect(wetRestFor(t0 + 0.1, c, true, false, 12)).toBeCloseTo(0.06, 6);
    // After the droplets only the end of the fluffy spell is left.
    expect(wetRestFor(t0 + 1, c, true, false, 12)).toBeCloseTo(0.32 + FLUFFY_S - 1, 6);
  });
});

describe('pose sets', () => {
  it('match the brief', () => {
    expect([...DRIP_POSES].sort()).toEqual(['alert', 'eat', 'idle', 'look', 'stretch', 'walk', 'yawn']);
    const lean = ['idle', 'walk', 'look', 'alert', 'eat', 'yawn', 'stretch', 'sit', 'read', 'watch', 'watchEar', 'sleep', 'lie'];
    expect([...LEAN_POSES].sort()).toEqual([...lean].sort());
    expect([...STRAND_POSES].sort()).toEqual(['alert', 'eat', 'idle', 'look', 'sit', 'stretch', 'walk', 'yawn']);
    for (const set of [DRIP_POSES, LEAN_POSES, STRAND_POSES]) for (const p of set) expect(POSES).toContain(p);
    for (const p of ['held', 'held2', 'land', 'hop', 'spin1', 'spin2', 'dizzy', 'front']) {
      expect(LEAN_POSES.has(p as never)).toBe(false);
      expect(DRIP_POSES.has(p as never)).toBe(false);
    }
  });
});

describe('the review knob', () => {
  it('reads the five forced frames and nothing else', () => {
    expect(parseWattWx('?wattwx=drip')).toEqual({ kind: 'drip', k: 0 });
    expect(parseWattWx('?wattwx=shake3')).toEqual({ kind: 'shake', k: 2 });
    expect(parseWattWx('?wattwx=fluffy')?.kind).toBe('fluffy');
    expect(parseWattWx('?wattwx=lean')?.kind).toBe('lean');
    for (const bad of ['', '?wattwx=shake5', '?wattwx=shake0', '?wattwx=other', '?x=1']) expect(parseWattWx(bad)).toBeNull();
  });
});
