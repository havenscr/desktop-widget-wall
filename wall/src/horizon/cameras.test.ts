import { describe, expect, it } from 'vitest';
import { CAMERAS, blendCamera, ease, glideCamera, settled, startGlide, stepGlide, GLIDE_SECONDS } from './cameras';

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
