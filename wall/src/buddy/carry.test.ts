import { describe, expect, it } from 'vitest';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import {
  DIZZY_S,
  FALL,
  FALL_MIN_S,
  GRAVITY,
  HELD,
  LAND,
  LAND_S,
  MOVE,
  NONE,
  RETURN,
  SETTLE_S,
  SIDE_S,
  SIT,
  STRETCH_S,
  SURPRISE_S,
  TROT,
  beginCarry,
  callCarry,
  cancelCarry,
  carryFrame,
  deferCarry,
  landPending,
  pendingStale,
  createCarry,
  endStay,
  landingX,
  moveCarry,
  releaseCarry,
  startStay,
  stepCarry,
  type Carry,
} from './carry';
import { GROUNDS } from './ground';
import { WALKS, middle, spriteHeight, spriteWidth } from './model';
import { createMind, createPetFrame } from './petFrame';

const walk = WALKS.work;
const GROUND = GROUNDS.work;
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
  it('swings like a pendulum with the pointer speed, past upright once it stops, then hangs still', () => {
    const c = lifted();
    let most = 0;
    let T = 0;
    for (let i = 0; i < 30; i++) {
      T = run(c, T, 1 / 60, () => [600 + i * 25, 300]);
      if (Math.abs(c.tilt) > Math.abs(most)) most = c.tilt;
    }
    expect(Math.abs(most)).toBeGreaterThan(5);
    expect(Math.abs(most)).toBeLessThanOrEqual(16);
    // Carried to the right, he leans back against the way he goes.
    expect(most).toBeLessThan(0);
    const lean = -1;
    // Stopped: the swing carries him past upright before it settles (follow-through).
    let past = false;
    for (let i = 0; i < 60; i++) {
      T = run(c, T, 1 / 60, () => [600 + 29 * 25, 300]);
      if (Math.sign(c.tilt) === -lean && Math.abs(c.tilt) > 0.5) past = true;
    }
    expect(past).toBe(true);
    run(c, T, 3, () => [600 + 29 * 25, 300]);
    expect(Math.abs(c.tilt)).toBeLessThan(0.1);
    // Reduced motion never tilts him.
    const d = lifted();
    run(d, 0, 0.3, (i) => [600 + i * 25, 300], 985, true);
    expect(d.tilt).toBe(0);
  });
  it('turns to face the way he is carried after a steady move, and back', () => {
    const c = lifted();
    expect(c.dir).toBe(1);
    run(c, 0, 0.5, (i) => [1005 - i * 12, 300]);
    expect(c.dir).toBe(-1);
    run(c, 0.5, 0.5, (i) => [700 + i * 12, 300]);
    expect(c.dir).toBe(1);
    // A twitch shorter than the turn time does not turn him.
    const d = lifted();
    run(d, 0, 0.08, (i) => [1005 - i * 12, 300]);
    run(d, 0.08, 0.3, () => [1005 - 4 * 12, 300]);
    expect(d.dir).toBe(1);
    // Reduced motion never turns him.
    const e = lifted();
    run(e, 0, 0.5, (i) => [1005 - i * 12, 300], 985, true);
    expect(e.dir).toBe(1);
  });
  it('asks for a fast held line when he is carried quickly, and none once shaken', () => {
    const c = lifted();
    run(c, 0, 1.2, (i) => [200 + i * 20, 300]);
    expect(c.sayHeld).toBe(true);
    expect(c.heldFast).toBe(true);
    const d = lifted();
    run(d, 0, 1.2, () => [1000, 300]);
    expect(d.heldFast).toBe(false);
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
  it('drops straight down, at the nearest free spot of the place\'s ground, on every place', () => {
    // Anywhere free stays where it is; off the ground goes to the nearest free spot.
    expect(landingX(GROUND, 1500)).toBe(1500);
    expect(landingX(GROUND, 40)).toBe(GROUND[0].min);
    expect(landingX(GROUNDS.unwind, 800)).toBe(494);
    expect(landingX(GROUNDS.unwind, 1200)).toBe(1416);
    expect(landingX(GROUNDS.unwind, 2300)).toBe(1870);
    const c = lifted();
    run(c, 0, 0.5, () => [2300, 100]);
    const x = c.x;
    releaseCarry(c, 0.5, GROUND, HY, SIZE, false, false);
    expect(c.mode).toBe(FALL);
    expect(c.toX).toBe(x);
    expect(c.toY + spriteHeight('held', SIZE)).toBe(HY);
    // He does not move sideways while falling when the spot below is free.
    run(c, 0.5, 0.2);
    expect(c.x).toBe(x);
  });
  it('falls under gravity, faster the further it goes, then squashes, shakes his wool and sits', () => {
    for (const py of [HY - 60, 20]) {
      const c = lifted();
      run(c, 0, 0.5, () => [900, py]);
      releaseCarry(c, 0.5, GROUND, HY, SIZE, false, false);
      const drop = c.toY - c.y;
      expect(c.dur).toBeCloseTo(Math.max(FALL_MIN_S, Math.sqrt((2 * drop) / GRAVITY)), 6);
      const y0 = c.y;
      const T = run(c, 0.5, c.dur / 4);
      // Ease in: a quarter of the time covers well under a quarter of the way.
      expect(c.y - y0).toBeLessThan((c.toY - y0) / 4);
      run(c, T, c.dur);
      expect([LAND, SIT]).toContain(c.mode);
      expect(c.y + spriteHeight('land', SIZE)).toBeCloseTo(HY, 6);
    }
  });
  it('drifts to the nearest free spot only when the spot below is not free, within a quarter second', () => {
    const c = createCarry();
    beginCarry(c, 1, 1240, 300, 1200, 505, 1, 6, 0, false);
    run(c, 0, 0.4, () => [1240, 300]);
    releaseCarry(c, 0.4, GROUNDS.unwind, 505, 6, false, false);
    expect(c.toX).toBe(1416);
    let T = 0.4;
    for (let i = 0; i < 60; i++) {
      T += 1 / 60;
      stepCarry(c, 1 / 60, T, 505, 6, 1416, false, none);
    }
    expect(T - 0.4).toBeGreaterThan(SIDE_S);
    expect(c.x).toBe(1416);
  });
  it('his landed line is asked for only once he is down and his wool is shaken out, never in the air', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [900, 100]);
    releaseCarry(c, 0.5, GROUND, HY, SIZE, false, false);
    expect(c.sayLanded).toBe(false);
    let T = 0.5;
    let asked = -1;
    for (let i = 0; i < 180 && asked < 0; i++) {
      T += 1 / 60;
      stepCarry(c, 1 / 60, T, HY, SIZE, 985, false, none);
      if (c.sayLanded) asked = T;
      else expect(c.mode === FALL || c.mode === LAND).toBe(true);
    }
    expect(asked).toBeGreaterThan(0);
    expect(c.mode).toBe(SIT);
    expect(c.y + spriteHeight('land', SIZE)).toBeCloseTo(HY, 6);
    expect(asked - c.landT).toBeGreaterThanOrEqual(LAND_S - 1e-9);
  });
  it('an interruption from the page being hidden, or reduced motion, sets him there at once with no landing line', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [900, 100]);
    releaseCarry(c, 0.5, GROUND, HY, SIZE, true, true);
    expect(c.mode).toBe(SIT);
    expect(c.y + spriteHeight('land', SIZE)).toBe(HY);
    expect(c.sayLanded).toBe(false);
    // An interrupted fall (the window losing focus) lands with no line either.
    const d = lifted();
    run(d, 0, 0.5, () => [900, 100]);
    releaseCarry(d, 0.5, GROUND, HY, SIZE, false, true);
    run(d, 0.5, 2);
    expect(d.sayLanded).toBe(false);
  });
  it('sits a moment where he landed, then walks the short way to his wander at 14 px a second', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [1000, 200]);
    releaseCarry(c, 0.5, GROUND, HY, SIZE, false, false);
    let T = run(c, 0.5, 1.5);
    const x = c.x;
    expect(c.mode).toBe(SIT);
    // The sit lasts SETTLE_S once the landing is over.
    expect(c.settleUntil - c.landT).toBeCloseTo(LAND_S + SETTLE_S, 6);
    T = run(c, T, c.settleUntil - T - 0.1, undefined, x - 40);
    expect(c.mode).toBe(SIT);
    expect(c.x).toBe(x);
    T = run(c, T, 0.15, undefined, x - 40);
    expect(c.mode).toBe(RETURN);
    const before = c.x;
    run(c, T, 1, undefined, x - 40);
    expect(Math.abs(c.x - before)).toBeGreaterThan(12);
    expect(Math.abs(c.x - before)).toBeLessThan(15);
    run(c, T + 1, 10, undefined, x - 40);
    expect(c.mode).toBe(NONE);
    expect(c.x).toBe(x - 40);
    expect(c.arrived).toBe(true);
  });
  it('under reduced motion the sit ends in place, with no walk', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [1000, 200]);
    releaseCarry(c, 0.5, GROUND, HY, SIZE, true, false);
    run(c, 0.5, SETTLE_S + LAND_S + 2, undefined, 900, true);
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
    releaseCarry(c, T, GROUND, HY, SIZE, false, false);
    run(c, T, 1);
    // Dizzy for exactly 3 seconds once the landing is over.
    expect(c.dizzyUntil - c.landT).toBeCloseTo(LAND_S + DIZZY_S, 6);
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
  it('picked up: a surprised frame, a stretch, then held poses with the tuft, lifted, with a shadow below', () => {
    const c = lifted(985, 1, 0);
    const f = createPetFrame();
    carryFrame(c, SURPRISE_S / 2, HY, SIZE, false, m, f);
    expect(f.pose).toBe('alert');
    carryFrame(c, (SURPRISE_S + STRETCH_S) / 2, HY, SIZE, false, m, f);
    expect(f.squash).toBeGreaterThan(1.1);
    expect(f.sx).toBeLessThan(1);
    expect(f.tuft).toBe(true);
    run(c, 0, 0.5, () => [900, 200]);
    carryFrame(c, 1, HY, SIZE, false, m, f);
    expect(['held', 'held2']).toContain(f.pose);
    expect(HY - spriteHeight(f.pose, SIZE) - f.lift).toBeCloseTo(c.y, 6);
    expect(f.notes || f.z || f.hearts).toBe(false);
    expect(f.shadow).toBeGreaterThan(0);
  });
  it('falling stretches, landing squashes with dust, the wool shake shuts his eyes, then he stands and sits', () => {
    const c = lifted();
    run(c, 0, 0.5, () => [900, 200]);
    const f = createPetFrame();
    releaseCarry(c, 0.5, GROUND, HY, SIZE, false, false);
    let T = 0.5;
    let stretched = false;
    let squashed = false;
    let dust = false;
    let shook = false;
    let sat = false;
    for (let i = 0; i < 400 && !sat; i++) {
      T += 1 / 60;
      stepCarry(c, 1 / 60, T, HY, SIZE, 985, false, none);
      carryFrame(c, T, HY, SIZE, false, m, f);
      if (c.mode === FALL && f.squash > 1.05) stretched = true;
      if (c.mode === LAND && f.squash < 0.8) squashed = true;
      if (f.dust > 0) dust = true;
      if (c.mode === LAND && f.blink) shook = true;
      if (c.mode === SIT && f.pose === 'sit') sat = true;
    }
    expect([stretched, squashed, dust, shook, sat]).toEqual([true, true, true, true, true]);
  });
  it('the legs pedal between two frames, faster the faster he is carried; reduced motion holds one', () => {
    const c = lifted();
    const f = createPetFrame();
    const seen = new Set<string>();
    let T = 0;
    for (let i = 0; i < 60; i++) {
      T = run(c, T, 1 / 60, () => [900, 200]);
      carryFrame(c, T, HY, SIZE, false, m, f);
      if (T > STRETCH_S) seen.add(f.pose);
    }
    expect(seen.size).toBe(2);
    const slow = c.legT;
    const d = lifted();
    run(d, 0, 1, (i) => [400 + i * 20, 200]);
    expect(d.legT).toBeGreaterThan(slow * 1.5);
    seen.clear();
    const e = lifted();
    T = 0;
    for (let i = 0; i < 60; i++) {
      T = run(e, T, 1 / 60, () => [900, 200], 985, true);
      carryFrame(e, T, HY, SIZE, true, m, f);
      seen.add(f.pose);
    }
    expect(seen.size).toBe(1);
  });
});

