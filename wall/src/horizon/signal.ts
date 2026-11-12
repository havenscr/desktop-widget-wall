import type { CameraPreset } from './cameras';

/**
 * A small read-only signal from the horizon: the camera it is pointed at (or heading to) and
 * whether it is moving (a glide, a swing or the cinematic turn). Watt reads it so it is only up
 * while the camera is settled on its place. `HorizonCanvas` is the only writer.
 */
export interface CameraSignal {
  /** The camera the horizon is on, or gliding to; null before the horizon mounts. */
  readonly to: CameraPreset | null;
  /** True while the camera is moving. */
  readonly moving: boolean;
}

const state: { to: CameraPreset | null; moving: boolean } = { to: null, moving: false };
const listeners = new Set<() => void>();

/** The current signal. The same object every call; read its fields, do not keep a copy. */
export function cameraSignal(): CameraSignal {
  return state;
}

/** Called when the signal changes. Returns the unsubscribe function. */
export function subscribeCamera(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Horizon only: publish where the camera is going and whether it is moving. Notifies on a change only. */
export function publishCamera(to: CameraPreset | null, moving: boolean): void {
  if (state.to === to && state.moving === moving) return;
  state.to = to;
  state.moving = moving;
  for (const fn of listeners) fn();
}
