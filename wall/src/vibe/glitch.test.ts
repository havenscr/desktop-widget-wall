import { afterEach, describe, expect, it } from 'vitest';
import { createGlitch, FADE_IN, rnd, type GlitchSources } from './glitch';
import { DROP_S, createVibeFrame, createVibeState, noteDrop, settleVibe, stepVibe } from './mix';
import { DEFAULT_VIBE } from '../horizon/vibeSettings';
import { DROP_FULL_RATIO, DROP_MIN_STRENGTH, DROP_RATIO, dropStrength } from '../audio/energy';
import { stubCanvas } from './testCanvas';

let restore = () => {};
afterEach(() => restore());

function make() {
  const s = stubCanvas();
  restore = s.restore;
  const g = createGlitch();
  g.bake(760);
  const hz = document.createElement('canvas');
  const src: GlitchSources = { hz, map: { ax: 2, bx: 10, ay: 2, by: 4 }, img: null, art: { x: 0, y: 0, w: 0, h: 0 } };
  s.rec.calls.length = 0;
  return { g, rec: s.rec, src, hz };
}
const drops = (...t: number[]) => {
  const d = new Float64Array(8).fill(-Infinity);
  t.forEach((v, i) => (d[i] = v));
  return d;
};
const slices = (calls: unknown[][], hz: HTMLCanvasElement) => calls.filter((c) => c[0] === 'drawImage' && c[1] === hz);

