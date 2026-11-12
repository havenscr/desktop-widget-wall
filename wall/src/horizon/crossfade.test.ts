import { describe, expect, it } from 'vitest';
import { CAMERAS, HOME_MORNING, type CameraPreset } from './cameras';
import { FADE_SECONDS, startFade, stepFade } from './crossfade';

// Every shipped preset is on the panorama, so a fade needs a camera on another terrain.
const SOUTH: CameraPreset = { ...HOME_MORNING, ter: 'south' };

describe('cross-fade', () => {
  it('starts only when the terrain changes', () => {
    expect(startFade(CAMERAS.home, SOUTH, false)).toMatchObject({ camera: CAMERAS.home, progress: 0 });
    expect(startFade(SOUTH, CAMERAS.home, false)).not.toBeNull();
    expect(startFade(CAMERAS.work, CAMERAS.home, false)).toBeNull();
    expect(startFade(SOUTH, { ...SOUTH, az0: 140 }, false)).toBeNull();
  });

  it('is never reached by the shipped presets: the morning swing is a same-terrain move', () => {
    expect(startFade(CAMERAS.home, HOME_MORNING, false)).toBeNull();
    expect(startFade(HOME_MORNING, CAMERAS.home, false)).toBeNull();
    expect(startFade(CAMERAS.work, HOME_MORNING, false)).toBeNull();
  });

  it('never starts when the switch is instant', () => {
    expect(startFade(CAMERAS.home, SOUTH, true)).toBeNull();
  });

  it('runs for 2 seconds and then ends (the old layer is dropped)', () => {
    expect(FADE_SECONDS).toBe(2);
    let f = startFade(CAMERAS.home, SOUTH, false)!;
    f = stepFade(f, 1)!;
    expect(f.progress).toBeCloseTo(0.5, 9);
    expect(stepFade(f, 0.99)!.progress).toBeLessThan(1);
    expect(stepFade(f, 1)).toBeNull();
  });
});
