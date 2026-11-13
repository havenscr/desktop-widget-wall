import { describe, expect, it } from 'vitest';
import { css, draw, hash, pal, peaks, peaksOf, spec, sun, when, type HorizonDrawOptions, type HorizonGrid } from './renderer';
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

describe('echo sample', () => {
  const cam = CAMERAS.unwind;
  const withSample = (sample: (u: number, tau: number) => number) =>
    frame(cam, 21.7, { echo: { n: cam.en, amp: cam.eamp, a: 0.5, t: 2.5, cx: cam.ecx, hs: 900, sample } });

  it('without sample the calls are the golden log; with spec as the sample they are identical', () => {
    const base = calls(frame(cam, 21.7));
    expect(fnv(base.join('\n'))).toBe('5f3dfbd3');
    expect(calls(withSample(spec))).toEqual(base);
  });

  it('a sample replaces spec for the line heights: u runs 0 at cx to 1 at hs away, tau is t minus the line\'s share of 7 s', () => {
    const us: number[] = [];
    const taus = new Set<number>();
    const flat = calls(
      withSample((u, tau) => {
        us.push(u);
        taus.add(tau);
        return 0;
      }),
    );
    expect(flat).not.toEqual(calls(frame(cam, 21.7)));
    expect(Math.min(...us)).toBeLessThan(0.002);
    expect(Math.max(...us)).toBe(1);
    expect(taus.size).toBe(cam.en);
    for (const tau of taus) expect(tau).toBeLessThanOrEqual(2.5);
    for (const tau of taus) expect(tau).toBeGreaterThan(2.5 - 7);
    // A taller sample raises the lines (smaller y on the canvas) where the range has height.
    expect(calls(withSample(() => 1.3))).not.toEqual(flat);
  });
});

describe('echo tint (the Unwind playing look)', () => {
  const cam = CAMERAS.unwind;
  const TINT = { left: [92, 196, 255], centre: [56, 236, 240], right: [255, 61, 154], width: 1.8 };
  const tinted = (k: number) => frame(cam, 21.7, { echo: { n: cam.en, amp: cam.eamp, a: 0.5, t: 2.5, cx: cam.ecx, hs: 900, tint: { ...TINT, k } } });

  it('no tint, or a tint at k 0, makes the golden calls exactly (the golden log is unchanged)', () => {
    const base = calls(frame(cam, 21.7));
    expect(fnv(base.join('\n'))).toBe('5f3dfbd3');
    expect(calls(tinted(0))).toEqual(base);
  });

  it('a full tint adds one gradient for the lines and changes only their stroke style, width and opacity', () => {
    const base = calls(frame(cam, 21.7));
    const log = calls(tinted(1));
    const anon = (l: string) => l.replace(/(linear|radial)\d+/g, '$1');
    expect(log.length).toBe(base.length + 5); // one gradient and its four stops
    let at = 0;
    while (log[at] === base[at]) at++;
    expect(log[at]).toMatch(/^linear\(0,0,2560,0\)=/);
    const added = log.slice(at, at + 5).map(anon);
    expect(added.slice(1).every((l) => l.startsWith('linear.stop('))).toBe(true);
    expect(added.join()).toContain('rgb(56,236,240)'); // the teal at cx
    expect(added.join()).toContain('rgb(255,61,154)'); // the pink at the right edge
    const changed = new Set<string>();
    for (let k = at; k < base.length; k++) {
      const a = anon(base[k]);
      const b = anon(log[k + 5]);
      if (a !== b) changed.add(`${a.split(/[=(]/)[0]}`);
    }
    // Gradient ids are anonymised above, so the stroke change shows as the lines using the new gradient.
    expect([...changed].sort()).toEqual(['globalAlpha', 'lineWidth']);
    const id = log[at].split('=')[1];
    expect(log.filter((l) => l === `strokeStyle=[${id}]`)).toHaveLength(cam.en);
  });
});

describe('the resting ridgelines (parity PR 41)', () => {
  const cam = CAMERAS.unwind;
  const TINT = { left: [92, 196, 255], centre: [56, 236, 240], right: [255, 61, 154], width: 1.5 };
  const playing = (extra: Record<string, unknown> = {}) =>
    frame(cam, 21.7, { echo: { n: cam.en, amp: cam.eamp, a: 1, t: 2.5, cx: cam.ecx, hs: 900, tint: { ...TINT, k: 1 }, ...extra } });

  it('the golden log is unchanged: without rest and drift the calls are exactly as before', () => {
    expect(fnv(calls(frame(cam, 21.7)).join('\n'))).toBe('5f3dfbd3');
  });

  it('once fully risen (rest 0) the playing frame is unchanged, and a drift equal to t times the speed draws the same', () => {
    const base = calls(playing());
    expect(calls(playing({ rest: 0, restA: 0.22, look: 'contours' }))).toEqual(base);
    expect(calls(playing({ drift: (2.5 * 0.3) % 1 }))).toEqual(base);
    expect(calls(playing({ drift: 7 + ((2.5 * 0.3) % 1) }))).toEqual(base); // whole spacings wrap
    expect(fnv(calls(frame(cam, 21.7, { echo: { n: cam.en, amp: cam.eamp, a: 0.5, t: 2.5, cx: cam.ecx, hs: 900, rest: 0, drift: 0.75 } })).join('\n'))).toBe('5f3dfbd3');
  });

  // The rest frame's own golden log: Unwind at night, the default look (contours) at 0.22, settled
  // on the resting phase. Record a new value only for an intended change to the resting look.
  it('the rest frame (golden call log)', () => {
    const log = calls(playing({ rest: 1, restA: 0.22, look: 'contours', drift: 0.5 }));
    expect({ n: log.length, hash: fnv(log.join('\n')) }).toEqual({ n: 51972, hash: '896fac8b' });
  });
});

