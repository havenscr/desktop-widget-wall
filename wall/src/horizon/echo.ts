import type { CameraPreset, Glide } from './cameras';
import { spec, type HorizonEcho } from './renderer';
import { BAND_FLOOR, sampleBands } from '../audio/spectrum';
import { REST_LOOKS, type RestLook } from './renderer';

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
/**
 * The visualizer's playing look (Unwind while music plays), to match the concept frame: opacity
 * raised from `ea` (0.9) by `PLAY_BOOST` to full, wider strokes, and the lines tinted bright teal
 * through the centre shifting to pink at the far right. Eased in with the play fade, so the idle
 * lines keep the palette's own colour.
 */
export const PLAY_BOOST = 1 / 0.9;
export const PLAY_TINT = { left: [92, 196, 255], centre: [56, 236, 240], right: [255, 61, 154], width: 1.5 };

/**
 * The resting look of the ridgelines when music is not driving them (one named setting, from the
 * concept page the owner votes on): `contours` (smaller copies of the range's outline, foot to
 * ridge), `levels` (flat, slightly bowed level lines inside the mountain; the top one follows the
 * ridge), `haze` (the outlines of farther ranges behind the main one, each fainter) or `ridge`
 * (every line folded onto the ridge as one soft glowing outline, two faint lines under it).
 */
export const REST_LOOK: RestLook = 'contours';
/** The resting opacity of the lines (0 to 1): "very faded, but still present". */
export const REST_OPACITY = 0.22;
/** Seconds the lines take to settle into their resting look once music stops driving them. */
export const REST_SETTLE_S = 2.5;
/** Seconds the lines take to lift from rest into the live shape once music drives them again. */
export const REST_RISE_S = 1.5;
/** Seconds the band levels must stay under the floor (`BAND_FLOOR`) before the lines settle. */
export const REST_QUIET_S = 1.5;
/** The drift phase the lines rest at: line j at (j + 0.5) / n, so none sits on either end. */
export const REST_PHASE = 0.5;
/** The renderer's drift speed while playing, in line spacings a second (its default `speed`). */
export const DRIFT_SPEED = 0.3;
export { REST_LOOKS, type RestLook };

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
 * The camera gate on the ripple: `value` 0 to 1, multiplied into the ripple's opacity, and `shut`,
 * true once the gate has closed for a camera without a ripple (`ea` 0, Rainier in the morning).
 */
export interface EchoGate {
  value: number;
  shut: boolean;
}

/**
 * Advance the camera gate by `dt` seconds and return its value.
 *
 * - A move that ends on a camera with `ea` 0 ramps the gate down from the frame the move starts,
 *   by `dt / ECHO_GATE_S` a frame, so it reaches exactly 0 within `ECHO_GATE_S` (0.6 s) of the
 *   start and is shut from then on (a fade rather than a cut, so the lines never pop off).
 * - Once shut it stays at 0 through any later move (back toward a camera with a ripple, or a turn
 *   reversed half way) until a move settles on a camera whose ripple is on; only then does it
 *   ramp back in over `ECHO_GATE_S`. A move that starts on a camera with `ea` 0 is shut too.
 * - Every other move leaves it at (or ramps it up to) 1.
 *
 * Multiply the value into the opacity passed to `echoOptions`; the canvas also holds the drawn
 * opacity from rising during a move toward such a camera, so it only ever falls there.
 */
export function stepEchoGate(g: EchoGate, glide: Glide, dt: number): number {
  const step = Math.max(0, dt) / ECHO_GATE_S;
  if (glide.to.ea === 0) {
    g.value = glide.progress >= 1 ? 0 : g.value - step;
    // A hair over zero after summing frame steps still counts as closed.
    if (g.value <= 1e-6) {
      g.value = 0;
      g.shut = true;
    }
  } else if (glide.progress < 1 && (g.shut || glide.from.ea === 0)) {
    g.value = 0;
    g.shut = true;
  } else {
    g.shut = false;
    g.value = Math.min(1, g.value + step);
  }
  return g.value;
}

/** The gate for a camera the view starts on: shut on a camera without a ripple, open otherwise. */
export function initialEchoGate(glide: Glide): EchoGate {
  const off = glide.to.ea === 0;
  return { value: off ? 0 : 1, shut: off };
}

