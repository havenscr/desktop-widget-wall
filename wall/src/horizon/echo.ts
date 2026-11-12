import type { CameraPreset, Glide } from './cameras';
import type { HorizonEcho } from './renderer';

/** Seconds the ripple takes to fade in or out. */
export const ECHO_FADE_S = 1;
/** Half width of the ripple in design pixels (the demo's value). */
export const ECHO_HALF_SPAN = 900;
/** Seconds the ripple takes to ramp out at the start of a turn to a camera without one, and back in after the turn away settles. */
export const ECHO_GATE_S = 0.6;

/** Move the fade toward 1 while music plays and toward 0 when it does not, over about a second. */
export function stepEchoFade(fade: number, playing: boolean, dt: number): number {
  const step = Math.max(0, dt) / ECHO_FADE_S;
  return Math.min(1, Math.max(0, fade + (playing ? step : -step)));
}

/**
 * The camera gate on the ripple, 0 to 1, advanced by `dt` seconds. A move that ends on a camera
 * with `ea` 0 (Rainier in the morning) ramps it to 0 over its first `ECHO_GATE_S`, and it stays 0
 * while that camera is the view and while a move away from it runs. Once such a move settles it
 * ramps back to 1 over `ECHO_GATE_S`. Every other move leaves it at (or ramps it up to) 1.
 * Multiply it into the fade passed to `echoOptions`, so the filled echo never crosses Rainier
 * and never pops on or off.
 */
export function stepEchoGate(gate: number, glide: Glide, dt: number): number {
  const step = Math.max(0, dt) / ECHO_GATE_S;
  if (glide.to.ea === 0) return glide.progress >= 1 ? 0 : Math.max(0, gate - step);
  if (glide.progress < 1 && glide.from.ea === 0) return 0;
  return Math.min(1, gate + step);
}

/** The gate for a camera the view starts on: closed on a camera without a ripple, open otherwise. */
export function initialEchoGate(glide: Glide): number {
  return glide.to.ea === 0 ? 0 : 1;
}

/**
 * Ripple options for the camera now, or null (nothing drawn, so pixels match a frame
 * without a ripple). Opacity is the preset's `ea` scaled by the fade and by loudness
 * (0 to 1, bass weighted): `ea * fade * level`. Zero loudness shows no ripple.
 * `fade` carries the camera gate too (`stepEchoGate`).
 */
export function echoOptions(camera: CameraPreset, fade: number, loud: number, t: number): HorizonEcho | null {
  if (fade <= 0.001) return null;
  const level = Math.min(1, Math.max(0, loud));
  const a = camera.ea * fade * level;
  if (a <= 0.005) return null;
  return { n: Math.max(1, Math.round(camera.en)), amp: camera.eamp, a, t, cx: camera.ecx, hs: ECHO_HALF_SPAN };
}