describe('review fixes', () => {
  it('Stay switched off during the landing squash still ends the sit', () => {
    const c = createCarry();
    startStay(c, 0, 920, 1);
    beginCarry(c, 1, 1000, 300, 920, HY, 1, SIZE, 1, false);
    run(c, 1, 0.3, () => [1000, 200]);
    releaseCarry(c, 1.3, GROUND, HY, SIZE, false, false);
    let T = 1.3;
    while (c.mode !== LAND) {
      T += 1 / 60;
      stepCarry(c, 1 / 60, T, HY, SIZE, 985, false, none);
    }
    endStay(c, T);
    T = run(c, T, 1, undefined, 985);
    expect([RETURN, NONE]).toContain(c.mode);
    run(c, T, 30, undefined, 985);
    expect(c.mode).toBe(NONE);
  });
  it('a held carry deferred across a place change lands at its x on the new place\'s ground, at once', () => {
    const home = WALKS.home;
    const ground = GROUNDS.home;
    for (const [x, want] of [
      [2500, ground[0].max],
      [40, ground[0].min],
      [1600, 1600],
    ] as const) {
      const c = lifted();
      run(c, 0, 0.3, () => [x + 40, 200]);
      const kept = c.x;
      deferCarry(c, 4);
      expect(c.mode).toBe(NONE);
      expect(c.pendingX).toBe(kept);
      landPending(c, 5, ground, HY, home.px);
      expect(c.mode).toBe(SIT);
      expect(c.x).toBe(landingX(ground, kept));
      if (want !== 1600) expect(c.x).toBe(want);
      expect(c.y + spriteHeight('land', home.px)).toBe(HY);
      expect(c.pendingX).toBeNaN();
    }
  });
});

