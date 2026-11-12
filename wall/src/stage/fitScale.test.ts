import { describe, expect, it } from 'vitest';
import { fitScale } from './fitScale';

describe('fitScale', () => {
  it('is exactly 1 at 2560 x 720', () => {
    expect(fitScale(2560, 720)).toBe(1);
  });
  it('is limited by height in a wider window', () => {
    expect(fitScale(3840, 720)).toBe(1);
    expect(fitScale(5120, 1440)).toBe(2);
    expect(fitScale(3000, 360)).toBe(0.5);
  });
  it('is limited by width in a taller window', () => {
    expect(fitScale(1280, 1080)).toBe(0.5);
  });
});