describe('Drop Glitch', () => {
  it('its random numbers repeat for a seed and stay in 0 to 1', () => {
    for (let i = 0; i < 50; i++) {
      const v = rnd(i * 3.7, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(rnd(i * 3.7, i)).toBe(v);
    }
  });

  it('draws nothing with no drop, no strength, or a drop that is over', () => {
    const { g, rec, src, hz } = make();
    g.draw(rec.ctx, 760, 340, 10, drops(), 1, src);
    g.draw(rec.ctx, 760, 340, 10.3, drops(10), 0, src);
    g.draw(rec.ctx, 760, 340, 10 + DROP_S + 0.1, drops(10), 1, src);
    expect(slices(rec.calls, hz)).toHaveLength(0);
  });

  it('a drop tears slices copied from the horizon canvas, tinted, feathered, and read at the mapped position', () => {
    const { g, rec, src, hz } = make();
    g.draw(rec.ctx, 760, 340, 10.3, drops(10), 1, src);
    const copies = slices(rec.calls, hz);
    expect(copies.length).toBeGreaterThanOrEqual(7);
    for (const c of copies) {
      // Source x is the map's offset plus the slice's own x, scaled: never negative with this map.
      expect(c[2] as number).toBeGreaterThanOrEqual(10);
    }
    expect(rec.calls.some((c) => c[0] === 'set globalCompositeOperation' && c[1] === 'source-atop')).toBe(true);
    expect(rec.calls.some((c) => c[0] === 'set globalCompositeOperation' && c[1] === 'destination-in')).toBe(true);
  });

  it('fades in and out and never cuts: the alpha rises at first, falls through the tail, and ends at none', () => {
    const { g, rec, src } = make();
    const peak = (age: number) => {
      rec.calls.length = 0;
      g.draw(rec.ctx, 760, 340, 10 + age, drops(10), 1, src);
      let m = 0;
      for (const c of rec.calls) if (c[0] === 'set globalAlpha' && typeof c[1] === 'number' && c[1] < 1) m = Math.max(m, c[1]);
      return m;
    };
    const early = peak(0.01);
    const mid = peak(0.15);
    const late = peak(0.8);
    expect(early).toBeLessThan(mid);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(mid);
    expect(peak(DROP_S + 0.01)).toBe(0);
  });

  it('two drops overlap their tails: both draw while both are live', () => {
    const { g, rec, src, hz } = make();
    g.draw(rec.ctx, 760, 340, 10.3, drops(10), 1, src);
    const one = slices(rec.calls, hz).length;
    rec.calls.length = 0;
    g.draw(rec.ctx, 760, 340, 10.3, drops(10, 9.9), 1, src);
    expect(slices(rec.calls, hz).length).toBeGreaterThan(one);
  });

  it('the art picture is torn too where a slice crosses its box', () => {
    const { g, rec, src } = make();
    const img = document.createElement('img');
    Object.defineProperty(img, 'naturalWidth', { value: 300 });
    Object.defineProperty(img, 'naturalHeight', { value: 300 });
    src.img = img;
    src.art = { x: 100, y: 0, w: 200, h: 340 };
    g.draw(rec.ctx, 760, 340, 10.3, drops(10), 1, src);
    expect(rec.calls.some((c) => c[0] === 'drawImage' && c[1] === img)).toBe(true);
  });

  it('Tear is the look when none is named, and Off draws nothing', () => {
    const off = make();
    off.g.draw(off.rec.ctx, 760, 340, 10.3, drops(10), 1, off.src, undefined, 'off');
    expect(slices(off.rec.calls, off.hz)).toHaveLength(0);
    const t = make();
    t.g.draw(t.rec.ctx, 760, 340, 10.3, drops(10), 1, t.src, undefined, 'tear');
    const tear = slices(t.rec.calls, t.hz).length;
    expect(tear).toBeGreaterThanOrEqual(7);
    const n = make();
    n.g.draw(n.rec.ctx, 760, 340, 10.3, drops(10), 1, n.src);
    expect(slices(n.rec.calls, n.hz)).toHaveLength(tear);
  });

  const others = ['split', 'roll', 'flash'] as const;
  const peakOf = (look: (typeof others)[number], age: number, power?: Float64Array) => {
    const { g, rec, src } = make();
    g.draw(rec.ctx, 760, 340, 10 + age, drops(10), 1, src, power, look);
    let m = 0;
    for (const c of rec.calls) if (c[0] === 'set globalAlpha' && typeof c[1] === 'number' && c[1] < 1) m = Math.max(m, c[1]);
    return { m, calls: rec.calls };
  };

  for (const look of others) {
    it(`${look}: rises in 50 ms, fades out over the next second, draws nothing after it and fades in from the left edge`, () => {
      const early = peakOf(look, 0.005).m;
      const mid = peakOf(look, 0.12).m;
      const late = peakOf(look, 0.8).m;
      expect(early).toBeLessThan(mid);
      expect(late).toBeGreaterThan(0);
      expect(late).toBeLessThan(mid);
      expect(peakOf(look, DROP_S + 0.01).calls.some((c) => c[0] === 'drawImage')).toBe(false);
      // The layer is multiplied by the left-edge strip, then added over the scene: never a hard start.
      const calls = peakOf(look, 0.12).calls;
      const mask = calls.findIndex((c) => c[0] === 'set globalCompositeOperation' && c[1] === 'destination-in');
      const add = calls.findIndex((c) => c[0] === 'set globalCompositeOperation' && c[1] === 'screen');
      expect(mask).toBeGreaterThan(0);
      expect(add).toBeGreaterThan(mask);
      expect(FADE_IN).toBeGreaterThan(0.1);
    });

    it(`${look}: a bigger drop hits harder, and the same drop is stronger than a small one`, () => {
      const big = peakOf(look, 0.12, new Float64Array(8).fill(1)).m;
      const small = peakOf(look, 0.12, new Float64Array(8).fill(0.6)).m;
      expect(small).toBeLessThan(big);
    });
  }

  it('Split pulls the colour channels apart both ways and shakes wide bands', () => {
    const { calls } = peakOf('split', 0.12);
    const hzCalls = calls.filter((c) => c[0] === 'drawImage');
    const xs = hzCalls.filter((c) => c.length === 10).map((c) => c[6] as number);
    expect(xs.some((x) => x > 0)).toBe(true);
    expect(xs.some((x) => x < 0)).toBe(true);
    expect(calls.some((c) => c[0] === 'set fillStyle' && String(c[1]).includes('255,60,170'))).toBe(true);
    expect(calls.some((c) => c[0] === 'set fillStyle' && String(c[1]).includes('60,220,255'))).toBe(true);
  });

  it('Split pulls its channels once for all live drops, not once per drop', () => {
    const one = make();
    one.g.draw(one.rec.ctx, 760, 340, 10.3, drops(10), 1, one.src, undefined, 'split');
    const two = make();
    two.g.draw(two.rec.ctx, 760, 340, 10.3, drops(10, 9.9), 1, two.src, undefined, 'split');
    const fills = (calls: unknown[][]) => calls.filter((c) => c[0] === 'set fillStyle' && String(c[1]).includes('255,60,170')).length;
    expect(fills(one.rec.calls)).toBe(1);
    expect(fills(two.rec.calls)).toBe(1);
  });

  it('Roll moves its band down the screen as the drop ages', () => {
    const bandY = (age: number) => {
      const { calls } = peakOf('roll', age);
      const bands = calls.filter((c) => c[0] === 'drawImage' && (c[1] as HTMLCanvasElement).width === 1);
      return bands[0]?.[3] as number;
    };
    expect(bandY(0.3)).toBeLessThan(bandY(0.7));
  });

  it('Flash draws a bloom and a small zoom punch of the horizon', () => {
    const { calls } = peakOf('flash', 0.12);
    const zoom = calls.filter((c) => c[0] === 'drawImage' && (c[1] as HTMLCanvasElement).width !== 128 && (c[8] as number) > 760);
    expect(zoom.length).toBeGreaterThan(0);
    expect((zoom[0][8] as number) / 760).toBeLessThan(1.06);
    expect(calls.some((c) => c[0] === 'drawImage' && (c[1] as HTMLCanvasElement).width === 128)).toBe(true);
  });
});

describe('Changing the look during a drop never cuts', () => {
  const peak = (calls: unknown[][]) => {
    let m = 0;
    for (const c of calls) if (c[0] === 'set globalAlpha' && typeof c[1] === 'number' && c[1] < 1) m = Math.max(m, c[1]);
    return m;
  };
  const bloom = (calls: unknown[][]) => calls.some((c) => c[0] === 'drawImage' && (c[1] as HTMLCanvasElement).width === 128);
  const tinted = (calls: unknown[][], rgb: string) => calls.some((c) => c[0] === 'set fillStyle' && String(c[1]).includes(rgb));

  it('Flash to Off fades the Flash out over about 250 ms: lower, still drawn, then gone', () => {
    const { g, rec, src } = make();
    g.draw(rec.ctx, 760, 340, 10.2, drops(10), 1, src, undefined, 'flash');
    const before = peak(rec.calls);
    rec.calls.length = 0;
    g.draw(rec.ctx, 760, 340, 10.23, drops(10), 1, src, undefined, 'off');
    expect(bloom(rec.calls)).toBe(true);
    const mid = peak(rec.calls);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(before);
    rec.calls.length = 0;
    g.draw(rec.ctx, 760, 340, 10.36, drops(10), 1, src, undefined, 'off');
    const later = peak(rec.calls);
    expect(later).toBeLessThan(mid);
    rec.calls.length = 0;
    g.draw(rec.ctx, 760, 340, 10.5, drops(10), 1, src, undefined, 'off');
    expect(rec.calls.some((c) => c[0] === 'drawImage')).toBe(false);
  });

  it('Flash to Split crossfades: both looks draw while the weights trade places, then only Split', () => {
    const { g, rec, src } = make();
    g.draw(rec.ctx, 760, 340, 10.2, drops(10), 1, src, undefined, 'flash');
    rec.calls.length = 0;
    g.draw(rec.ctx, 760, 340, 10.23, drops(10), 1, src, undefined, 'split');
    expect(bloom(rec.calls)).toBe(true);
    expect(tinted(rec.calls, '255,60,170')).toBe(true);
    rec.calls.length = 0;
    g.draw(rec.ctx, 760, 340, 10.5, drops(10), 1, src, undefined, 'split');
    expect(bloom(rec.calls)).toBe(false);
    expect(tinted(rec.calls, '255,60,170')).toBe(true);
  });

  it('Tear to Off fades the slices out in steps, not at once', () => {
    const { g, rec, src, hz } = make();
    g.draw(rec.ctx, 760, 340, 10.2, drops(10), 1, src, undefined, 'tear');
    rec.calls.length = 0;
    g.draw(rec.ctx, 760, 340, 10.23, drops(10), 1, src, undefined, 'off');
    expect(slices(rec.calls, hz).length).toBeGreaterThan(0);
    rec.calls.length = 0;
    g.draw(rec.ctx, 760, 340, 10.6, drops(10), 1, src, undefined, 'off');
    expect(slices(rec.calls, hz)).toHaveLength(0);
  });
});

describe('Drop strength follows the jump', () => {
  it('maps a bare crossing to the weakest hit and a big jump to full', () => {
    expect(dropStrength(DROP_RATIO)).toBeCloseTo(DROP_MIN_STRENGTH, 10);
    expect(dropStrength(DROP_FULL_RATIO)).toBe(1);
    expect(dropStrength(9)).toBe(1);
    expect(dropStrength(1.0)).toBeCloseTo(DROP_MIN_STRENGTH, 10);
    expect(dropStrength(1.75)).toBeGreaterThan(dropStrength(1.5));
    expect(dropStrength(NaN)).toBe(1);
  });

  it('a drop keeps its own strength in its slot', () => {
    const s = createVibeState();
    noteDrop(s, 1, 0.7);
    noteDrop(s, 2);
    expect(s.power[0]).toBeCloseTo(0.7, 10);
    expect(s.power[1]).toBe(1);
  });

  it('Off with Auto vibe on keeps the glitch at 0 in the frame', () => {
    const s = createVibeState();
    const f = createVibeFrame();
    const settings = { ...DEFAULT_VIBE, auto: true, dropGlitch: 'off' as const };
    settleVibe(s, settings, true, 0.5);
    stepVibe(s, f, 0.016, 5, { settings, playing: true, energy: 0.5 });
    expect(f.glitch).toBe(0);
    const on = { ...settings, dropGlitch: 'flash' as const };
    settleVibe(s, on, true, 0.5);
    stepVibe(s, f, 0.016, 5, { settings: on, playing: true, energy: 0.5 });
    expect(f.glitch).toBe(1);
  });
});
