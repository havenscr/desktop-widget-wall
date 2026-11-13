import { describe, expect, it } from 'vitest';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import {
  DIZZY_S,
  FALL,
  FALL_MAX_S,
  FALL_MIN_S,
  HELD,
  LAND,
  NONE,
  RETURN,
  SETTLE_S,
  SIT,
  beginCarry,
  callCarry,
  cancelCarry,
  carryFrame,
  createCarry,
  endStay,
  landingX,
  moveCarry,
  releaseCarry,
  startStay,
  stepCarry,
  type Carry,
} from './carry';
import { WALKS, middle, spriteHeight, spriteWidth } from './model';
import { createMind, createPetFrame } from './petFrame';

const walk = WALKS.work;
const HY = 582;
const SIZE = walk.px;
const none = { prop: null, scarf: false, cosmetic: null } as const;

/** Run `seconds` of 60 Hz steps, optionally moving the pointer each step. */
function run(c: Carry, from: number, seconds: number, move?: (i: number) => [number, number], home = middle(walk), still = false): number {
  let T = from;
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    if (move) {
      const [x, y] = move(i);
      moveCarry(c, x, y);
    }
    T += 1 / 60;
    stepCarry(c, 1 / 60, T, HY, SIZE, home, still, none);
  }
  return T;
}
const lifted = (x = 985, id = 1, T = 0, mayTalk = true) => {
  const c = createCarry();
  beginCarry(c, id, x + 20, 560, x, HY, 1, SIZE, T, mayTalk);
  return c;
};

describe('being carried', () => {
  it('follows the pointer by a grab point on his back, and settles onto it', () => {
    const c = lifted();
    const T = run(c, 0, 0.6, () => [1500, 300]);
    const w = spriteWidth('held', SIZE);
    const h = spriteHeight('held', SIZE);
    expect(c.x).toBeCloseTo(1500 - 0.38 * w, 1);
    expect(c.y).toBeCloseTo(300 - 0.14 * h, 1);
    expect(T).toBeGreaterThan(0);
  });
  it('is kept whole on the stage whatever the pointer does', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [-5000, -5000]);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    run(c, 0.5, 0.5, () => [99999, 99999]);
    expect(c.x + spriteWidth('held', SIZE)).toBeLessThanOrEqual(STAGE_WIDTH);
    expect(c.y + spriteHeight('held', SIZE)).toBeLessThanOrEqual(STAGE_HEIGHT);
  });
  it('keeps props on the stage too: a prop on his head cannot cross the top edge', () => {
    const c = lifted();
    const props = { prop: 'umbrella', scarf: false, cosmetic: null } as const;
    moveCarry(c, 600, -400);
    for (let i = 0; i < 60; i++) stepCarry(c, 1 / 60, i / 60, HY, SIZE, 985, false, props);
    // The umbrella rises two sprite pixels above his head row 0 (see propFits), and the box keeps it in.
    expect(c.y).toBeGreaterThanOrEqual(0);
  });
  it('tilts with the pointer speed and straightens when it stops', () => {
    const c = lifted();
    run(c, 0, 0.3, (i) => [600 + i * 25, 300]);
    expect(Math.abs(c.tilt)).toBeGreaterThan(5);
    expect(Math.abs(c.tilt)).toBeLessThanOrEqual(14);
    run(c, 0.3, 2, () => [600 + 18 * 25, 300]);
    expect(Math.abs(c.tilt)).toBeLessThan(0.1);
    // Reduced motion never tilts him.
    const d = lifted();
    run(d, 0, 0.3, (i) => [600 + i * 25, 300], 985, true);
    expect(d.tilt).toBe(0);
  });
  it('asks for a held line once, a second in, and only when the carry may talk', () => {
    const c = lifted();
    let said = 0;
    for (let i = 0; i < 360; i++) {
      stepCarry(c, 1 / 60, i / 60, HY, SIZE, 985, false, none);
      if (c.sayHeld) {
        said++;
        c.sayHeld = false;
        expect(i / 60).toBeGreaterThanOrEqual(1);
      }
    }
    expect(said).toBe(1);
    const mute = lifted(985, 1, 0, false);
    for (let i = 0; i < 360; i++) stepCarry(mute, 1 / 60, i / 60, HY, SIZE, 985, false, none);
    expect(mute.sayHeld).toBe(false);
  });
});

