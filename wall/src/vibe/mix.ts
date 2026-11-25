import type { VibeSettings } from '../horizon/vibeSettings';

/**
 * The vibe effects' mix, with no drawing. One call per frame turns the settings, the slow energy
 * and the drop stamps into the strengths the layers draw with. The effects run on Listen and
 * Watch alike; this module does not know which screen it is on.
 *
 * Not pure: `stepVibe`, `settleVibe` and `noteDrop` mutate the `VibeState` (and, for `stepVibe`,
 * the `VibeFrame`) they are given, so nothing allocates per frame. The caller owns that state and
 * that frame. Stepping advances the eases, so never call `stepVibe` for a preview or a peek: use
 * a state of its own, or read the last frame.
 *
 * Hard rule: nothing ends abruptly. Every strength is a two stage exponential ease (a toggle's
 * per frame change stays small from the first frame to the last, and lands exactly on 0 or 1),
 * and every drop envelope starts and ends at 0 along a smooth step.
 */

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
/** Smooth step from 0 at `a` to 1 at `b`. */
export const sstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Time constant of each of the two ease stages for a toggle or a cover change, seconds. */
export const EASE_TAU_S = 0.28;
/** Same for the music stopping or starting: everything is at 0 about 2.5 seconds after the sound ends. */
export const LIVE_TAU_S = 0.3;
/** The palette position follows the (already slow) energy over this, seconds. */
export const PALETTE_TAU_S = 0.5;
/** Longest step a frame may advance, seconds (a stalled frame must not jump). */
export const MAX_DT_S = 1 / 20;
const SNAP = 0.002;

/** A drop's tail: 50 ms in, then (1 - s/0.95)^2 out. */
export const DROP_S = 0.95;
/** Seconds between glitch slice steps. */
export const STEP_S = 1 / 13;

/** The glitch envelope for `s` seconds since a drop: 0 before and after, 50 ms rise, eased tail. */
export const envOf = (s: number): number => (s >= 0 && s < DROP_S ? sstep(0, 0.05, s) * Math.pow(1 - s / DROP_S, 2) : 0);
/** Below this the swell tail counts as finished (about 2.6 s after a drop) and is exactly 0. */
export const SWELL_EPS = 0.002;
/** The glow swell for `s` seconds since a drop: 70 ms rise, exp(-s / 0.42), exactly 0 once under `SWELL_EPS`. */
export const swellOf = (s: number): number => {
  if (!(s >= 0)) return 0;
  const v = sstep(0, 0.07, s) * Math.exp(-s / 0.42);
  return v < SWELL_EPS ? 0 : v;
};

/** Drop stamps kept. A new drop past this replaces the one contributing least, so the envelope never cuts. */
export const MAX_DROPS = 8;

interface Ease2 {
  a: number;
  b: number;
}

function ease1(cur: number, target: number, dt: number, tau: number): number {
  const next = cur + (target - cur) * (1 - Math.exp(-dt / tau));
  return Math.abs(target - next) < SNAP ? target : next;
}
function ease2(e: Ease2, target: number, dt: number, tau: number): number {
  e.a = ease1(e.a, target, dt, tau);
  e.b = ease1(e.b, e.a, dt, tau);
  return e.b;
}

export interface VibeState {
  auto: Ease2;
  tape: Ease2;
  glitch: Ease2;
  calm: Ease2;
  /** 1 while the title is kept clear of the effects (Cover: Scene only). */
  title: Ease2;
  /** 1 while music plays; eases to 0 after it stops. */
  live: Ease2;
  palette: number;
  /** Frame clock seconds of each live drop; -Infinity marks a free slot. Fixed size, never reallocated. */
  drops: Float64Array;
}

const ease0 = (v = 0): Ease2 => ({ a: v, b: v });

/** The state at rest: the settings' defaults, as if just started with no music. */
export function createVibeState(): VibeState {
  return {
    auto: ease0(), tape: ease0(), glitch: ease0(), calm: ease0(), title: ease0(), live: ease0(),
    palette: 0, drops: new Float64Array(MAX_DROPS).fill(-Infinity),
  };
}

/** Put every level at its target at once (a first frame; tests). */
export function settleVibe(s: VibeState, settings: VibeSettings, playing: boolean, energy: number): void {
  const t = targets(settings, playing);
  s.auto = ease0(t.auto);
  s.tape = ease0(t.tape);
  s.glitch = ease0(t.glitch);
  s.calm = ease0(t.calm);
  s.title = ease0(t.title);
  s.live = ease0(t.live);
  s.palette = clamp01(energy);
  s.drops.fill(-Infinity);
}

const contribution = (at: number, nowS: number): number => Math.max(envOf(nowS - at), swellOf(nowS - at));

/**
 * A drop at `nowS`. Earlier drops keep fading, so drops overlap their tails and nothing cuts. It
 * takes a free slot, or when all are in use the one contributing least right now (a finished
 * tail first), which can only change the envelope by that smallest amount.
 */
export function noteDrop(s: VibeState, nowS: number): void {
  let slot = 0;
  let least = Infinity;
  for (let i = 0; i < s.drops.length; i++) {
    const c = s.drops[i] === -Infinity ? -1 : contribution(s.drops[i], nowS);
    if (c < least) {
      least = c;
      slot = i;
    }
  }
  s.drops[slot] = nowS;
}

