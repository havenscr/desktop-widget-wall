import { describe, expect, it } from 'vitest';
import { WALKS, spriteHeight } from './model';
import {
  CLICK_S,
  GRAZE_FROM_S,
  GRAZE_STOPS,
  HEARTS_S,
  PROP_RISE_MAX,
  REACT_S,
  SETTLE_FROM_S,
  blinking,
  nextBlink,
  restFor,
  bubbleSize,
  clickKind,
  createMind,
  createPetFrame,
  holdsStill,
  petFrame,
  propFits,
  shape,
  wrapLine,
  type Mind,
} from './petFrame';
import { IDLES, STOPS, loopSeconds } from './model';
import { POSES, PROPS, SPRITES } from './sprites';

const walk = WALKS.work;
const HY = 582;
const mind = (over: Partial<Mind> = {}): Mind => Object.assign(createMind(), over);
const frame = (m: Mind, opts: { night?: boolean; t?: number; playing?: boolean; still?: boolean; place?: 'work' | 'home' | 'unwind' } = {}) =>
  petFrame(WALKS[opts.place ?? 'work'], opts.place ?? 'work', opts.place === 'unwind' ? 505 : HY, opts.night ?? false, opts.t ?? 5, opts.playing ?? false, opts.still ?? false, m, createPetFrame());

describe('what she does', () => {
  it('hops when focus or an agent finishes: lifted part way, never past the ceiling, and holds still', () => {
    const m = mind({ react: 'hop', reactT: REACT_S.hop / 2 });
    const f = frame(m);
    expect(f.lift).toBeGreaterThan(0);
    expect(HY - spriteHeight(f.pose, walk.px) - f.lift).toBeGreaterThanOrEqual(walk.ceiling);
    expect(holdsStill(m)).toBe(true);
    expect(frame(mind({ react: 'hop', reactT: REACT_S.hop + 0.1 })).lift).toBe(0);
  });
  it('looks up toward the clock or the agents, the way she is told', () => {
    const f = frame(mind({ react: 'look', reactT: 1, reactDir: -1 }));
    expect(f.pose).toBe('look');
    expect(f.dir).toBe(-1);
  });
  it('shows the amber mark while something waits', () => {
    expect(frame(mind({ waiting: true })).mark).toBe(true);
    expect(frame(mind()).mark).toBe(false);
  });
  it('a pet: hearts and a wiggle (turning one way then the other)', () => {
    const dirs = new Set<number>();
    for (let k = 0; k < 1; k += 0.1) {
      const f = frame(mind({ react: 'pet', reactT: REACT_S.pet * k }));
      expect(f.hearts).toBe(true);
      dirs.add(f.dir);
    }
    expect(dirs.size).toBe(2);
    expect(frame(mind({ react: 'pet', reactT: HEARTS_S + 0.1 })).hearts).toBe(false);
  });
  it('wakes with a yawn then a stretch, and eats with her head down', () => {
    expect(frame(mind({ react: 'wake', reactT: 1 })).pose).toBe('yawn');
    expect(frame(mind({ react: 'wake', reactT: 4 })).pose).toBe('stretch');
    expect(frame(mind({ react: 'eat', reactT: 1 })).pose).toBe('eat');
  });
  it('bobs to the beat as a soft squash, nothing at night or napping', () => {
    expect(frame(mind({ bob: 1 })).squash).toBeCloseTo(0.95);
    expect(frame(mind({ bob: 1 }), { night: true }).squash).toBe(1);
    expect(frame(mind({ bob: 1, nap: true })).squash).toBe(1);
  });
});

