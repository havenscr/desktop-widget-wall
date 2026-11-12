import type { CameraPreset } from './cameras';
import type { HorizonEcho } from './renderer';

/** Seconds the ripple takes to fade in or out. */
export const ECHO_FADE_S = 1;
/** Half width of the ripple in design pixels (the demo's value). */
export const ECHO_HALF_SPAN = 900;

/** Move the fade toward 1 while music plays and toward 0 when it does not, over about a second. */
export function stepEchoFade(fade: number, playing: boolean, dt: number): number {
  const step = Math.max(0, dt) / ECHO_FADE_S;
  return Math.min(1, Math.max(0, fade + (playing ? step : -step)));
}

/**
 * Ripple options for the camera now, or null (nothing drawn, so pixels match a frame
 * without a ripple). Opacity is the preset's `ea` scaled by the fade and by loudness
 * (0 to 1, bass weighted), never below a third of `ea` once the fade is up so quiet
 * passages still show a ripple.
 */
export function echoOptions(camera: CameraPreset, fade: number, loud: number, t: number): HorizonEcho | null {
  if (fade <= 0.001) return null;
  const level = Math.min(1, Math.max(0, loud));
  const a = camera.ea * fade * (0.35 + 0.65 * level);
  if (a <= 0.005) return null;
  return { n: Math.max(1, Math.round(camera.en)), amp: camera.eamp, a, t, cx: camera.ecx, hs: ECHO_HALF_SPAN };
}
