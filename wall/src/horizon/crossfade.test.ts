import { describe, expect, it } from 'vitest';
import { CAMERAS, HOME_MORNING } from './cameras';
import { FADE_SECONDS, startFade, stepFade } from './crossfade';

describe('cross-fade', () => {
  it('starts only when the terrain changes', () => {
    expect(startFade(CAMERAS.home, HOME_MORNING, false)).toMatchObject({ camera: CAMERAS.home, progress: 0 });
    expect(startFade(HOME_MORNING, CAMERAS.home, false)).not.toBeNull();
    expect(startFade(CAMERAS.work, CAMERAS.home, false)).toBeNull();
    expect(startFade(HOME_MORNING, { ...HOME_MORNING, az0: 140 }, false)).toBeNull();
  });

  it('never starts when the switch is instant', () => {
    expect(startFade(CAMERAS.home, HOME_MORNING, true)).toBeNull();
  });

  it('runs for 2 seconds and then ends (the old layer is dropped)', () => {
    expect(FADE_SECONDS).toBe(2);
    let f = startFade(CAMERAS.home, HOME_MORNING, false)!;
    f = stepFade(f, 1)!;
    expect(f.progress).toBeCloseTo(0.5, 9);
    expect(stepFade(f, 0.99)!.progress).toBeLessThan(1);
    expect(stepFade(f, 1)).toBeNull();
  });
});
