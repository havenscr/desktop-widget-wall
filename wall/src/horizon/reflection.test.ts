import { describe, expect, it, vi } from 'vitest';
import { REFLECT, REFLECT_ALPHA, createReflection, drawReflection, reflectionAlpha } from './reflection';
import { recordingContext } from './canvasStub';

/** A scratch canvas that records its own calls; `made` counts how many were created. */
function scratchMaker() {
  const made: { canvas: HTMLCanvasElement; log: string[] }[] = [];
  const make = () => {
    const { ctx, log } = recordingContext();
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    made.push({ canvas, log });
    return canvas;
  };
  return { made, make };
}

describe('reflectionAlpha', () => {
  it('is 0.8 times the weight times the gate, and 0 for no weight or a shut gate', () => {
    expect(REFLECT).toBe(true);
    expect(reflectionAlpha(1, 1)).toBe(REFLECT_ALPHA);
    expect(reflectionAlpha(0.5, 0.5)).toBeCloseTo(0.2, 9);
    expect(reflectionAlpha(0, 1)).toBe(0);
    expect(reflectionAlpha(1, 0)).toBe(0);
    expect(reflectionAlpha(3, 3)).toBe(REFLECT_ALPHA);
    expect(reflectionAlpha(-1, 1)).toBe(0);
  });
});

describe('drawReflection', () => {
  const main = () => {
    const r = recordingContext();
    Object.defineProperty(r.ctx, 'canvas', { value: { width: 2560, height: 720 } });
    return r;
  };

  it('copies the 190 px above the horizon, fades it, and draws it flipped at 0.62 of its height 3 px under the line, additively', () => {
    const { made, make } = scratchMaker();
    const r = createReflection();
    const m = main();
    expect(drawReflection(r, m.ctx, 2560, 720, 396, 1, 0.8, make)).toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0].canvas.width).toBe(2560);
    expect(made[0].canvas.height).toBe(190);
    const s = made[0].log;
    expect(s[0]).toBe('setTransform(1,0,0,1,0,0)');
    expect(s).toContain('globalCompositeOperation=copy');
    expect(s).toContain('drawImage([object],0,206,2560,190,0,0,2560,190)');
    expect(s).toContain('globalCompositeOperation=destination-in');
    expect(s.some((l) => l.endsWith('.stop(0,rgba(0,0,0,0))'))).toBe(true);
    expect(s.some((l) => l.endsWith('.stop(1,rgba(0,0,0,1))'))).toBe(true);
    expect(s).toContain('fillRect(0,0,2560,190)');
    expect(m.log).toEqual([
      'save()',
      `setTransform(1,0,0,-0.62,0,${396 + 0.62 * 190 + 3})`,
      'globalCompositeOperation=lighter',
      'globalAlpha=0.8',
      'drawImage([object],0,0)',
      'restore()',
    ]);
  });

  it('scales with the device pixels, and the band never reaches above the canvas', () => {
    const { made, make } = scratchMaker();
    const m = main();
    drawReflection(createReflection(), m.ctx, 1280, 360, 198, 0.5, 0.8, make);
    expect(made[0].canvas.height).toBe(95);
    expect(m.log[1]).toBe(`setTransform(1,0,0,-0.62,0,${99 + 0.62 * 95 + 1.5})`);
    const t = scratchMaker();
    const high = main();
    drawReflection(createReflection(), high.ctx, 2560, 720, 60, 1, 0.8, t.make);
    expect(t.made[0].canvas.height).toBe(60); // the horizon is only 60 px down: the band is cut to it
  });

  it('draws nothing at no opacity, and makes no canvas for it', () => {
    const { made, make } = scratchMaker();
    const m = main();
    expect(drawReflection(createReflection(), m.ctx, 2560, 720, 396, 1, 0, make)).toBe(false);
    expect(drawReflection(createReflection(), m.ctx, 2560, 720, 396, 1, 0.001, make)).toBe(false);
    expect(made).toHaveLength(0);
    expect(m.log).toEqual([]);
  });

  it('makes the scratch canvas once and resizes it only when the size changes', () => {
    const { made, make } = scratchMaker();
    const r = createReflection();
    const m = main();
    const sizeSets = vi.fn();
    for (let k = 0; k < 20; k++) drawReflection(r, m.ctx, 2560, 720, 396, 1, 0.8, make);
    expect(made).toHaveLength(1);
    expect(made[0].log.filter((l) => l.startsWith('linear('))).toHaveLength(1); // the fade gradient is made once, not per frame
    const c = made[0].canvas;
    Object.defineProperty(c, 'width', { get: () => 2560, set: sizeSets });
    drawReflection(r, m.ctx, 2560, 720, 396, 1, 0.8, make);
    expect(sizeSets).not.toHaveBeenCalled();
    drawReflection(r, m.ctx, 1280, 360, 198, 0.5, 0.8, make);
    expect(sizeSets).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(1);
  });
});
