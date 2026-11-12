import { terrainOf, type CameraPreset } from './cameras';

/** Seconds the new terrain takes to fade in over the old one. */
export const FADE_SECONDS = 2;

/** A cross-fade in progress: the old view keeps drawing underneath while the new one fades in. */
export interface Fade {
  /** The camera the old view was on when the fade began. */
  camera: CameraPreset;
  /** Whether the old view carries the Unwind moon. */
  moon: boolean;
  /** Opacity of the new view, 0 to 1 (linear in time). */
  progress: number;
}

/** A fade from `from` to `to`, or null when none is needed: instant switches and same-terrain moves glide instead. */
export function startFade(from: CameraPreset, to: CameraPreset, instant: boolean, moon = false): Fade | null {
  if (instant || terrainOf(from) === terrainOf(to)) return null;
  return { camera: from, moon, progress: 0 };
}

/** Advance a fade by `dt` seconds; null once it has finished (the old layer is dropped). */
export function stepFade(fade: Fade, dt: number, seconds = FADE_SECONDS): Fade | null {
  const progress = fade.progress + dt / seconds;
  return progress >= 1 ? null : { ...fade, progress };
}
