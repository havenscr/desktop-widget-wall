import { describe, expect, it } from 'vitest';
import { css, hash, pal, peaks, peaksOf, sun, when } from './renderer';

describe('sun', () => {
  // Expected values come from the original horizon.js with LAT 47.68 and LON -122.21, run in Node (see the pull request body).
  it('matches the reference at noon on 2026-11-11 (Pacific)', () => {
    const s = sun(when(2026, 11, 11, 12));
    expect(s.az).toBeCloseTo(181.86662909037594, 9);
    expect(s.alt).toBeCloseTo(24.714265598607472, 9);
  });

  it('matches the reference late on a June night, sun below the horizon', () => {
    const s = sun(when(2026, 6, 21, 21.5));
    expect(s.az).toBeCloseTo(322.9963129158583, 9);
    expect(s.alt).toBeCloseTo(-10.239272238097705, 9);
  });
});

describe('when', () => {
  it('is Pacific standard time (UTC-8) by default', () => {
    expect(when(2026, 11, 11, 12)).toBe(1794427200000);
    expect(when(2026, 11, 11, 12)).toBe(Date.UTC(2026, 10, 11, 20));
  });

  it('takes an explicit zone offset in hours', () => {
    expect(when(2026, 1, 1, 0, 0)).toBe(1767225600000);
  });

  it('carries fractional hours', () => {
    expect(when(2026, 11, 11, 12.5) - when(2026, 11, 11, 12)).toBe(30 * 60 * 1000);
  });
});

describe('helpers', () => {
  it('pal blends colours by sun altitude and flips with the evening flag', () => {
    expect(pal(40, false).star).toBe(0);
    expect(pal(-30, false).star).toBeGreaterThan(0.9);
    expect(pal(0, true).s[3]).not.toEqual(pal(0, false).s[3]);
  });

  it('css formats rgb and clamped rgba', () => {
    expect(css([1.9, 2, 3])).toBe('rgb(1,2,3)');
    expect(css([1, 2, 3], 2)).toBe('rgba(1,2,3,1)');
  });

  it('hash is deterministic and in [0, 1)', () => {
    expect(hash(3, 4)).toBe(hash(3, 4, 0));
    const v = hash(7, 9, 11);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('exposes the peak lists for both terrains', () => {
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaksOf('south').length).toBeGreaterThan(0);
  });
});
