import { describe, expect, it } from 'vitest';
import { css, draw, hash, pal, peaks, peaksOf, sun, when, type HorizonDrawOptions, type HorizonGrid } from './renderer';
import { CAMERAS, type CameraPreset } from './cameras';
import { recordingContext } from './canvasStub';

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

  it('exposes the panorama peak list, which runs from Rainier round to the Olympics', () => {
    const names = (peaks as { name: string }[]).map((p) => p.name);
    expect(names).toContain('Mount Rainier');
    expect(names).toContain('The Brothers');
    expect(peaksOf('pano')).toBe(peaks);
  });
});

/** FNV-1a of a call log, for the golden checks below. */
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

/** Draw options for a camera at a Pacific hour, with a ripple, grain off (its pattern is cached after the first draw). */
function frame(cam: CameraPreset, hour: number, extra: Partial<HorizonDrawOptions> = {}): HorizonDrawOptions {
  return { W: 2560, H: 720, scale: 1, hy: cam.hy, az0: cam.az0, ppd: cam.ppd, vex: cam.vex, snowDeg: cam.snowDeg, cityScale: cam.cs, vx: cam.vx, ms: when(2026, 11, 11, hour), t: 2.5, phase: 0.4, grain: false, echo: { n: cam.en, amp: cam.eamp, a: 0.5, t: 2.5, cx: cam.ecx, hs: 900 }, ...extra };
}

function calls(o: HorizonDrawOptions): string[] {
  const { ctx, log } = recordingContext();
  draw(ctx, o);
  return log;
}

describe('grid pulse', () => {
  // Golden call logs recorded from the renderer before the grid pulse existed (main at 48c2527).
  // Without `grid` the canvas calls must match them exactly. If a later change to the art is
  // intended, record new values with the same frames and say so in that pull request.
  const GOLDEN = { unwind: { n: 51967, hash: '5f3dfbd3' }, work: { n: 21508, hash: '557ae35d' } };

  it('without a grid the canvas calls are unchanged from before the pulse (golden call log)', () => {
    const unwind = calls(frame(CAMERAS.unwind, 21.7));
    const work = calls(frame(CAMERAS.work, 12));
    expect({ n: unwind.length, hash: fnv(unwind.join('\n')) }).toEqual(GOLDEN.unwind);
    expect({ n: work.length, hash: fnv(work.join('\n')) }).toEqual(GOLDEN.work);
  });

  it('a null grid, and a grid with no brightness and only spent waves, make the same calls as no grid', () => {
    const base = calls(frame(CAMERAS.unwind, 21.7));
    expect(calls(frame(CAMERAS.unwind, 21.7, { grid: null }))).toEqual(base);
    const idle: HorizonGrid = { bright: 0, waves: [{ p: 0.4, a: 0 }, { p: 0, a: 0 }] };
    expect(calls(frame(CAMERAS.unwind, 21.7, { grid: idle }))).toEqual(base);
  });

  it('bright raises the grid stroke from 0.3 to at most 0.55, and changes nothing else', () => {
    const base = calls(frame(CAMERAS.work, 12));
    const lit = calls(frame(CAMERAS.work, 12, { grid: { bright: 1, waves: [] } }));
    const over = calls(frame(CAMERAS.work, 12, { grid: { bright: 7, waves: [] } }));
    expect(lit).toHaveLength(base.length);
    const diff = lit.map((l, i) => [base[i], l]).filter(([a, b]) => a !== b);
    expect(diff).toHaveLength(1);
    expect(diff[0][0]).toMatch(/^strokeStyle=rgba\(.*,0\.3\)$/);
    expect(diff[0][1]).toMatch(/^strokeStyle=rgba\(.*,0\.55\)$/);
    expect(over).toEqual(lit);
    const half = calls(frame(CAMERAS.work, 12, { grid: { bright: 0.5, waves: [] } }));
    expect(half.find((l, i) => l !== base[i])).toMatch(/,0\.425\)$/);
  });

  it('each live wave draws one additive glow band below the horizon, deeper bands lower and taller', () => {
    const cam = CAMERAS.unwind;
    const base = calls(frame(cam, 21.7));
    const log = calls(frame(cam, 21.7, { grid: { bright: 0, waves: [{ p: 0.2, a: 0.5 }, { p: 0.8, a: 0.25 }, { p: 0.5, a: 0 }] } }));
    // The pulse is one block inserted into the draw: everything before and after it matches.
    let at = 0;
    while (log[at] === base[at]) at++;
    const added = log.slice(at, at + log.length - base.length);
    const anon = (l: string) => l.replace(/(linear|radial)\d+/g, '$1'); // gradient ids count up, so they shift after the block
    expect(log.slice(at + added.length).map(anon)).toEqual(base.slice(at).map(anon));
    expect(added[0]).toBe('save()');
    expect(added).toContain('globalCompositeOperation=lighter');
    expect(added[added.length - 1]).toBe('restore()');
    // The two glow bands are radial gradients centred on the grid's vanishing x.
    const glows = added.filter((l) => l.startsWith('radial(0,0,0,0,0,'));
    expect(glows).toHaveLength(2);
    const ys = added.filter((l) => l.startsWith(`translate(${cam.vx},`)).map((l) => Number(l.split(',')[1].replace(')', '')));
    expect(ys).toHaveLength(2);
    expect(ys[0]).toBeCloseTo(cam.hy + (720 - cam.hy) * Math.pow(0.2, 2.1), 2); // the log rounds to 3 decimals
    expect(ys[1]).toBeCloseTo(cam.hy + (720 - cam.hy) * Math.pow(0.8, 2.1), 2);
    const radii = glows.map((l) => Number(l.split(',')[5].replace(/\).*/, '')));
    expect(radii[1]).toBeGreaterThan(radii[0]);
    // Clipped to the lake and put back to normal blending afterwards.
    expect(added).toContain(`rect(0,${cam.hy},2560,${720 - cam.hy})`);
  });
});
