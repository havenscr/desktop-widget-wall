import { describe, expect, it } from 'vitest';
import { LIFE_EVERY_S, LIFE_FIRST_S, LIFE_JITTER_S, LIFE_S, LOOK_ROUND_S, SEAT_CLEARANCE, SEAT_GAP, SEAT_NEAR, facing, followShow, lifeAt, newShowTrack, ownerPinned, ownerTouched, seatFor, showRole, watchLook, watchRestFor, type Marquee, type ShowInput } from './audience';
import { WATCH_GROUND, groundOf, seatGround } from './ground';
import { SPRITES } from './sprites';

const W = 108;
/** Two invented screens, nowhere near each other. */
const A = { x: 1300, y: 50, w: 700, h: 394 };
const B = { x: 860, y: 90, w: 600, h: 338 };

describe('his seat', () => {
  /** The wall's real numbers: the screen at x 1244 and the Look switch ending at x 1084. */
  const SCREEN = { x: 1244, y: 54, w: 672, h: 378 };
  const SWITCH = { x0: 584, x1: 1084 };

  it('with the real screen and the Look switch, his left edge is 1106: 30 px from the screen, 22 px from the switch', () => {
    const x = seatFor(SCREEN, [SWITCH], W)!;
    expect(x).toBe(1106);
    expect(SCREEN.x - (x + W)).toBe(SEAT_GAP);
    expect(x - SWITCH.x1).toBe(SEAT_CLEARANCE);
  });

  it('is the rightmost point that keeps 30 px from the screen when nothing stands at his height', () => {
    for (const s of [A, B]) {
      const x = seatFor(s, [], W)!;
      expect(x + W).toBe(s.x - SEAT_GAP);
    }
    expect(seatFor(A, [], W)).not.toBe(seatFor(B, [], W));
  });

  it('does not depend on the Look switch existing: the same seat without it', () => {
    expect(seatFor(SCREEN, [], W)).toBe(1106);
  });

  it('has its own ground: it reaches the screen while the Watch ground (his wander) stops at 1020', () => {
    expect(seatGround(SCREEN.x - SEAT_GAP - W)).toEqual([expect.objectContaining({ min: WATCH_GROUND[0].min, max: 1106 })]);
    expect(WATCH_GROUND[0].max).toBe(1020);
    expect(groundOf('unwind', true)[0].max).toBe(1020);
    expect(seatGround(100)).toEqual([]);
  });

  it('a control beside him, left or right, is kept 22 px away; the seat moves to its far side when it must', () => {
    // A card right of his spot, reaching into the 22 px: he moves left of it.
    const card = { x0: SCREEN.x - 20, x1: SCREEN.x + 200 };
    const x = seatFor(SCREEN, [card], W)!;
    expect(x + W).toBeLessThanOrEqual(card.x0 - SEAT_CLEARANCE);
    // A control standing across his spot: left of it when that is near enough, else no seat.
    const wide = { x0: 1000, x1: 1200 };
    expect(seatFor(SCREEN, [wide], W)).toBe(1000 - W - SEAT_CLEARANCE);
    expect(seatFor(SCREEN, [{ x0: 700, x1: 1200 }], W)).toBeNull();
  });

  it('no seat further than 300 px from the screen: he watches from where he stands', () => {
    expect(seatFor(SCREEN, [{ x0: 0, x1: 2560 }], W)).toBeNull();
    const far = seatFor(SCREEN, [{ x0: 1000, x1: 1200 }], W)!;
    expect(SCREEN.x - (far + W)).toBeLessThanOrEqual(SEAT_NEAR);
    // A screen too near the left end for any ground at all.
    expect(seatFor({ x: 200, y: 0, w: 600, h: 300 }, [], W)).toBeNull();
  });

  it('follows the rectangle it is given', () => {
    expect(seatFor({ x: 900, y: 0, w: 600, h: 300 }, [], W)).toBe(900 - SEAT_GAP - W);
  });

  it('he faces the screen from it', () => {
    expect(facing(A, seatFor(A, [], W)!, W)).toBe(1);
    expect(facing({ x: 100, y: 0, w: 200, h: 100 }, 900, W)).toBe(-1);
  });
});