describe('being set down', () => {
  it('lands at the pointer x kept inside his span, on the ground line, on every place', () => {
    for (const w of Object.values(WALKS)) {
      expect(landingX(w, w.min - 500)).toBe(w.min);
      expect(landingX(w, w.max + 500)).toBe(w.max);
      expect(landingX(w, (w.min + w.max) / 2)).toBe((w.min + w.max) / 2);
    }
    const c = lifted();
    run(c, 0, 0.5, () => [2300, 100]);
    releaseCarry(c, 0.5, walk, HY, SIZE, false, false);
    expect(c.mode).toBe(FALL);
    expect(c.toX).toBe(walk.max);
    expect(c.toY + spriteHeight('held', SIZE)).toBe(HY);
  });
  it('falls in 300 to 500 ms by height, easing in, then squashes once and sits', () => {
    for (const [py, want] of [
      [HY - 60, FALL_MIN_S],
      [20, FALL_MAX_S],
    ] as const) {
      const c = lifted();
      run(c, 0, 0.5, () => [900, py]);
      releaseCarry(c, 0.5, walk, HY, SIZE, false, false);
      expect(c.dur).toBeGreaterThanOrEqual(FALL_MIN_S);
      expect(c.dur).toBeLessThanOrEqual(FALL_MAX_S);
      if (py === 20) expect(c.dur).toBeGreaterThan(0.45);
      else expect(c.dur).toBeLessThan(want + 0.06);
      const y0 = c.y;
      const T = run(c, 0.5, c.dur / 4);
      // Ease in: a quarter of the time covers well under a quarter of the way.
      expect(c.y - y0).toBeLessThan((c.toY - y0) / 4);
      run(c, T, c.dur);
      expect([LAND, SIT]).toContain(c.mode);
      expect(c.y + spriteHeight('land', SIZE)).toBeCloseTo(HY, 6);
    }
  });
  it('an interruption from the page being hidden, or reduced motion, sets him there at once with no landing line', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [900, 100]);
    releaseCarry(c, 0.5, walk, HY, SIZE, true, true);
    expect(c.mode).toBe(SIT);
    expect(c.y + spriteHeight('land', SIZE)).toBe(HY);
    expect(c.sayLanded).toBe(false);
    // A normal release asks for a landing line.
    const d = lifted();
    run(d, 0, 0.5, () => [900, 100]);
    releaseCarry(d, 0.5, walk, HY, SIZE, false, false);
    expect(d.sayLanded).toBe(true);
  });
  it('sits for 20 seconds where he landed, then walks back to his wander at 14 px a second and is himself again', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [1000, 200]);
    releaseCarry(c, 0.5, walk, HY, SIZE, false, false);
    let T = run(c, 0.5, 1);
    const x = c.x;
    expect(c.mode).toBe(SIT);
    T = run(c, T, SETTLE_S - 2, undefined, 900);
    expect(c.mode).toBe(SIT);
    expect(c.x).toBe(x);
    T = run(c, T, 2.5, undefined, 900);
    expect(c.mode).toBe(RETURN);
    const before = c.x;
    run(c, T, 1, undefined, 900);
    expect(Math.abs(c.x - before)).toBeGreaterThan(12);
    expect(Math.abs(c.x - before)).toBeLessThan(15);
    run(c, T + 1, 30, undefined, 900);
    expect(c.mode).toBe(NONE);
    expect(c.x).toBe(900);
    expect(c.arrived).toBe(true);
  });
  it('under reduced motion the sit ends in place, with no walk', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [1000, 200]);
    releaseCarry(c, 0.5, walk, HY, SIZE, true, false);
    run(c, 0.5, SETTLE_S + 2, undefined, 900, true);
    expect(c.mode).toBe(NONE);
  });
});

describe('shaking him', () => {
  it('three fast direction changes inside a second make him shaken', () => {
    const c = lifted();
    // Eight quick swings of 120 px in 8 x 6 frames = 0.8 s.
    let x = 900;
    let dir = 1;
    let T = 0;
    for (let i = 0; i < 70; i++) {
      if (i % 6 === 0) dir = -dir;
      x += dir * 30;
      moveCarry(c, x, 300);
      T += 1 / 60;
      stepCarry(c, 1 / 60, T, HY, SIZE, 985, false, none);
    }
    expect(c.shaken).toBe(true);
    releaseCarry(c, T, walk, HY, SIZE, false, false);
    run(c, T, 1);
    // Dizzy for exactly 3 seconds from landing.
    expect(c.dizzyUntil - c.landT).toBeCloseTo(DIZZY_S, 6);
  });
  it('slow swings, small swings, or only one change do not', () => {
    const slow = lifted();
    let x = 900;
    let dir = 1;
    for (let i = 0; i < 240; i++) {
      if (i % 30 === 0) dir = -dir;
      x += dir * 2;
      moveCarry(slow, x, 300);
      stepCarry(slow, 1 / 60, i / 60, HY, SIZE, 985, false, none);
    }
    expect(slow.shaken).toBe(false);
    const small = lifted();
    x = 900;
    dir = 1;
    for (let i = 0; i < 120; i++) {
      if (i % 3 === 0) dir = -dir;
      x += dir * 10;
      moveCarry(small, x, 300);
      stepCarry(small, 1 / 60, i / 60, HY, SIZE, 985, false, none);
    }
    expect(small.shaken).toBe(false);
    const once = lifted();
    run(once, 0, 0.3, (i) => [900 + i * 30, 300]);
    run(once, 0.3, 0.3, (i) => [1440 - i * 30, 300]);
    expect(once.shaken).toBe(false);
  });
});