describe('what she wears', () => {
  it('reads a tiny book during focus, standing (t inside the first idle)', () => {
    const f = frame(mind({ focus: true }), { t: 5 });
    expect(f.pose).toBe('read');
    expect(f.prop).toBe('book');
  });
  it('an umbrella in rain, a scarf when cold, sunglasses at a clear midday, headphones on Unwind with music', () => {
    expect(frame(mind({ rain: true })).prop).toBe('umbrella');
    expect(frame(mind({ cold: true })).scarf).toBe(true);
    expect(frame(mind({ sunny: true })).prop).toBe('sunglasses');
    expect(frame(mind(), { place: 'unwind', playing: true }).prop).toBe('headphones');
    expect(frame(mind(), { place: 'work', playing: true }).prop).toBeNull();
  });
  it('a nightcap while she sleeps; she naps where she stands when the display is idle', () => {
    const night = frame(mind(), { night: true });
    expect(night).toMatchObject({ pose: 'sleep', prop: 'nightcap', z: true });
    const nap = frame(mind({ nap: true }));
    expect(nap.pose).toBe('sleep');
    expect(nap.z).toBe(true);
  });
  it('looks up at the moon in the evening at some stops, and yawns when sleepy', () => {
    // t 60 is inside stop 1 (idle 26 s, a walk of 6 s, then stand 34 s).
    expect(frame(mind({ evening: true }), { t: 40 }).pose).toBe('look');
    expect(frame(mind({ sleepy: true }), { t: 1 }).pose).toBe('yawn');
  });
  it('wears the chosen cosmetic', () => {
    expect(frame(mind({ cosmetic: 'cape' })).cosmetic).toBe('cape');
    expect(frame(mind({ cosmetic: 'none' })).cosmetic).toBeNull();
  });
  it('never draws a prop that would stick out too far: every pose and prop is checked', () => {
    for (const pose of POSES) for (const prop of PROPS) if (propFits(prop, pose)) expect(PROP_RISE_MAX).toBe(2);
    expect(propFits('umbrella', 'look')).toBe(false);
    expect(propFits('scarf', 'sleep')).toBe(false);
    expect(propFits('nightcap', 'sleep')).toBe(true);
  });
});

describe('reduced motion', () => {
  it('still poses: middle of the walk, no hop, no wiggle, no squash, nothing drifting; props stay', () => {
    const f = frame(mind({ react: 'hop', reactT: 0.3, rain: true, bob: 1 }), { still: true });
    expect(f.x).toBe((walk.min + walk.max) / 2);
    expect(f.lift).toBe(0);
    expect(f.squash).toBe(1);
    expect(f.prop).toBe('umbrella');
    const p = frame(mind({ react: 'pet', reactT: 0.2 }), { still: true });
    expect(p.dir).toBe(1);
    expect(p.hearts).toBe(true);
    expect(frame(mind(), { still: true, night: true }).z).toBe(false);
    expect(frame(mind({ react: 'eat', reactT: 1 }), { still: true }).pose).toBe('eat');
  });
});

describe('the bubble box', () => {
  it('wraps a long line into balanced lines inside the widest box, and a short one on one line', () => {
    expect(wrapLine('Hmm.', 340)).toEqual(['Hmm.']);
    const lines = wrapLine('Someone up there needs a yes or no.', 260);
    expect(lines.length).toBe(2);
    expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThan(12);
    expect(bubbleSize(lines).width).toBeLessThanOrEqual(260);
    expect(bubbleSize(lines).height).toBe(2 * 17 + 12);
  });
});

