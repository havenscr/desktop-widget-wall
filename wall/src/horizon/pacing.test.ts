import { describe, expect, it } from 'vitest';
import { MAX_STEP_S, MIN_FRAME_MS, frameDelta, shouldDraw } from './pacing';

describe('shouldDraw', () => {
  it('skips frames closer together than the minimum gap', () => {
    expect(shouldDraw(100 + MIN_FRAME_MS - 1, 100, false)).toBe(false);
    expect(shouldDraw(100 + MIN_FRAME_MS, 100, false)).toBe(true);
  });

  it('draws every second frame at 60 Hz, about 30 a second', () => {
    let last = 0;
    let drawn = 0;
    for (let i = 1; i <= 60; i++) {
      const now = i * (1000 / 60);
      if (shouldDraw(now, last, false)) {
        last = now;
        drawn++;
      }
    }
    expect(drawn).toBe(30);
  });

  it('never draws while the page is hidden', () => {
    expect(shouldDraw(10_000, 0, true)).toBe(false);
  });
});

describe('frameDelta', () => {
  it('converts to seconds', () => {
    expect(frameDelta(1050, 1000)).toBeCloseTo(0.05, 9);
  });

  it('caps a long stall at the maximum step and never goes negative', () => {
    expect(frameDelta(60_000, 0)).toBe(MAX_STEP_S);
    expect(frameDelta(0, 50)).toBe(0);
  });
});