describe('the frame he is drawn in', () => {
  const m = createMind();
  it('held and falling are held poses lifted off the ground; landing squashes; sitting sits', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [900, 200]);
    const f = createPetFrame();
    carryFrame(c, 1, HY, SIZE, false, m, f);
    expect(['held', 'held2']).toContain(f.pose);
    expect(HY - spriteHeight(f.pose, SIZE) - f.lift).toBeCloseTo(c.y, 6);
    expect(f.notes || f.z || f.hearts).toBe(false);
    releaseCarry(c, 0.5, walk, HY, SIZE, false, false);
    let T = 0.5;
    let squashed = false;
    for (let i = 0; i < 120; i++) {
      T += 1 / 60;
      stepCarry(c, 1 / 60, T, HY, SIZE, 985, false, none);
      carryFrame(c, T, HY, SIZE, false, m, f);
      if (c.mode === LAND) {
        expect(f.pose).toBe('land');
        if (f.squash < 1) squashed = true;
      }
      if (c.mode === SIT) {
        expect(f.pose).toBe('sit');
        expect(f.lift).toBe(0);
        break;
      }
    }
    expect(squashed).toBe(true);
  });
  it('the legs sway between two frames; reduced motion holds one', () => {
    const c = lifted();
    run(c, 0, 0.4, () => [900, 200]);
    const f = createPetFrame();
    const seen = new Set<string>();
    for (let t = 0; t < 2; t += 0.05) {
      carryFrame(c, t, HY, SIZE, false, m, f);
      seen.add(f.pose);
    }
    expect(seen.size).toBe(2);
    seen.clear();
    for (let t = 0; t < 2; t += 0.05) {
      carryFrame(c, t, HY, SIZE, true, m, f);
      seen.add(f.pose);
    }
    expect(seen.size).toBe(1);
  });
});

describe('Stay and Come here', () => {
  it('Stay sits him down for good until it is switched off, then he walks back', () => {
    const c = createCarry();
    startStay(c, 0, 920, 1);
    expect(c.mode).toBe(SIT);
    expect(c.x).toBe(920);
    const T = run(c, 0, 600, undefined, 1000);
    expect(c.mode).toBe(SIT);
    expect(c.x).toBe(920);
    endStay(c, T);
    run(c, T, 0.1, undefined, 1000);
    expect(c.mode).toBe(RETURN);
    run(c, T + 0.1, 20, undefined, 1000);
    expect(c.mode).toBe(NONE);
  });
  it('a carry while Stay is on sets him down to stay at the new spot', () => {
    const c = createCarry();
    startStay(c, 0, 920, 1);
    beginCarry(c, 1, 1000, 300, 920, HY, 1, SIZE, 1, false);
    expect(c.stay).toBe(true);
    run(c, 1, 0.5, () => [1040, 200]);
    releaseCarry(c, 1.5, walk, HY, SIZE, false, false);
    run(c, 1.5, 1.5);
    expect(c.mode).toBe(SIT);
    const x = c.x;
    run(c, 3, 120);
    expect(c.mode).toBe(SIT);
    expect(c.x).toBe(x);
  });
  it('Come here walks him to the middle at 14 px a second and flags the arrival once', () => {
    const c = createCarry();
    callCarry(c, 0, 880, 1, middle(walk));
    expect(c.mode).toBe(RETURN);
    run(c, 0, 1, undefined, 1090);
    expect(c.x).toBeGreaterThan(880);
    expect(c.x).toBeLessThan(880 + 15);
    run(c, 1, 30, undefined, 1090);
    expect(c.mode).toBe(NONE);
    expect(c.x).toBe(middle(walk));
    expect(c.arrived).toBe(true);
  });
  it('cancelling forgets everything, Stay included', () => {
    const c = createCarry();
    startStay(c, 0, 920, 1);
    cancelCarry(c);
    expect(c.mode).toBe(NONE);
    expect(c.stay).toBe(false);
  });
});

void HELD;
