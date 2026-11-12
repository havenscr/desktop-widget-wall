import type { CameraPreset, Glide } from './cameras';
import { spec, type HorizonEcho } from './renderer';
import { sampleBands } from '../audio/spectrum';

/** Seconds the ripple takes to fade in or out. */
export const ECHO_FADE_S = 1;
/** Half width of the ripple in design pixels (the demo's value). */
export const ECHO_HALF_SPAN = 900;
/** Seconds the ripple takes to ramp out at the start of a turn to a camera without one, and back in after the turn away settles. */
export const ECHO_GATE_S = 0.6;
/** Line count from which a camera is the full visualizer (Unwind's 11; Work and Home have 3). */
export const VISUALIZER_EN = 8;
/** The idle lines on the visualizer while silent: opacity and height as shares of `ea` and `eamp`. */
export const IDLE_ALPHA = 0.45;
export const IDLE_AMP = 0.35;
/**
 * How fast the idle lines drift and breathe, as a share of the playing speed: the renderer's
 * drift is 0.3, so 0.4 of it is the 0.12 the program names, and `spec()` runs at 0.4 of its time.
 */
export const IDLE_RATE = 0.4;

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

/**
 * How much a camera is the visualizer, 0 to 1: 0 for Work and Home (3 lines), 1 from
 * `VISUALIZER_EN` lines (Unwind). Glides blend `en`, so the idle lines and the loudness rule
 * ease in and out on the way to and from Unwind instead of switching at one frame.
 */
export function visualizerWeight(camera: CameraPreset): number {
  return clamp01((camera.en - 3) / (VISUALIZER_EN - 3));
}

/**
 * Speed of the echo's own clock against real time: 1 while playing; on the visualizer camera
 * `IDLE_RATE` while silent, eased by the fade. The renderer's drift and its `spec()` both run on
 * this clock, so slowing it never makes the lines jump (changing `speed` would).
 */
export function echoRate(camera: CameraPreset, fade: number): number {
  const k = visualizerWeight(camera);
  return 1 + k * (IDLE_RATE + (1 - IDLE_RATE) * clamp01(fade) - 1);
}

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
 * Ripple options for the camera now, or null (nothing drawn, so pixels match a frame without a
 * ripple). `fade` (0 to 1) follows `playing`, `loud` is the bass weighted loudness, `t` the echo
 * clock (`echoRate`) and `gate` the camera gate (`stepEchoGate`) times anything else that should
 * take the ripple away (an idle display).
 *
 * - Work and Home (3 lines): `ea * fade * loud`, so zero loudness or silence shows nothing.
 * - Unwind (11 lines) while playing: `ea * fade`, with no loudness scaling; the real bands carry
 *   the dynamics (`createEchoSampler`).
 * - Unwind while silent: the idle lines, `ea * 0.45` high `eamp * 0.35`, on the slowed clock.
 *
 * Between the two (a fade, or a glide that blends `en`) every number is blended, never switched.
 */
export function echoOptions(camera: CameraPreset, fade: number, loud: number, t: number, gate = 1): HorizonEcho | null {
  const g = clamp01(gate);
  if (g <= 0.001) return null;
  const k = visualizerWeight(camera);
  const f = clamp01(fade);
  const level = clamp01(loud);
  const a = camera.ea * g * (f * (level + (1 - level) * k) + k * (1 - f) * IDLE_ALPHA);
  if (a <= 0.005) return null;
  const amp = camera.eamp * (1 + k * (IDLE_AMP + (1 - IDLE_AMP) * f - 1));
  return { n: Math.max(1, Math.round(camera.en)), amp, a, t, cx: camera.ecx, hs: ECHO_HALF_SPAN };
}

/**
 * The `sample` function handed to the renderer while music plays (or fades out), and the two
 * numbers it reads, set each frame before drawing: `t`, the echo clock passed as the echo's `t`,
 * and `w`, the play fade. A line at `tau` reads the band history `t - tau` seconds back
 * (`sampleBands`); while `w` is under 1 the made-up `spec()` the idle lines use is mixed in by
 * `1 - w`, so starting and stopping music morphs the lines rather than snapping them. Made once;
 * nothing is allocated per call.
 */
export interface EchoSampler {
  t: number;
  w: number;
  readonly sample: (u: number, tau: number) => number;
}

export function createEchoSampler(
  bands: (u: number, age: number) => number = sampleBands,
  idle: (u: number, tau: number) => number = spec,
): EchoSampler {
  const s: EchoSampler = {
    t: 0,
    w: 0,
    sample: (u, tau) => {
      const b = bands(u, s.t - tau);
      return s.w >= 1 ? b : s.w * b + (1 - s.w) * idle(u, tau);
    },
  };
  return s;
}