describe('what the show asks of him, in order', () => {
  const base: ShowInput = { screen: A, marquee: 'playing', onWatch: true, inCall: false, reading: false, recording: false, menuOpen: false, napping: false, engaged: false, pinned: false };
  it('watch when nothing else holds him', () => {
    expect(showRole(base)).toBe('watch');
    expect(showRole({ ...base, marquee: 'paused' })).toBe('watch');
  });

  it('off with no show: no screen, the video parked (not on the Watch tab), nothing chosen, or ended', () => {
    expect(showRole({ ...base, screen: null })).toBe('off');
    expect(showRole({ ...base, onWatch: false })).toBe('off');
    expect(showRole({ ...base, marquee: 'none' })).toBe('off');
    expect(showRole({ ...base, marquee: 'ended', engaged: true })).toBe('off');
  });

  it('waiting (loading, a click awaited): not at the show yet means off; inside a show he is at, he keeps his seat', () => {
    expect(showRole({ ...base, marquee: 'waiting' })).toBe('off');
    expect(showRole({ ...base, marquee: 'waiting', engaged: true })).toBe('hold');
    expect(showRole({ ...base, marquee: 'waiting', engaged: true, inCall: true })).toBe('off');
  });

  // Every condition, in the order of the doc comment: each outranks the ones after it.
  const ORDER: readonly (keyof ShowInput)[] = ['inCall', 'reading', 'recording', 'menuOpen', 'napping', 'pinned'];
  const EXPECT: Record<string, 'off' | 'hold'> = { inCall: 'off', reading: 'off', recording: 'hold', menuOpen: 'hold', napping: 'hold', pinned: 'hold' };
  it('for every pair that can meet, the earlier one decides (a call, reading, recording, menu, nap, the owner\'s hand)', () => {
    for (let i = 0; i < ORDER.length; i++) {
      expect(showRole({ ...base, [ORDER[i]]: true })).toBe(EXPECT[ORDER[i]]);
      for (let j = i + 1; j < ORDER.length; j++) {
        expect(showRole({ ...base, [ORDER[i]]: true, [ORDER[j]]: true }), `${ORDER[i]} over ${ORDER[j]}`).toBe(EXPECT[ORDER[i]]);
      }
    }
    // All at once, and every later one with all the earlier ones off.
    expect(showRole({ ...base, inCall: true, reading: true, recording: true, menuOpen: true, napping: true, pinned: true })).toBe('off');
    expect(showRole({ ...base, reading: true, recording: true, menuOpen: true, napping: true, pinned: true })).toBe('off');
    expect(showRole({ ...base, recording: true, menuOpen: true, napping: true, pinned: true })).toBe('hold');
  });

  it('a hold never walks him: it is the one role that leaves the seat alone, and it ends when its cause does', () => {
    const roles = new Set<string>();
    for (const m of ['menuOpen', 'napping', 'pinned', 'recording'] as const) roles.add(showRole({ ...base, [m]: true }));
    expect([...roles]).toEqual(['hold']);
    expect(showRole({ ...base, menuOpen: false, napping: false })).toBe('watch');
  });

  it('the leave banner takes none of his Watch ground, so it cannot move the seat on Unwind', () => {
    expect(groundOf('unwind', true, true)).toEqual(groundOf('unwind', true, false));
  });
});

