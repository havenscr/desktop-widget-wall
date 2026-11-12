import { describe, expect, it } from 'vitest';
import { CAMERAS, HOME_MORNING, type CameraPreset } from './cameras';
import { draw, registerTerrain, when } from './renderer';
import west from './terrain/west.json';
import south from './terrain/south.json';
import pano from './terrain/pano.json';

// The older single views are imported here only, so they stay out of the bundle.
registerTerrain('west', west);
registerTerrain('south', south);

const W = 2560;
const H = 720;
/** The renderer samples the skyline every 2 design pixels: ceil(W / 2) + 1 points. */
const N = Math.ceil(W / 2) + 1;
/** 0.5 percent of the stage height, in design pixels. */
const TOL = 0.005 * H;

/** A 2D context that accepts every call and records each filled path's lineTo points. */
function recordingContext() {
  const filled: number[][][] = [];
  let path: number[][] = [];
  const gradient = () => ({ addColorStop() {} });
  const methods: Record<string, unknown> = {
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => ({}),
    createImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4) }),
    beginPath: () => void (path = []),
    lineTo: (x: number, y: number) => void path.push([x, y]),
    fill: () => void filled.push(path),
  };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (store, key: string) => (key in store ? store[key] : (methods[key] ?? (() => {}))),
    set: (store, key: string, value) => {
      store[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, filled };
}

/**
 * The terrain layers as drawn: every filled path that runs the whole width (N skyline points
 * plus the closing corner). In order: the far range, its snow tints, the mid ridge, the near shore.
 */
function layers(ter: 'pano' | 'west' | 'south', cam: CameraPreset, ms: number): number[][] {
  const { ctx, filled } = recordingContext();
  draw(ctx, { W, H, scale: 1, ter, hy: cam.hy, az0: cam.az0, ppd: cam.ppd, vex: cam.vex, cityScale: cam.cs, vx: cam.vx, snowDeg: cam.snowDeg, ms, t: 0, phase: 0, grain: false });
  return filled.filter((p) => p.length === N + 1).map((p) => p.slice(0, N).map(([, y]) => cam.hy - y));
}

/** Largest and 99th percentile absolute difference between two height profiles. */
function diff(a: number[], b: number[]) {
  const d = a.map((v, i) => Math.abs(v - b[i])).sort((x, y) => x - y);
  return { max: d[d.length - 1], p99: d[Math.floor(d.length * 0.99)] };
}

describe('the panorama matches the single views it replaces', () => {
  const afternoon = when(2026, 11, 11, 16.5);
  const morning = when(2026, 11, 11, 7.2);

  // The panorama is the same elevation data resampled on a grid shifted by two thirds of a
  // step, so steep cliffs land up to 4.1 design pixels apart (0.57 percent of the stage, on
  // Unwind's 2.5 times exaggeration). 99 percent of samples sit within 0.5 percent, and every
  // sample within 0.6 percent.
  for (const place of ['work', 'home', 'unwind'] as const) {
    it(`draws the ${place} camera like the west view`, () => {
      const cam = CAMERAS[place];
      const p = layers('pano', cam, afternoon);
      const w = layers('west', cam, afternoon);
      expect(p.length).toBe(w.length);
      expect(p.length).toBeGreaterThanOrEqual(3); // far, mid and near at least
      for (const i of [0, p.length - 2, p.length - 1]) {
        expect(Math.max(...p[i])).toBeGreaterThan(5); // a real skyline, not an empty lookup
        const d = diff(p[i], w[i]);
        expect(d.p99).toBeLessThanOrEqual(TOL);
        expect(d.max).toBeLessThanOrEqual(0.006 * H);
      }
    });
  }

  it('draws the morning camera exactly like the south view (the same samples)', () => {
    const p = layers('pano', HOME_MORNING, morning);
    const s = layers('south', HOME_MORNING, morning);
    expect(p.length).toBe(s.length);
    expect(Math.max(...p[0])).toBeGreaterThan(150); // Rainier, about 168 px tall
    for (let i = 0; i < p.length; i++) expect(diff(p[i], s[i]).max).toBeLessThanOrEqual(TOL / 100);
  });

  it('covers every camera and every step of the swing: azimuth 128 to 300 in one profile', () => {
    expect(pano.az0).toBe(128);
    expect(pano.far.length).toBe(pano.mid.length);
    expect(pano.near.length).toBe(pano.far.length);
    const end = pano.az0 + (pano.far.length - 1) * pano.step;
    expect(end).toBeCloseTo(300, 1);
    for (const cam of [...Object.values(CAMERAS), HOME_MORNING]) {
      expect(cam.az0).toBeGreaterThanOrEqual(pano.az0);
      expect(cam.az0 + W / cam.ppd).toBeLessThanOrEqual(end);
    }
  });
});