/**
 * Ripple options for the camera now, or null (nothing drawn, so pixels match a frame without a
 * ripple). `fade` (0 to 1) follows `playing`, `loud` is the bass weighted loudness, `t` the echo
 * clock (`echoRate`) and `gate` the camera gate (`stepEchoGate`) times anything else that should
 * take the ripple away (an idle display).
 *
 * - Work and Home (3 lines): `ea * fade * loud`, so zero loudness or silence shows nothing.
 * - Unwind (11 lines) while playing: `ea * fade` raised to full by `PLAY_BOOST`, with no loudness
 *   scaling (the real bands carry the dynamics, `createEchoSampler`), and the `PLAY_TINT` colours
 *   and width eased in by the fade.
 * - Unwind while silent: the idle lines, `ea * 0.45` high `eamp * 0.35`, on the slowed clock.
 *
 * Between the two (a fade, or a glide that blends `en`) every number is blended, never switched.
 */
export function echoOptions(
  camera: CameraPreset,
  fade: number,
  loud: number,
  t: number,
  gate = 1,
  rest = 0,
  look: RestLook = REST_LOOK,
  restOpacity = REST_OPACITY,
): HorizonEcho | null {
  const g = clamp01(gate);
  if (g <= 0.001) return null;
  const k = visualizerWeight(camera);
  const f = clamp01(fade);
  const level = clamp01(loud);
  const r = clamp01(rest);
  const playing = f * (level + (1 - level) * k) * (1 + k * (PLAY_BOOST - 1));
  const a = Math.min(1, camera.ea * g * (playing + k * (1 - f) * IDLE_ALPHA));
  // The resting lines show on every camera that has a ripple (`ea` above 0), at the one resting opacity.
  const restA = camera.ea > 0 ? Math.min(1, clamp01(restOpacity) * g) : 0;
  if (a <= 0.005 && (r <= 0 || restA <= 0.005)) return null;
  const amp = camera.eamp * (1 + k * (IDLE_AMP + (1 - IDLE_AMP) * f - 1));
  const e: HorizonEcho = { n: Math.max(1, Math.round(camera.en)), amp, a, t, cx: camera.ecx, hs: ECHO_HALF_SPAN };
  if (k * f > 0) e.tint = { ...PLAY_TINT, k: k * f };
  if (r > 0) {
    e.rest = r;
    e.restA = restA;
    e.look = look;
  }
  return e;
}

/** How strongly an echo is drawn: its live opacity eased toward its resting one by how far it has settled. */
export function echoStrength(e: HorizonEcho): number {
  return e.rest ? e.a + ((e.restA ?? 0) - e.a) * e.rest : e.a;
}

/** Scale an echo's live and resting opacity by `s` (0 to 1), in place. */
export function scaleEcho(e: HorizonEcho, s: number): void {
  e.a *= s;
  if (e.restA !== undefined) e.restA *= s;
}

/**
 * The ridgelines' motion between playing and rest, stepped in place once a frame (nothing is
 * allocated). `rest` runs 0 (music driving the lines) to 1 (settled), linearly in time: up over
 * `REST_SETTLE_S`, down over `REST_RISE_S`; the renderer eases each line from it, the far lines a
 * touch later. `drift` is the lines' drift phase (0 to 1, the renderer's `fq`): while playing it
 * moves at `DRIFT_SPEED`; on a settle it eases (a cubic that starts at the current speed and ends
 * still) forward onto `REST_PHASE`, which it reaches exactly as `rest` reaches 1; on a lift it
 * speeds back up from where it rests to `DRIFT_SPEED` as `rest` falls to 0. The rest of the fields
 * are the stepper's own.
 */
export interface EchoMotion {
  rest: number;
  drift: number;
  /** Drift speed now, line spacings a second. */
  v: number;
  /** Seconds the bands have been under the floor. */
  quiet: number;
  driving: boolean;
  /** Where the current settle or lift started: `rest`, phase and speed then, and the target phase. */
  r0: number;
  from: number;
  v0: number;
  to: number;
}

