import { describe, expect, it } from 'vitest';
import { BAND_MARGIN, LIFE_EVERY_S, LIFE_FIRST_S, LIFE_JITTER_S, LIFE_S, LOOK_ROUND_S, SEAT_GAP_MIN, facing, lifeAt, clearOf, seatFor, seatReach, showRole, watchLook, watchRestFor, type ShowInput } from './audience';
import { groundOf, type Span } from './ground';
import { SPRITES } from './sprites';

const PX = 6;
const WATCH = groundOf('unwind', true);
/** Two invented screens, nowhere near each other. */
const A = { x: 1300, y: 50, w: 700, h: 394 };
const B = { x: 860, y: 90, w: 600, h: 338 };

describe('his seat', () => {
  it('is left of the screen by at least 60 px of clear ground (his whole reach included), on his ground', () => {
    for (const s of [A, B]) {
      const x = seatFor(s, WATCH, PX)!;
      expect(x).not.toBeNull();
      expect(x + seatReach(PX)).toBeLessThanOrEqual(s.x - SEAT_GAP_MIN);
      expect(WATCH.some((g) => x >= g.min && x <= g.max)).toBe(true);
    }
  });

  it('follows the rectangle it is given', () => {
    expect(seatFor(A, WATCH, PX)).not.toBe(seatFor(B, WATCH, PX));
    expect(seatFor(B, WATCH, PX)).toBe(B.x - SEAT_GAP_MIN - seatReach(PX));
  });

  it('keeps the approved proportion when the screen is wide enough for it to exceed 60 px', () => {
    const wide = { x: 1400, y: 0, w: 1400, h: 788 };
    const ground: Span[] = [{ min: 0, max: 2000, left: 0, right: 2560 }];
    const x = seatFor(wide, ground, PX)!;
    expect(wide.x - (x + seatReach(PX))).toBe(Math.round((1400 * 1.9) / 27));
  });

  it('on ground that does not reach the seat, the nearest point that keeps the gap; none when the ground starts too near the screen', () => {
    const ground: Span[] = [{ min: 100, max: 400, left: 90, right: 540 }];
    expect(seatFor(A, ground, PX)).toBe(400);
    expect(seatFor({ x: 250, y: 0, w: 600, h: 300 }, ground, PX)).toBeNull();
    // Two stretches: the one that keeps the gap wins even when the other is nearer.
    const two: Span[] = [
      { min: 100, max: 300, left: 90, right: 440 },
      { min: 1200, max: 1300, left: 1190, right: 1440 },
    ];
    expect(seatFor({ x: 1250, y: 0, w: 600, h: 300 }, two, PX)).toBe(300);
  });

  it('he faces the screen from it', () => {
    expect(facing(A, seatFor(A, WATCH, PX)!, 108)).toBe(1);
    expect(facing({ x: 100, y: 0, w: 200, h: 100 }, 900, 108)).toBe(-1);
  });
});

describe('what the show asks of him, in order', () => {
  const base: ShowInput = { screen: A, onWatch: true, inCall: false, reading: false, recording: false };
  it('watch when nothing else holds him', () => expect(showRole(base)).toBe('watch'));
  it('off with no screen, or off the Watch tab', () => {
    expect(showRole({ ...base, screen: null })).toBe('off');
    expect(showRole({ ...base, onWatch: false })).toBe('off');
  });
  it('a call outranks reading, reading outranks recording, recording outranks watching', () => {
    expect(showRole({ ...base, inCall: true, reading: true, recording: true })).toBe('off');
    expect(showRole({ ...base, reading: true, recording: true })).toBe('off');
    expect(showRole({ ...base, recording: true })).toBe('hold');
  });
  it('the leave banner takes none of his Watch ground, so it cannot move the seat on Unwind', () => {
    expect(groundOf('unwind', true, true)).toEqual(groundOf('unwind', true, false));
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

describe('his seat keeps clear of controls', () => {
  // An invented bar across the floor, as the Look switch stands (x 600 to 1060).
  const bar = [{ x0: 600, x1: 1060 }];
  it('takes the stretch under a control out of his ground, his whole reach kept clear', () => {
    const g = clearOf(WATCH, bar, PX);
    for (const s of g) {
      expect(s.max <= 600 - seatReach(PX) - BAND_MARGIN || s.min >= 1060 + BAND_MARGIN).toBe(true);
    }
    expect(g.length).toBeGreaterThan(0);
  });
  it('the seat then lies left of the control, and follows the screen when the control moves', () => {
    const x = seatFor(A, clearOf(WATCH, bar, PX), PX)!;
    expect(x + seatReach(PX)).toBeLessThanOrEqual(600 - BAND_MARGIN);
    const y = seatFor(A, clearOf(WATCH, [{ x0: 400, x1: 700 }], PX), PX)!;
    // A control further left leaves the nearer stretch on its right: he sits there instead.
    expect(y).toBeGreaterThanOrEqual(700 + BAND_MARGIN);
    expect(y).toBeGreaterThan(x);
  });
  it('no control at his height changes nothing', () => {
    expect(seatFor(A, clearOf(WATCH, [], PX), PX)).toBe(seatFor(A, WATCH, PX));
  });
  it('a control covering all of his ground leaves no seat', () => {
    expect(seatFor(A, clearOf(WATCH, [{ x0: 0, x1: 2560 }], PX), PX)).toBeNull();
  });
});