describe('a landing that waits for its place', () => {
  it('is given up after 10 seconds or when night starts, and a new carry clears it', () => {
    const c = lifted();
    run(c, 0, 0.3, () => [900, 200]);
    deferCarry(c, 5);
    expect(pendingStale(c, 14.9, false)).toBe(false);
    expect(pendingStale(c, 15.1, false)).toBe(true);
    expect(pendingStale(c, 6, true)).toBe(true);
    const none = createCarry();
    expect(pendingStale(none, 99, true)).toBe(false);
    beginCarry(c, 2, 900, 300, 900, HY, 1, SIZE, 6, false);
    expect(c.pendingX).toBeNaN();
  });
  it('a second deferral keeps the first x only if nothing is held (a second place change finds mode NONE)', () => {
    const c = lifted();
    run(c, 0, 0.3, () => [900, 200]);
    deferCarry(c, 1);
    const x = c.pendingX;
    // The component does not defer again when the mode is NONE; the kept x stands.
    expect(c.mode).toBe(NONE);
    expect(c.pendingX).toBe(x);
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
    releaseCarry(c, 1.5, GROUND, HY, SIZE, false, false);
    run(c, 1.5, 1.5);
    expect(c.mode).toBe(SIT);
    const x = c.x;
    run(c, 3, 120);
    expect(c.mode).toBe(SIT);
    expect(c.x).toBe(x);
  });
  it('Come here trots him to the middle at three times his pace and flags the arrival once', () => {
    const c = createCarry();
    callCarry(c, 0, 700, 1, middle(walk));
    expect(c.mode).toBe(RETURN);
    run(c, 0, 1, undefined, 1090);
    expect(c.x).toBeGreaterThan(700 + 14 * TROT - 1);
    expect(c.x).toBeLessThan(700 + 14 * TROT + 1);
    run(c, 1, 30, undefined, 1090);
    expect(c.mode).toBe(NONE);
    expect(c.x).toBe(middle(walk));
    expect(c.arrived).toBe(true);
    expect(c.speed).toBe(1);
  });
  it('a spot he cannot walk to (across Unwind\'s transport row) he fades out and in at', () => {
    const c = createCarry();
    callCarry(c, 0, 1600, 1, 450, false);
    expect(c.mode).toBe(MOVE);
    run(c, 0, 0.2);
    expect(c.fade).toBeLessThan(1);
    expect(c.x).toBe(1600);
    run(c, 0.2, 0.3);
    expect(c.x).toBe(450);
    run(c, 0.5, 1);
    expect(c.mode).toBe(NONE);
    expect(c.fade).toBe(1);
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
