import { describe, expect, it } from 'vitest';
import { CAMERAS, HOME_MORNING, blendCamera, cameraFor, ease, glideCamera, homeCameraFor, settled, startGlide, stepGlide, terrainOf, GLIDE_SECONDS } from './cameras';

const a = CAMERAS.work;
const b = CAMERAS.unwind;

describe('blendCamera', () => {
  it('is the start at 0 and the end at 1', () => {
    expect(blendCamera(a, b, 0)).toEqual(a);
    expect(blendCamera(a, b, 1)).toEqual(b);
  });

  it('is halfway at 0.5 for every key (the ease is symmetric)', () => {
    const mid = blendCamera(a, b, 0.5);
    for (const key of Object.keys(a) as (keyof typeof a)[]) {
      if (key === 'ter') continue;
      expect(mid[key]).toBeCloseTo((a[key] + b[key]) / 2, 9);
    }
  });

  it('uses the cubic ease, so a quarter of the way is under a quarter', () => {
    expect(ease(0.25)).toBeCloseTo(0.0625, 9);
    expect(blendCamera(a, b, 0.25).az0).toBeCloseTo(a.az0 + (b.az0 - a.az0) * 0.0625, 9);
  });

  it('clamps t outside 0 to 1', () => {
    expect(blendCamera(a, b, -1)).toEqual(a);
    expect(blendCamera(a, b, 4)).toEqual(b);
  });
});

describe('presets', () => {
  it('has a framing for each place with the demo values', () => {
    expect(CAMERAS.work).toMatchObject({ az0: 221.5, ppd: 34, hy: 582 });
    expect(CAMERAS.home).toMatchObject({ az0: 218.1, ppd: 54, hy: 582 });
    expect(CAMERAS.unwind).toMatchObject({ az0: 246, ppd: 49.2, hy: 505 });
  });
});

describe('glide', () => {
  it('takes 1.6 seconds to arrive', () => {
    let g = startGlide(settled(a), b, false);
    expect(glideCamera(g)).toEqual(a);
    g = stepGlide(g, GLIDE_SECONDS / 2);
    expect(g.progress).toBeCloseTo(0.5, 9);
    g = stepGlide(g, GLIDE_SECONDS / 2);
    expect(glideCamera(g)).toEqual(b);
    expect(stepGlide(g, 1)).toBe(g);
  });

  it('starts from the current mid-glide position when interrupted', () => {
    const g = stepGlide(startGlide(settled(a), b, false), 0.8);
    const mid = glideCamera(g);
    expect(startGlide(g, CAMERAS.home, false).from).toEqual(mid);
  });

  it('jumps when instant (reduced motion)', () => {
    expect(glideCamera(startGlide(settled(a), b, true))).toEqual(b);
  });
});

describe('homeCameraFor (the morning rule)', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 11, h, m, 0);

  it('is the south view from 5:00 AM up to 11:30 AM local time', () => {
    expect(homeCameraFor(at(4, 59))).toBe(CAMERAS.home);
    expect(homeCameraFor(at(5, 0))).toBe(HOME_MORNING);
    expect(homeCameraFor(at(7, 12))).toBe(HOME_MORNING);
    expect(homeCameraFor(at(11, 29))).toBe(HOME_MORNING);
    expect(homeCameraFor(at(11, 30))).toBe(CAMERAS.home);
  });

  it('is the west Home view in the afternoon, evening and small hours', () => {
    for (const [h, m] of [[12, 0], [16, 30], [21, 15], [0, 0], [3, 40]]) expect(homeCameraFor(at(h, m))).toBe(CAMERAS.home);
  });

  it('cameraFor applies the rule to Home only', () => {
    const morning = at(8, 0).getTime();
    expect(cameraFor('home', morning)).toBe(HOME_MORNING);
    expect(cameraFor('work', morning)).toBe(CAMERAS.work);
    expect(cameraFor('unwind', morning)).toBe(CAMERAS.unwind);
  });
});

describe('the south preset', () => {
  it('looks south with the approved strip values and no ripple', () => {
    expect(HOME_MORNING).toMatchObject({ ter: 'south', az0: 132, ppd: 42, vex: 1.9, cs: 1, hy: 582 });
    for (const k of ['ecx', 'eamp', 'en', 'vx'] as const) expect(HOME_MORNING[k]).toBe(CAMERAS.home[k]);
    expect(HOME_MORNING.ea).toBe(0);
  });

  it('peaks clear of the top of the stage (Rainier about 168 px above the horizon)', () => {
    expect(HOME_MORNING.hy - 168).toBeGreaterThan(300);
  });

  it('west cameras name no terrain, which means west', () => {
    expect(CAMERAS.home.ter).toBeUndefined();
    expect(terrainOf(CAMERAS.home)).toBe('west');
    expect(terrainOf(HOME_MORNING)).toBe('south');
  });

  it('a glide between south cameras keeps the terrain at every step', () => {
    const other = { ...HOME_MORNING, az0: 140 };
    expect(blendCamera(HOME_MORNING, other, 0.5).ter).toBe('south');
    expect(glideCamera({ from: HOME_MORNING, to: other, progress: 0.3 }).ter).toBe('south');
  });
});
