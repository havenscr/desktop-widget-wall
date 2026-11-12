import { describe, expect, it } from 'vitest';
import { WALK_MAX, WALK_MIN, buddyFrame, isNight, walkAt } from './model';
import { SPRITES, pixelColor } from './sprites';

const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m);

describe('night window', () => {
  it('sleeps from 9:30 PM to 6:30 AM local time', () => {
    expect(isNight(at(21, 29))).toBe(false);
    expect(isNight(at(21, 30))).toBe(true);
    expect(isNight(at(23, 59))).toBe(true);
    expect(isNight(at(0, 0))).toBe(true);
    expect(isNight(at(6, 29))).toBe(true);
    expect(isNight(at(6, 30))).toBe(false);
    expect(isNight(at(12))).toBe(false);
  });
});

describe('walking', () => {
  it('stays between 960 and 1220 and turns around', () => {
    let sawRight = false;
    let sawLeft = false;
    for (let t = 0; t < 200; t += 0.5) {
      const w = walkAt(t);
      expect(w.x).toBeGreaterThanOrEqual(WALK_MIN);
      expect(w.x).toBeLessThanOrEqual(WALK_MAX);
      if (w.dir === 1) sawRight = true;
      else sawLeft = true;
    }
    expect(sawRight && sawLeft).toBe(true);
    expect(walkAt(0).x).toBe(960);
  });
  it('is slow: under 20 design pixels a second', () => {
    expect(Math.abs(walkAt(1).x - walkAt(0).x)).toBeLessThan(20);
  });
});

describe('buddyFrame', () => {
  it('walks and idles by day, with notes only while music plays', () => {
    const poses = new Set<string>();
    for (let t = 0; t < 2; t += 0.1) poses.add(buddyFrame(at(14), t, false).pose);
    expect([...poses].sort()).toEqual(['idle', 'walk']);
    expect(buddyFrame(at(14), 1, false).notes).toBe(false);
    expect(buddyFrame(at(14), 1, true).notes).toBe(true);
    expect(buddyFrame(at(14), 1, true).z).toBe(false);
  });
  it('sleeps at night with z and no notes, even with music', () => {
    for (const playing of [false, true]) {
      const f = buddyFrame(at(23), 3, playing);
      expect(f).toMatchObject({ pose: 'sleep', z: true, notes: false });
      expect(f.x).toBeGreaterThanOrEqual(WALK_MIN);
      expect(f.x).toBeLessThanOrEqual(WALK_MAX);
    }
  });
  it('is a fixed pose with nothing drifting under reduced motion', () => {
    const a = buddyFrame(at(14), 1, true, true);
    const b = buddyFrame(at(14), 9, true, true);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ pose: 'idle', notes: false, z: false });
    expect(buddyFrame(at(2), 1, true, true).pose).toBe('sleep');
  });
});

/** The concept's `SH.idle`, copied from the reference file. */
const REFERENCE_IDLE = [
  '....wwwwwww.......',
  '..wwwwwwwwwww.....',
  '.wwwwwwwwwwwwwpf..',
  '.wwwwwwwwwwwwwffff',
  'wwwwwwwwwwwwwwfeff',
  'wwwwwwwwwwwwwwffff',
  'wwwwwwwwwwwwwwwff.',
  '.wwwwwwwwwwwwww...',
  '.wwwwwwwwwwwww....',
  '..wwwwwwwwwww.....',
  '...l..l...l..l....',
  '...l..l...l..l....',
];

describe('sprites', () => {
  it('idle equals the concept map exactly', () => {
    expect([...SPRITES.idle]).toEqual(REFERENCE_IDLE);
  });
  it('has every row the same width and only known pixels', () => {
    for (const map of Object.values(SPRITES)) {
      for (const row of map) {
        expect(row).toHaveLength(map[0].length);
        expect(row).toMatch(/^[.wfe\-pl]+$/);
      }
    }
  });
  it('walk is the idle body rows plus two leg rows', () => {
    expect(SPRITES.walk.slice(0, 10)).toEqual(REFERENCE_IDLE.slice(0, 10));
    expect(SPRITES.walk[10]).toBe('..l...l....l..l...');
    expect(SPRITES.walk).toHaveLength(12);
  });
  it('shades the wool by row and leaves empty pixels empty', () => {
    expect(pixelColor(SPRITES.idle, 6, 1)).toBe('#f6f2ff');
    expect(pixelColor(SPRITES.idle, 6, 9)).toBe('#bfb2f0');
    expect(pixelColor(SPRITES.idle, 0, 0)).toBeNull();
  });
});