describe('one show at a time: the owner\'s hand holds for the show it happened in', () => {
  const on = (t: ReturnType<typeof newShowTrack>, m: Marquee) => followShow(t, m);

  it('a drop during a show pins him until that show ends, and not for the next one', () => {
    const t = newShowTrack();
    on(t, 'playing');
    ownerTouched(t);
    expect(ownerPinned(t)).toBe(true);
    on(t, 'paused');
    expect(ownerPinned(t)).toBe(true);
    on(t, 'none');
    expect(ownerPinned(t)).toBe(false);
    on(t, 'playing');
    expect(ownerPinned(t)).toBe(false);
  });

  it('two shows in quick succession, with a drop that lands after the first ended: the second is free', () => {
    const t = newShowTrack();
    on(t, 'playing');
    on(t, 'none');
    on(t, 'playing');
    // (the first show's falling Watt lands now: no show was live when it was dropped, so nothing is set)
    expect(ownerPinned(t)).toBe(false);
    ownerTouched(t);
    expect(ownerPinned(t)).toBe(true);
  });

  it('a touch with no show live sets nothing, now or later', () => {
    const t = newShowTrack();
    ownerTouched(t);
    on(t, 'playing');
    expect(ownerPinned(t)).toBe(false);
  });

  it('a wait inside a show (the next item loading) keeps it; a wait that starts one, or an end, does not', () => {
    const t = newShowTrack();
    on(t, 'waiting');
    expect(t.live).toBe(false);
    on(t, 'playing');
    ownerTouched(t);
    on(t, 'waiting');
    expect(ownerPinned(t)).toBe(true);
    on(t, 'playing');
    expect(ownerPinned(t)).toBe(true);
    on(t, 'ended');
    expect(ownerPinned(t)).toBe(false);
  });

  it('a call, reading or recording are not part of the selector: the hand survives them', () => {
    const t = newShowTrack();
    on(t, 'playing');
    ownerTouched(t);
    // (they change the role, never the marquee: the track sees only `playing` throughout)
    on(t, 'playing');
    expect(ownerPinned(t)).toBe(true);
  });
});

describe('watching', () => {
  it('the seated frames are his own style: the sit body with the raised head, facing right', () => {
    expect(SPRITES.watch.slice(7)).toEqual(SPRITES.sit.slice(7));
    expect(SPRITES.watch.slice(0, 7)).toEqual(SPRITES.look.slice(0, 7));
    expect(SPRITES.front).toHaveLength(SPRITES.sit.length);
  });

  it('one small sign of life every 20 to 40 seconds, nothing in between', () => {
    const starts: number[] = [];
    let was: string | null = null;
    for (let t = 0; t < 600; t += 0.05) {
      const s = lifeAt(t);
      if (s && !was) starts.push(t);
      was = s;
    }
    expect(starts.length).toBeGreaterThanOrEqual(14);
    expect(starts[0]).toBeGreaterThanOrEqual(LIFE_FIRST_S - 0.05);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      expect(gap).toBeGreaterThanOrEqual(LIFE_EVERY_S - LIFE_JITTER_S - 0.1);
      expect(gap).toBeLessThanOrEqual(LIFE_EVERY_S + LIFE_JITTER_S + 0.1);
    }
  });

  it('a sign is a blink, his ear or a dip of his head; still and quiet he shows none', () => {
    const seen = new Set<string>();
    for (let t = 0; t < 300; t += 0.05) {
      const l = watchLook(t, Infinity, false, false);
      seen.add(l.blink ? 'blink' : l.pose);
      expect(watchLook(t, Infinity, true, false)).toEqual({ pose: 'watch', blink: false });
      expect(watchLook(t, Infinity, false, true)).toEqual({ pose: 'watch', blink: false });
    }
    expect([...seen].sort()).toEqual(['blink', 'sit', 'watch', 'watchEar']);
  });

  it('paused, he looks round at the viewer once, for a moment', () => {
    expect(watchLook(5, 0.5, false, false).pose).toBe('front');
    expect(watchLook(5, LOOK_ROUND_S + 0.1, false, false).pose).toBe('watch');
    expect(watchLook(5, 0.5, true, false).pose).toBe('watch');
  });

  it('the rest timer lands on every change of his look and never skips one', () => {
    let t = 0;
    let prev = watchLook(0, Infinity, false, false);
    let steps = 0;
    while (t < 300) {
      const r = watchRestFor(t, Infinity, false, false);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(LIFE_EVERY_S + LIFE_JITTER_S + Math.max(...Object.values(LIFE_S)));
      // Nothing changes before the timer is due.
      const mid = watchLook(t + r / 2, Infinity, false, false);
      expect(mid).toEqual(watchLook(t + 1e-6, Infinity, false, false));
      t += r;
      const now = watchLook(t + 1e-6, Infinity, false, false);
      expect(now).not.toEqual(prev);
      prev = now;
      steps += 1;
    }
    expect(steps).toBeLessThan(40);
    expect(watchRestFor(10, Infinity, true, false)).toBe(Infinity);
    expect(watchRestFor(10, Infinity, false, true)).toBe(Infinity);
    expect(watchRestFor(10, 1, false, false)).toBeCloseTo(LOOK_ROUND_S - 1);
  });
});