describe('more of a pet', () => {
  const at = (x: number, y: number) => ({ pointerOn: true, pointerX: x, pointerY: y });
  it('notices a pointer within 260 px: turns to it with his ears up, and not when it is further, or when he is busy', () => {
    const near = frame(mind(at(1200, 560)));
    expect(near.pose).toBe('alert');
    expect(near.dir).toBe(1);
    expect(frame(mind(at(800, 560))).dir).toBe(-1);
    expect(frame(mind(at(800, 560))).pose).toBe('alert');
    // Just out of range.
    const x = frame(mind()).x + (18 * walk.px) / 2;
    expect(frame(mind(at(x + 261, HY - 24))).pose).not.toBe('alert');
    expect(frame(mind(at(x + 259, HY - 24))).pose).toBe('alert');
    // Busy: reading, a clover on the ground, asleep (night or napping), a reaction running, or a still pose.
    for (const busy of [{ focus: true }, { clover: true }, { nap: true }, { lie: true }, { react: 'eat' as const, reactT: 1 }]) {
      expect(frame(mind({ ...at(1000, 560), ...busy })).pose, JSON.stringify(busy)).not.toBe('alert');
    }
    expect(frame(mind(at(1000, 560)), { night: true }).pose).toBe('sleep');
    expect(frame(mind(at(1000, 560)), { still: true }).pose).not.toBe('alert');
    // A pointer that has lost interest (not on) changes nothing.
    expect(frame(mind({ pointerOn: false, pointerX: 1000, pointerY: 560 })).pose).not.toBe('alert');
  });
  it('a happy hop lifts and turns; a spin turns all the way round a little off the ground; both hold him still', () => {
    const poses = new Set<string>();
    let lift = 0;
    for (let k = 0; k < 1; k += 0.05) {
      const f = frame(mind({ react: 'happy', reactT: REACT_S.happy * k }));
      poses.add(f.pose);
      lift = Math.max(lift, f.lift);
    }
    expect(lift).toBeGreaterThan(0);
    expect(poses.has('spin1') && poses.has('spin2')).toBe(true);
    const spin = new Set<string>();
    const facing = new Set<number>();
    let spinLift = 0;
    for (let k = 0; k < 1; k += 0.02) {
      const f = frame(mind({ react: 'spin', reactT: REACT_S.spin * k }));
      spin.add(f.pose);
      if (f.pose === 'idle') facing.add(f.dir);
      spinLift = Math.max(spinLift, f.lift);
    }
    // Side, front, the other side, back, side: both sides are seen.
    expect(spin.has('spin1') && spin.has('spin2')).toBe(true);
    expect(facing.size).toBe(2);
    expect(spinLift).toBeGreaterThan(0);
    expect(spinLift).toBeLessThanOrEqual(2 * walk.px);
    expect(holdsStill(mind({ react: 'spin', reactT: 0.2 }))).toBe(true);
    // Reduced motion: one still pose, nothing lifts.
    expect(frame(mind({ react: 'spin', reactT: 0.3 }), { still: true }).pose).toBe('spin1');
    expect(frame(mind({ react: 'happy', reactT: 0.3 }), { still: true }).lift).toBe(0);
  });
  it('the sparkle shows for its 2.4 seconds only, and not at night', () => {
    expect(frame(mind({ react: 'sparkle', reactT: 1 })).sparkle).toBe(true);
    expect(frame(mind({ react: 'sparkle', reactT: 2.5 })).sparkle).toBe(false);
    expect(frame(mind({ react: 'sparkle', reactT: 1 }), { night: true }).sparkle).toBe(false);
    expect(frame(mind()).sparkle).toBe(false);
  });
  it('a nap: he turns round, sits, then lies down breathing with z drifting, and holds still; he gets up with a yawn and a stretch', () => {
    const seq = [0.1, 0.3, 0.8, 2.4].map((t) => frame(mind({ lie: true, lieT: t })).pose);
    expect(seq).toEqual(['idle', 'walk', 'sit', 'lie']);
    const f = frame(mind({ lie: true, lieT: 3 }));
    expect(f.z).toBe(true);
    expect(f.squash).toBeLessThan(1);
    expect(holdsStill(mind({ lie: true }))).toBe(true);
    // Reduced motion: he simply lies there.
    expect(frame(mind({ lie: true, lieT: 0 }), { still: true }).pose).toBe('lie');
    expect(['yawn', 'stretch']).toContain(frame(mind({ react: 'rise', reactT: 0.6 })).pose);
    expect(frame(mind({ react: 'rise', reactT: 1.3 })).pose).toBe('stretch');
  });
  it('a hop has anticipation, stretch, squash and dust, at pixel-art frame counts', () => {
    const at = (t: number) => {
      const o = { pose: 'idle' as const as import('./sprites').Pose, dir: 1 as 1 | -1, lift: 0, squash: 1, sx: 1, dust: 0 };
      shape('hop', t, o);
      return o;
    };
    expect(at(0.05).squash).toBeLessThan(0.9);
    expect(at(0.05).sx).toBeGreaterThan(1);
    expect(at(0.15).squash).toBeGreaterThan(1.1);
    expect(at(0.38).pose).toBe('hop');
    expect(at(0.38).lift).toBeGreaterThan(4);
    expect(at(0.62).squash).toBeLessThan(0.9);
    expect(at(0.62).dust).toBeGreaterThan(0);
    expect(at(0.8)).toMatchObject({ squash: 1, sx: 1, lift: 0 });
    // The happy hop bounces twice, the second with a turn, and hearts land with it.
    const poses = new Set<string>();
    for (let t = 0; t < 1.3; t += 0.02) {
      const o = { pose: 'idle' as import('./sprites').Pose, dir: 1 as 1 | -1, lift: 0, squash: 1, sx: 1, dust: 0 };
      shape('happy', t, o);
      poses.add(o.pose);
    }
    expect(poses.has('hop') && poses.has('spin1') && poses.has('spin2')).toBe(true);
    expect(frame(mind({ react: 'happy', reactT: 1.5 })).hearts).toBe(true);
  });
  it('the idle life: a blink every few seconds, grazing at some stops, settling in on long ones', () => {
    let blinks = 0;
    for (let T = 0; T < 60; T += 0.05) if (blinking(T)) blinks++;
    // One 120 ms blink every 3 to 7 s: about 12 frames of 50 ms in a minute, never none.
    expect(blinks).toBeGreaterThan(8);
    expect(blinks).toBeLessThan(40);
    expect(frame(mind({ clock: 0 })).blink).toBe(blinking(0));
    // Find the start of a graze stop and of a settle stop on the wander clock.
    const startOf = (stop: number) => {
      let t = 0;
      for (let i = 0; i < stop; i++) t += IDLES[i] + (Math.abs(STOPS[(i + 1) % STOPS.length] - STOPS[i]) * (walk.max - walk.min)) / 14;
      return t;
    };
    const grazing = new Set<string>();
    for (let k = 0; k < 3; k += 0.1) grazing.add(frame(mind(), { t: startOf(GRAZE_STOPS[0]) + GRAZE_FROM_S + k }).pose);
    expect(grazing.has('eat')).toBe(true);
    expect(frame(mind(), { t: startOf(3) + SETTLE_FROM_S + 2 }).pose).toBe('sit');
    // He stands up again before he walks on.
    expect(frame(mind(), { t: startOf(3) + IDLES[3] - 1 }).pose).not.toBe('sit');
    expect(loopSeconds(walk)).toBeGreaterThan(startOf(7));
    // None of it under reduced motion, or with the idle life switched off.
    expect(frame(mind(), { t: startOf(3) + SETTLE_FROM_S + 2, still: true }).pose).toBe('idle');
    expect(frame(mind({ idleLife: false }), { t: startOf(3) + SETTLE_FROM_S + 2 }).pose).toBe('idle');
  });
  it('a noticed click turns him toward it: near flicks his wool and holds the look, far only glances', () => {
    expect(clickKind(1100, 540, 1000, 540)).toBe('near');
    expect(clickKind(1700, 300, 1000, 540)).toBe('mid');
    expect(clickKind(2400, 100, 1000, 540)).toBe('far');
    const near = frame(mind({ react: 'click', reactT: 0.15, reactDir: -1, clickKind: 'near' }));
    expect(near.dir).toBe(-1);
    expect(near.pose).toBe('alert');
    expect(near.tuft).toBe(true);
    expect(frame(mind({ react: 'click', reactT: 0.5, reactDir: 1, clickKind: 'near', clickUp: true })).pose).toBe('look');
    expect(frame(mind({ react: 'click', reactT: 0.05, reactDir: 1, clickKind: 'far' })).pose).toBe('alert');
    const glance = frame(mind({ react: 'click', reactT: 0.4, reactDir: -1, clickKind: 'far' }));
    expect(glance.pose).toBe('idle');
    expect(glance.dir).toBe(-1);
    // Each kind holds him for its own time, and a far one is over sooner.
    expect(holdsStill(mind({ react: 'click', reactT: CLICK_S.far - 0.1, clickKind: 'far' }))).toBe(true);
    expect(holdsStill(mind({ react: 'click', reactT: CLICK_S.far + 0.1, clickKind: 'far' }))).toBe(false);
    expect(holdsStill(mind({ react: 'click', reactT: CLICK_S.far + 0.1, clickKind: 'near' }))).toBe(true);
    // Reduced motion: only the turn.
    const still = frame(mind({ react: 'click', reactT: 0.15, reactDir: -1, clickKind: 'near' }), { still: true });
    expect(still.dir).toBe(-1);
    expect(still.tuft).toBe(false);
  });
  it('with his menu open he looks up at it', () => {
    const f = frame(mind({ held: true, menuDir: -1 }));
    expect(f.pose).toBe('look');
    expect(f.dir).toBe(-1);
  });
  it('every pose is different from every other: each reads at a glance', () => {
    for (const a of POSES) for (const b of POSES) if (a < b) expect(SPRITES[a].join('|'), `${a} and ${b}`).not.toBe(SPRITES[b].join('|'));
  });
});

