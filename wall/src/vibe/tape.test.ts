import { afterEach, describe, expect, it } from 'vitest';
import { createTape, SHIMMER_HZ } from './tape';
import { stubCanvas } from './testCanvas';

let restore = () => {};
afterEach(() => restore());

function baked() {
  const s = stubCanvas();
  restore = s.restore;
  const tape = createTape();
  tape.bake(s.rec.ctx, 760);
  s.rec.calls.length = 0;
  return { tape, rec: s.rec };
}

describe('Tape Grain', () => {
  it('draws nothing at no strength', () => {
    const { tape, rec } = baked();
    tape.draw(rec.ctx, 760, 340, 5, 0, 0.5, false);
    expect(rec.calls).toEqual([]);
  });

  it('fills the grain and the lines over the whole canvas and draws the tracking bar as a sprite, never over 1 alpha', () => {
    const { tape, rec } = baked();
    tape.draw(rec.ctx, 760, 340, 5, 0.8, 0.5, false);
    const fills = rec.calls.filter((c) => c[0] === 'fillRect');
    expect(fills).toHaveLength(2);
    expect(rec.calls.filter((c) => c[0] === 'drawImage')).toHaveLength(1);
    for (const c of rec.calls.filter((c) => c[0] === 'set globalAlpha')) expect(c[1] as number).toBeLessThanOrEqual(1);
  });

  it('shimmers in steps (the grain moves 12 times a second) and not within a step', () => {
    const { tape, rec } = baked();
    const shift = (t: number) => {
      rec.calls.length = 0;
      tape.draw(rec.ctx, 760, 340, t, 0.8, 0.5, false);
      return JSON.stringify(rec.calls.find((c) => c[0] === 'setTransform'));
    };
    expect(shift(5.0)).toBe(shift(5.0 + 0.5 / SHIMMER_HZ - 0.001));
    expect(shift(5.0)).not.toBe(shift(5.0 + 1.2 / SHIMMER_HZ));
  });

  it('reduced motion keeps the grain still and draws no tracking bar', () => {
    const { tape, rec } = baked();
    tape.draw(rec.ctx, 760, 340, 5, 0.8, 0.5, true);
    const a = JSON.stringify(rec.calls);
    rec.calls.length = 0;
    tape.draw(rec.ctx, 760, 340, 9.37, 0.8, 0.5, true);
    expect(JSON.stringify(rec.calls)).toBe(a);
    expect(rec.calls.some((c) => c[0] === 'drawImage')).toBe(false);
  });

  it('the tracking bar is a feathered sprite: its gradient starts and ends at no alpha', () => {
    const s = stubCanvas();
    restore = s.restore;
    const stops: unknown[] = [];
    const real = s.rec.ctx;
    (real as unknown as { createLinearGradient: () => unknown }).createLinearGradient = () => ({ addColorStop: (u: number, c: string) => stops.push([u, c]) });
    createTape().bake(real, 100);
    expect(String((stops[0] as unknown[])[1])).toMatch(/,0\.0000\)/);
    expect(String((stops[stops.length - 1] as unknown[])[1])).toMatch(/,0\.0000\)/);
  });
});