/** A motion at rest (nothing has played yet), or driving at full speed. */
export function createEchoMotion(atRest = true): EchoMotion {
  return atRest
    ? { rest: 1, drift: REST_PHASE, v: 0, quiet: 0, driving: false, r0: 1, from: REST_PHASE, v0: 0, to: REST_PHASE }
    : { rest: 0, drift: 0, v: DRIFT_SPEED, quiet: 0, driving: true, r0: 0, from: 0, v0: DRIFT_SPEED, to: 0 };
}

/** Jump to rest at once (the page was hidden: it returns to still lines, never a settle from stale ones). */
export function restEchoMotion(m: EchoMotion): void {
  m.rest = 1;
  m.drift = REST_PHASE;
  m.v = 0;
  m.quiet = 0;
  m.driving = false;
  m.r0 = 1;
  m.from = m.to = REST_PHASE;
  m.v0 = 0;
}

/**
 * Whether music drives the lines this frame: `playing`, and the loudest band has not been under
 * `BAND_FLOOR` (where it adds no height) for `REST_QUIET_S`. Advances `m.quiet`.
 */
export function musicDriving(m: EchoMotion, playing: boolean, bands: ArrayLike<number>, dt: number): boolean {
  let top = 0;
  for (let i = 0; i < bands.length; i++) if (bands[i] > top) top = bands[i];
  m.quiet = playing && top < BAND_FLOOR ? m.quiet + Math.max(0, dt) : 0;
  return playing && m.quiet < REST_QUIET_S;
}

const fr1 = (x: number) => x - Math.floor(x);
/** The fastest a settle may move the lines on average, line spacings a second (twice the playing drift). */
const SETTLE_MAX_SPEED = 2 * DRIFT_SPEED;

/** Advance the motion by `dt` seconds with music driving the lines (`driving`) or not. */
export function stepEchoMotion(m: EchoMotion, driving: boolean, dt: number): void {
  const d = Math.max(0, dt);
  if (driving) {
    if (!m.driving) {
      m.driving = true;
      m.r0 = m.rest;
      m.v0 = m.v;
    }
    if (m.rest > 0) {
      m.rest = m.rest - d / REST_RISE_S;
      if (m.rest < 1e-9) m.rest = 0; // a sum of frame steps lands a hair off zero
      const s = m.r0 > 0 ? 1 - m.rest / m.r0 : 1;
      m.v = m.v0 + (DRIFT_SPEED - m.v0) * s;
    } else m.v = DRIFT_SPEED;
    m.drift = fr1(m.drift + m.v * d);
    return;
  }
  if (m.driving) {
    m.driving = false;
    m.r0 = m.rest;
    m.from = fr1(m.drift);
    m.v0 = m.v;
    // The target: the first resting phase far enough ahead that the cubic never runs backward
    // (its start speed times the time left, over 3, at most the distance).
    const T = (1 - m.r0) * REST_SETTLE_S;
    let to = REST_PHASE;
    while (to < m.from + (m.v0 * T) / 3) to += 1;
    // A settle that starts late in a lift has little time left: rather than race a whole spacing
    // ahead, it eases back to the resting phase behind (the lines barely left it).
    if (to - m.from > T * SETTLE_MAX_SPEED && to - 1 >= m.from - 0.5) to -= 1;
    m.to = to;
  }
  if (m.rest >= 1) {
    m.rest = 1;
    m.drift = REST_PHASE;
    m.v = 0;
    return;
  }
  m.rest = m.rest + d / REST_SETTLE_S;
  if (m.rest >= 1 - 1e-9) {
    m.rest = 1;
    m.drift = REST_PHASE;
    m.v = 0;
    return;
  }
  const T = (1 - m.r0) * REST_SETTLE_S;
  const s = (m.rest - m.r0) / (1 - m.r0);
  const D = m.to - m.from;
  const vT = m.v0 * T;
  // Cubic Hermite from (0, speed v0) to (D, speed 0).
  const p = (s * s * s - 2 * s * s + s) * vT + (3 * s * s - 2 * s * s * s) * D;
  m.drift = fr1(m.from + p);
  m.v = ((3 * s * s - 4 * s + 1) * vT + (6 * s - 6 * s * s) * D) / T;
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