describe('a firefly', () => {
  it('turns him to watch it, head up when it is above him, and the pointer wins when both are there', () => {
    const f = frame(mind({ firefly: true, fireflyX: 1200, fireflyY: 500 }));
    expect(f.dir).toBe(1);
    expect(f.pose).toBe('look');
    expect(frame(mind({ firefly: true, fireflyX: 800, fireflyY: 570 })).dir).toBe(-1);
    expect(frame(mind({ firefly: true, fireflyX: 800, fireflyY: 570 })).pose).toBe('idle');
    expect(frame(mind({ firefly: true, fireflyX: 1200, fireflyY: 500, pointerOn: true, pointerX: 800, pointerY: 560 })).dir).toBe(-1);
    expect(frame(mind({ firefly: true, fireflyX: 1200, fireflyY: 500 }), { still: true }).pose).toBe('idle');
    expect(frame(mind({ firefly: true, fireflyX: 1200, fireflyY: 500, focus: true })).pose).toBe('read');
    expect(frame(mind({ firefly: false, fireflyX: 1200, fireflyY: 500 })).pose).toBe('idle');
  });
});

describe('resting between changes', () => {
  const at = (stop: number) => {
    let t = 0;
    for (let i = 0; i < stop; i++) t += IDLES[i] + (Math.abs(STOPS[(i + 1) % STOPS.length] - STOPS[i]) * (walk.max - walk.min)) / 14;
    return t;
  };
  it('plans the next change exactly: the end of a stand, a blink, a graze nibble, sitting down and standing up', () => {
    const quiet = mind({ idleLife: false });
    // Stop 0 lasts 26 s: 4 s in, the yawn boundary at 3 s is past, so the stand ends in 22 s.
    expect(restFor(walk, 4, 0, false, false, quiet)).toBeCloseTo(IDLES[0] - 4, 6);
    // The settle stop: he sits after 6 s and stands up 3 s before he walks on.
    const s3 = at(3);
    expect(restFor(walk, s3 + 4, 0, false, false, quiet)).toBeCloseTo(SETTLE_FROM_S - 4, 6);
    expect(restFor(walk, s3 + 10, 0, false, false, quiet)).toBeCloseTo(IDLES[3] - 3 - 10, 6);
    // While grazing, every nibble is a change.
    const g = at(GRAZE_STOPS[0]) + GRAZE_FROM_S + 0.1;
    expect(restFor(walk, g, 0, false, false, quiet)).toBeCloseTo(1 / 3 - 0.1, 6);
    // A blink is planned on the loop clock, and its end too.
    const T = 0.3;
    expect(restFor(walk, 4, T, false, false, mind())).toBeCloseTo(Math.min(IDLES[0] - 4, nextBlink(T)), 6);
    let b = 0;
    while (!blinking(b)) b += 0.01;
    expect(nextBlink(b)).toBeLessThanOrEqual(0.12);
  });
  it('asks for frames only while something moves: a walk, a reaction, music notes, sleep, the firefly, the beat', () => {
    const w = at(1) - 1; // walking from stop 0 to stop 1
    expect(restFor(walk, w, 0, false, false, mind())).toBe(0);
    expect(restFor(walk, 4, 0, false, true, mind())).toBe(0);
    expect(restFor(walk, 4, 0, true, false, mind())).toBe(0);
    for (const over of [{ lie: true }, { nap: true }, { firefly: true }, { bob: 0.5 }, { react: 'hop' as const, reactT: 0.2 }]) expect(restFor(walk, 4, 0, false, false, mind(over)), JSON.stringify(over)).toBe(0);
    // Held still (his menu open): the wander waits, and with the idle life off nothing at all is planned.
    expect(restFor(walk, 4, 0, false, false, mind({ held: true, idleLife: false }))).toBe(Infinity);
  });
});
