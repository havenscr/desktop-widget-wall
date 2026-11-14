import { describe, expect, it } from 'vitest';
import { recordingContext } from './canvasStub';
import { drawLineType } from './lineTypes';
import { DEFAULT_LINES, type LineType } from './linesSettings';

const types: LineType[] = ['bars', 'ribbon', 'sparks', 'skyline'];
const sample = (u: number, age: number) => Math.max(0, 1.2 - u - age * 0.2);

describe('new line types', () => {
  for (const type of types) it(`${type} draws above the horizon and clips out picture boxes`, () => {
    const { ctx, log } = recordingContext();
    drawLineType(ctx, { settings: { ...DEFAULT_LINES, type }, sample, amp: 57.8, cx: 1330, hs: 900, hy: 505, scale: 1, alpha: 1, kick: 0.7, dt: 1 / 30, boxes: [[1244, 110, 672, 378]] });
    expect(log).toContain('rect(1242,108,676,382)');
    expect(log).toContain('clip(evenodd)');
    expect(log.some((line) => line.startsWith('fill(') || line.startsWith('fillRect(') || line.startsWith('stroke('))).toBe(true);
    const ys = log.filter((line) => line.startsWith('fillRect(')).map((line) => Number(line.split(',')[1]));
    expect(ys.every((y) => y <= 505)).toBe(true);
  });

  it('draws nothing for mountains or no opacity', () => {
    const a = recordingContext();
    drawLineType(a.ctx, { settings: DEFAULT_LINES, sample, amp: 57.8, cx: 1330, hs: 900, hy: 505, scale: 1, alpha: 1, kick: 0, dt: 1 / 30, boxes: [] });
    expect(a.log).toEqual([]);
    const b = recordingContext();
    drawLineType(b.ctx, { settings: { ...DEFAULT_LINES, type: 'bars' }, sample, amp: 57.8, cx: 1330, hs: 900, hy: 505, scale: 1, alpha: 0, kick: 0, dt: 1 / 30, boxes: [] });
    expect(b.log).toEqual([]);
  });
});
