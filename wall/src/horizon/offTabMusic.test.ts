import { describe, expect, it } from 'vitest';
import { CAMERAS } from './cameras';
import { DEFAULT_VIBE, validateVibe } from './vibeSettings';
import { visualizerWeight } from './echo';
import { LEVEL_EASE_S, LEVEL_FRACTIONS, createLevelEase, fractionsAt, stepLevelEase, withMusicLevel, type MusicFractions } from './offTabMusic';

const scratch = () => ({ ...CAMERAS.work });
const fr = (pos: number): MusicFractions => fractionsAt(pos, { amp: 0, a: 0, n: 0, gp: 0, vw: 0 });

describe('music on other tabs: level to values', () => {
  it('Calm is the camera itself', () => {
    expect(withMusicLevel(CAMERAS.work, fr(0), 1, scratch())).toBe(CAMERAS.work);
  });
  it('Full is Unwind on every music value', () => {
    const c = withMusicLevel(CAMERAS.work, fr(2), 1, scratch());
    const u = CAMERAS.unwind;
    expect([c.eamp, c.ea, c.en, c.gp]).toEqual([u.eamp, u.ea, u.en, u.gp].map((x) => expect.closeTo(x, 9)));
    expect(c.hy).toBe(CAMERAS.work.hy);
  });
  it('Medium is 6 lines, about three times the height, about 60 percent of Unwind', () => {
    const c = withMusicLevel(CAMERAS.work, fr(1), 1, scratch());
    expect(c.en).toBe(6);
    expect(c.eamp / CAMERAS.work.eamp).toBeGreaterThan(2.8);
    expect(c.eamp / CAMERAS.work.eamp).toBeLessThan(3.2);
    expect(c.ea).toBeCloseTo(0.66, 2);
  });
  it('cover colours and instrument follow: 0.6 on Medium, 1 on Full, apart from the line count', () => {
    expect(visualizerWeight(CAMERAS.work)).toBe(0);
    expect(visualizerWeight(withMusicLevel(CAMERAS.work, fr(1), 1, scratch()))).toBeCloseTo(0.6, 9);
    expect(visualizerWeight(withMusicLevel(CAMERAS.work, fr(2), 1, scratch()))).toBe(1);
    expect(visualizerWeight(withMusicLevel(CAMERAS.unwind, fr(1), 1, scratch()))).toBe(1);
  });
  it('at rest, and with no ripple, nothing moves; Unwind is unchanged at any level', () => {
    expect(withMusicLevel(CAMERAS.work, fr(2), 0, scratch())).toBe(CAMERAS.work);
    expect(withMusicLevel({ ...CAMERAS.work, ea: 0 }, fr(2), 1, scratch()).en).toBe(3);
    const u = withMusicLevel(CAMERAS.unwind, fr(1), 1, scratch());
    expect([u.eamp, u.ea, u.en, u.gp]).toEqual([34, 0.9, 11, 1].map((x) => expect.closeTo(x, 9)));
  });
  it('Medium is the default and bad values fall back to it', () => {
    expect(DEFAULT_VIBE.offTabMusic).toBe('medium');
    expect(validateVibe({ offTabMusic: 'loud' }).offTabMusic).toBe('medium');
    expect(validateVibe({ offTabMusic: 'full' }).offTabMusic).toBe('full');
    expect(validateVibe(null).offTabMusic).toBe('medium');
  });
  it('the fractions at the levels match the table', () => {
    expect(fr(1)).toEqual(LEVEL_FRACTIONS.medium);
  });
});

describe('a change of level eases', () => {
  it('moves over about a second and never jumps', () => {
    const s = createLevelEase('calm');
    let prev = 0;
    let t = 0;
    stepLevelEase(s, 'full', 1 / 30);
    while (s.pos < 2 && t < 3) {
      expect(s.pos - prev).toBeLessThan(0.35);
      prev = s.pos;
      stepLevelEase(s, 'full', 1 / 30);
      t += 1 / 30;
    }
    expect(s.pos).toBe(2);
    expect(t).toBeGreaterThan(LEVEL_EASE_S - 0.2);
    expect(t).toBeLessThan(LEVEL_EASE_S + 0.2);
  });
  it('a change part way restarts from where it is', () => {
    const s = createLevelEase('calm');
    for (let i = 0; i < 10; i++) stepLevelEase(s, 'medium', 1 / 30);
    const mid = s.pos;
    stepLevelEase(s, 'calm', 0);
    expect(s.pos).toBeCloseTo(mid, 6);
  });
});
