import { afterEach, describe, expect, it } from 'vitest';
import { createGlitch, rnd, type GlitchSources } from './glitch';
import { DROP_S } from './mix';
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
});
