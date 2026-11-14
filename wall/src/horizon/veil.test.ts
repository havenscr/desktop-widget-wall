import { describe, expect, it } from 'vitest';
import css from '../styles/frame.css?raw';
import { recordingContext } from './canvasStub';
import { VEIL_RGB, VEIL_STOPS, drawVeil, veilStrength } from './veil';

describe('the veil on the front canvas', () => {
  it('has the stops and colour of the page veil in frame.css', () => {
    // Whitespace and line endings are taken out, so the comparison holds on any checkout.
    const flat = css.replace(/\s+/g, '');
    const block = /\.veil\{[^}]*\}/.exec(flat)![0];
    const stops = [...block.matchAll(/rgba\((\d+),(\d+),(\d+),(calc\(var\(--veil\)\*([\d.]+)\)|var\(--veil\))\)([\d.]+)(%?)/g)].map((m) => ({
      rgb: `${m[1]},${m[2]},${m[3]}`,
      k: m[5] ? Number(m[5]) : 1,
      at: m[7] ? Number(m[6]) / 100 : Number(m[6]),
    }));
    expect(stops.map((s) => s.rgb)).toEqual(VEIL_STOPS.map(() => VEIL_RGB));
    expect(stops.map((s) => [s.at, s.k])).toEqual(VEIL_STOPS.map(([o, k]) => [o, k]));
  });

  it('lays it on the canvas\'s own pixels only (source-atop), the whole canvas, with an explicit transform, and nothing at 0', () => {
    const { ctx, log } = recordingContext();
    drawVeil(ctx, 3200, 900, 0.1);
    expect(log).toContain('globalCompositeOperation=source-atop');
    expect(log).toContain('setTransform(1,0,0,1,0,0)');
    expect(log).toContain('fillRect(0,0,3200,900)');
    expect(log.filter((l) => l.includes('.stop('))).toEqual([
      'linear0.stop(0,rgba(6,4,22,0.1))',
      'linear0.stop(0.64,rgba(6,4,22,0.1))',
      'linear0.stop(0.76,rgba(6,4,22,0.03))',
      'linear0.stop(1,rgba(6,4,22,0.03))',
    ]);
    expect(log[0]).toBe('save()');
    expect(log[log.length - 1]).toBe('restore()');
    const none = recordingContext();
    drawVeil(none.ctx, 3200, 900, 0);
    expect(none.log).toEqual([]);
  });

  it('makes its gradient once and lays the same one each frame, until the canvas, its height or the strength changes', () => {
    const { ctx, log } = recordingContext();
    for (let i = 0; i < 5; i++) drawVeil(ctx, 3200, 900, 0.25);
    expect(log.filter((l) => l.startsWith('linear(')).length).toBe(1);
    expect(log.filter((l) => l.startsWith('fillRect(')).length).toBe(5);
    drawVeil(ctx, 3200, 900, 0.3);
    drawVeil(ctx, 3200, 1000, 0.3);
    expect(log.filter((l) => l.startsWith('linear(')).length).toBe(3);
    const other = recordingContext();
    drawVeil(other.ctx, 3200, 1000, 0.3);
    expect(other.log.filter((l) => l.startsWith('linear(')).length).toBe(1);
  });

  it('reads the strength from the veil element, 0 without one', () => {
    expect(veilStrength(null)).toBe(0);
    const el = document.createElement('div');
    el.style.setProperty('--veil', '0.1');
    document.body.appendChild(el);
    expect(veilStrength(el)).toBeCloseTo(0.1);
    el.style.setProperty('--veil', 'nonsense');
    expect(veilStrength(el)).toBe(0);
    el.remove();
  });
});