// One scratch object, rewritten by each call: the frame path allocates nothing.
const T = { auto: 0, tape: 0, glitch: 0, calm: 0, title: 0, live: 0 };

function targets(settings: VibeSettings, playing: boolean): typeof T {
  T.auto = settings.auto ? 1 : 0;
  T.tape = settings.tapeGrain ? 1 : 0;
  // Vote 3A: the manual switch, or Auto vibe, lets a drop glitch.
  T.glitch = settings.dropGlitch || settings.auto ? 1 : 0;
  T.calm = settings.calmCap ? 1 : 0;
  T.title = settings.cover === 'scene' ? 1 : 0;
  T.live = playing ? 1 : 0;
  return T;
}

/** What the layers draw with this frame. Written in place by `stepVibe`; strengths are 0 to about 1.2. */
export interface VibeFrame {
  /** Aurora veil strength and how rich (many ribbons) it is. */
  aurora: number;
  rich: number;
  /** Bass glow strength, and the swell added to it by a drop. */
  halo: number;
  haloSwell: number;
  /** Tape strength, and the grain amount inside it. */
  tape: number;
  grain: number;
  /** Glitch strength; multiply by `envOf` of each drop stamp's age. 0 under Calm cap. */
  glitch: number;
  /** Drop envelope and swell, the larger of the two newest drops. */
  env: number;
  swell: number;
  /** Cool (0, quiet) to warm (1, loud). */
  palette: number;
  /** 1 while the title block is protected from the effects. */
  titleCover: number;
  /** Calm cap's gain on the kick and the bass the glow reads. */
  kickGain: number;
  bassGain: number;
  /** Music present, 0 to 1; every strength already includes it. Zero means nothing to draw. */
  live: number;
  /** True while any effect is above 0 or a drop is still fading: the loop needs to run. */
  active: boolean;
}

export function createVibeFrame(): VibeFrame {
  return {
    aurora: 0, rich: 0, halo: 0, haloSwell: 0, tape: 0, grain: 0, glitch: 0, env: 0, swell: 0,
    palette: 0, titleCover: 0, kickGain: 1, bassGain: 1, live: 0, active: false,
  };
}

export interface VibeInput {
  settings: VibeSettings;
  /** Music is arriving (`useAudioStore.playing`). */
  playing: boolean;
  /** Slow energy, 0 to 1 (`audioEnergy()`). */
  energy: number;
}

/**
 * Advance `s` by `dt` seconds at frame time `nowS` and write the frame's strengths to `out`. No
 * allocation. The mix table is the proof of concept's: with Auto vibe on, one energy number sets
 * the mix; off, every effect sits at a fixed level.
 */
export function stepVibe(s: VibeState, out: VibeFrame, dt: number, nowS: number, input: VibeInput): VibeFrame {
  const d = Number.isFinite(dt) ? Math.min(MAX_DT_S, Math.max(0, dt)) : 0;
  const t = targets(input.settings, input.playing);
  const au = ease2(s.auto, t.auto, d, EASE_TAU_S);
  const tape = ease2(s.tape, t.tape, d, EASE_TAU_S);
  const glitch = ease2(s.glitch, t.glitch, d, EASE_TAU_S);
  const calm = ease2(s.calm, t.calm, d, EASE_TAU_S);
  const title = ease2(s.title, t.title, d, EASE_TAU_S);
  const live = ease2(s.live, t.live, d, LIVE_TAU_S);
  s.palette = ease1(s.palette, clamp01(input.energy), d, PALETTE_TAU_S);

  const e = clamp01(input.energy);
  const quiet = 1 - e;
  const fx = 1 - au;
  const cap = 1 - 0.5 * calm;
  const mAurora = au * (0.24 + 0.76 * Math.pow(quiet, 0.8)) + fx * 0.7;
  const mRich = au * sstep(0.25, 0.9, quiet) + fx * 0.45;
  const mHalo = au * (0.32 + 0.68 * e) + fx * 0.7;
  const mTape = au * (0.5 + 0.3 * e) + fx * 0.7;
  const mGrain = au * (1 - 0.62 * e) + fx * 0.7;

  let env = 0;
  let swell = 0;
  for (let i = 0; i < s.drops.length; i++) {
    const age = nowS - s.drops[i];
    const ev = envOf(age);
    const sv = swellOf(age);
    if (ev > env) env = ev;
    if (sv > swell) swell = sv;
  }

  out.aurora = live * mAurora * cap * (1 + 0.18 * swell * cap);
  out.rich = live * mRich;
  out.halo = live * mHalo * cap;
  out.haloSwell = live * swell * cap;
  out.tape = live * tape * mTape * cap;
  out.grain = mGrain;
  // Calm cap removes the glitch (it fades out with the level); the swell above is what a drop shows.
  out.glitch = live * glitch * (1 - calm);
  out.env = env;
  out.swell = swell;
  out.palette = s.palette;
  out.titleCover = title;
  out.kickGain = cap;
  out.bassGain = 1 - 0.25 * calm;
  out.live = live;
  out.active =
    live > 0 || au !== t.auto || tape !== t.tape || glitch !== t.glitch || calm !== t.calm || title !== t.title || env > 0 || swell > 0;
  return out;
}
