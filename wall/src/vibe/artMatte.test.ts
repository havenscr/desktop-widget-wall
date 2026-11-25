import { afterEach, describe, expect, it } from 'vitest';
import { bakeMatte, radiusOf } from './artMatte';
import { stubCanvas } from './testCanvas';
import src from './artMatte.ts?raw';

let restore = () => {};
afterEach(() => restore());

const names = (calls: unknown[][]) => calls.map((c) => c[0]);

describe('the art matte', () => {
  it('bakes three sprites from the art clipped to its radius, and keeps its alpha', () => {
    const s = stubCanvas();
    restore = s.restore;
    const img = document.createElement('img');
    const m = bakeMatte(img, 224, 224, 26);
    expect([m.tight, m.wide, m.air].every((c) => c instanceof HTMLCanvasElement)).toBe(true);
    expect(m.pad).toBeGreaterThan(100);
    expect(m.tight.width).toBe(Math.round((224 + m.pad * 2) * 0.25));
    const n = names(s.rec.calls);
    // The art goes through a clip (its radius), then is tinted with source-in so a PNG's own alpha shapes the glow.
    expect(n).toContain('arcTo');
    expect(n).toContain('clip');
    expect(s.rec.calls.some((c) => c[0] === 'drawImage' && c[1] === img)).toBe(true);
    expect(s.rec.calls.some((c) => c[0] === 'set globalCompositeOperation' && c[1] === 'source-in')).toBe(true);
    // Each sprite ends feathered: a destination-in radial fade at its own edge.
    expect(s.rec.calls.filter((c) => c[0] === 'set globalCompositeOperation' && c[1] === 'destination-in').length).toBe(3);
  });

  it('falls back to a plain fill for a video box or an art that cannot be drawn', () => {
    const s = stubCanvas();
    restore = s.restore;
    bakeMatte(null, 600, 340, 12);
    expect(names(s.rec.calls)).toContain('fillRect');
    expect(s.rec.calls.some((c) => c[0] === 'drawImage' && c[1] instanceof HTMLImageElement)).toBe(false);
  });

  it('reads the computed border radius', () => {
    const el = document.createElement('div');
    el.style.borderTopLeftRadius = '26px';
    document.body.append(el);
    expect(radiusOf(el)).toBe(26);
    el.remove();
  });

  it('never reads pixels (a cross origin cover must not taint anything)', () => {
    const text = src.replace(/\r\n/g, '\n');
    expect(text.includes('get' + 'ImageData')).toBe(false);
    expect(text.includes('to' + 'DataURL')).toBe(false);
  });
});
