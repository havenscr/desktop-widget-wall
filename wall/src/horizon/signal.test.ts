import { afterEach, expect, it, vi } from 'vitest';
import { CAMERAS } from './cameras';
import { cameraSignal, publishCamera, subscribeCamera } from './signal';

afterEach(() => publishCamera(null, false));

it('publishes the camera and whether it moves, in the same object every read', () => {
  const s = cameraSignal();
  publishCamera(CAMERAS.home, true);
  expect(cameraSignal()).toBe(s);
  expect(s).toMatchObject({ to: CAMERAS.home, moving: true });
  publishCamera(CAMERAS.home, false);
  expect(s).toMatchObject({ to: CAMERAS.home, moving: false });
});

it('notifies subscribers on a change only, and stops after unsubscribe', () => {
  publishCamera(CAMERAS.work, false);
  const fn = vi.fn();
  const off = subscribeCamera(fn);
  publishCamera(CAMERAS.work, false);
  expect(fn).not.toHaveBeenCalled();
  publishCamera(CAMERAS.work, true);
  publishCamera(CAMERAS.unwind, true);
  expect(fn).toHaveBeenCalledTimes(2);
  off();
  publishCamera(CAMERAS.work, false);
  expect(fn).toHaveBeenCalledTimes(2);
});

it('clears back to no camera, not moving', () => {
  publishCamera(CAMERAS.unwind, true);
  publishCamera(null, false);
  expect(cameraSignal()).toMatchObject({ to: null, moving: false });
});
