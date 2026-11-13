import { describe, expect, it } from 'vitest';
import { WALKS, spriteHeight } from './model';
import { HEARTS_S, PROP_RISE_MAX, REACT_S, bubbleSize, createMind, createPetFrame, holdsStill, petFrame, propFits, wrapLine, type Mind } from './petFrame';
import { POSES, PROPS } from './sprites';

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
