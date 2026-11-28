import { driftOf, type Follow, type LightSyncSettings, type LightsUi } from './model';

/**
 * The Lights tab's preview: the same maths as the native frame (`engine.rs`), colour included, so the strips show what
 * the Hue Plays and the panels do. One tick in, one frame out; the caller owns the clock and the sound.
 * `tests/fixtures/lightsync-frames.json` (under `src-tauri`) is read by this file's test and by the Rust test.
 */
export type Rgb = [number, number, number];

/** What the flash guard watches: luminance swings of 0.10 or more, at most 5 in a second (WCAG 2.3.1). Mirrors `engine.rs`. */
export const GUARD_DELTA = 0.1;
export const GUARD_WINDOW_MS = 1000;
export const GUARD_MAX_TRANSITIONS = 5;

/** Tracks one light's luminance swings; `limit` is the guard, `commit` records what was really shown. */
export class Swing {
  private extreme = 0;
  private dir = 0;
  private started = false;
  readonly times: number[] = [];

  private pop(now: number) {
    while (this.times.length && this.times[0] <= now - GUARD_WINDOW_MS) this.times.shift();
  }

  limit(now: number, y: number, max: number): number {
    this.pop(now);
    const along = (y - this.extreme) * this.dir;
    if (!this.started || this.dir === 0 || along >= 0 || -along < GUARD_DELTA || this.times.length < max) return y;
    return this.extreme - this.dir * (GUARD_DELTA - 0.01);
  }

  commit(now: number, y: number) {
    this.pop(now);
    if (!this.started) {
      this.started = true;
      this.extreme = y;
      return;
    }
    const d = y - this.extreme;
    if (this.dir === 0) {
      if (Math.abs(d) >= GUARD_DELTA) {
        this.dir = d > 0 ? 1 : -1;
        this.extreme = y;
        this.times.push(now);
      }
      return;
    }
    const along = d * this.dir;
    if (along >= 0) this.extreme = y;
    else if (-along >= GUARD_DELTA) {
      this.dir = -this.dir;
      this.extreme = y;
      this.times.push(now);
    }
  }

  get transitions() {
    return this.times.length;
  }
}

interface LightState {
  b: number;
  swing: Swing;
}

export interface PreviewState {
  bassEnv: number;
  highEnv: number;
  kickAgeMs: number;
  /** Palette position in colours; always moving. */
  pos: number;
  clockMs: number;
  /** Colours of beat nudge still to apply, spread over `NUDGE_MS`. */
  nudgeLeft: number;
  /** Running input level for Auto level, and the slow bass mean for the changing-bass term. */
  autoLevel: number;
  slowBass: number;
  recent: { dt: number; bass: number; high: number }[];
  plays: LightState[];
  panels: LightState[];
  /** The beat count last seen, to spot a new beat. */
  seen: number;
}

export interface PreviewFrame {
  /** The colour each Play shows, 0 to 1 per channel, left to right (four). */
  plays: Rgb[];
  /** The colour of each of the five panel triangles. */
  panels: Rgb[];
}

/** The palette the preview colours come from: hex colours and the kick colour. */
export interface PreviewPalette {
  colors: readonly string[];
  kick: string;
}

const FRAME_MS = 33;
/** A beat's palette nudge is spread over about this long. */
const NUDGE_MS = 200;
const LEVEL_LO = 0.2;
const LEVEL_SPAN = 0.7;
/** Auto level: the gain pulls the running level toward this; the running level follows 2 s up, 8 s down; the gain is clamped. Same numbers as `engine.rs`. */
export const AUTO_TARGET = 0.5;
export const AUTO_ATTACK_MS = 2000;
export const AUTO_RELEASE_MS = 8000;
export const AUTO_GAIN_MIN = 0.5;
export const AUTO_GAIN_MAX = 3;
/** The changing-bass term (bass against its 1.5 s mean, scaled and capped, added to the bass envelope target) and the ripple fade. */
export const SLOW_BASS_MS = 1500;
export const MOTION_GAIN = 6;
export const MOTION_DEPTH = 0.25;
export const RIPPLE_FALLOFF = 0.5;
/** A confirmed beat starts its pulse at the onset frame, never more than this far back. */
export const MAX_BACKDATE_MS = 150;

/** The gain Auto level applies this step; moves `st.autoLevel` toward the louder of the two inputs. */
export function autoGain(st: { autoLevel: number }, loud: number, dt: number): number {
  st.autoLevel += (loud - st.autoLevel) * (1 - Math.exp(-dt / (loud > st.autoLevel ? AUTO_ATTACK_MS : AUTO_RELEASE_MS)));
  return Math.min(AUTO_GAIN_MAX, Math.max(AUTO_GAIN_MIN, AUTO_TARGET / Math.max(1e-3, st.autoLevel)));
}

/** The bass envelope's extra target for a changing bass: positive on a rise above the slow mean, negative on a dip. */
export function bassMotion(st: { slowBass: number }, wb: number, dt: number): number {
  st.slowBass += (wb - st.slowBass) * (1 - Math.exp(-dt / SLOW_BASS_MS));
  return Math.min(1, Math.max(-1, (wb - st.slowBass) * MOTION_GAIN)) * MOTION_DEPTH;
}

const PLAYS = 4;
const PANELS = 5;

const light = (floor: number): LightState => ({ b: floor, swing: new Swing() });
export const newPreview = (floor: number, beatCount = 0): PreviewState => ({
  bassEnv: 0,
  highEnv: 0,
  kickAgeMs: Infinity,
  pos: 0,
  clockMs: 0,
  nudgeLeft: 0,
  autoLevel: AUTO_TARGET,
  slowBass: 0,
  recent: [],
  plays: Array.from({ length: PLAYS }, () => light(floor)),
  panels: Array.from({ length: PANELS }, () => light(floor)),
  seen: beatCount,
});

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const follow = (env: number, target: number, dt: number, attack: number, release: number) => env + (target - env) * (1 - Math.exp(-dt / (target > env ? attack : release)));
const hexRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};
const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** What a light follows. "Both" is the mean of the two envelopes, as the engine takes it. */
export function bandLevel(f: Follow, bass: number, high: number): number {
  return f === 'bass' ? bass : f === 'highs' ? high : (bass + high) / 2;
}

/** The 0 to 1 shape of one pulse `t` ms after its beat: a raised cosine rise, then an exponential fall. */
export function kickShape(t: number, rise: number, tau: number): number {
  if (!Number.isFinite(t) || t < 0 || t > rise + 5 * tau) return 0;
  return t < rise ? 0.5 - 0.5 * Math.cos((Math.PI * t) / rise) : Math.exp(-(t - rise) / tau);
}

/** The palette colour at position `p` (in colours): each colour holds through the outer 30 % of its slot and crossfades through the middle 30 %. */
export function paletteColour(colors: readonly Rgb[], p: number): Rgb {
  const n = colors.length;
  const q = Number.isFinite(p) ? ((p % n) + n) % n : 0;
  const a = Math.floor(q) % n;
  return mix(colors[a], colors[(a + 1) % n], smoothstep(0.35, 0.65, q - Math.floor(q)));
}

function lightFrame(st: PreviewState, s: LightSyncSettings, dt: number, ls: LightState, colour: Rgb, kick: Rgb, env: number, lift: number, steps: number): Rgb {
  const target = s.floor + (s.brightness - s.floor) * Math.min(1, Math.max(0, s.energyDepth * env + s.kickFlash * lift));
  const b = target < ls.b ? Math.max(target, ls.b - (s.slewDown * dt) / 1000) : target;
  ls.b = b;
  const out = mix(colour, kick, s.kickWhite * lift).map((v) => v * b) as Rgb;
  const y = lum(out);
  // The guard decides on the values that are sent: round first (255 steps for panels, 65535 for the Plays), then limit.
  const round = (c: Rgb) => c.map((v) => Math.round(v * steps) / steps) as Rgb;
  const cand = round(out.map(clamp01) as Rgb);
  const l0 = lum(cand);
  const held = ls.swing.limit(st.clockMs, l0, GUARD_MAX_TRANSITIONS);
  let shown = cand;
  if (held !== l0 && y > 1e-6) {
    // A held value sits 0.09 from the last extreme, so rounding cannot make it a swing. A held fall scales the colour up and a channel may clip: mix toward white by the missing luminance (exact, luminance is linear in the mix).
    let h = out.map((v) => clamp01(v * (held / y))) as Rgb;
    const l = lum(h);
    if (l < held && l < 1) h = mix(h, [1, 1, 1], (held - l) / (1 - l));
    shown = round(h);
  }
  ls.swing.commit(st.clockMs, lum(shown));
  return shown;
}

export function stepPreview(st: PreviewState, s: LightSyncSettings, ui: LightsUi, palette: PreviewPalette, input: { bass: number; high: number; beatCount: number; dtMs: number; beatLagMs?: number }): PreviewFrame {
  const dt = Number.isFinite(input.dtMs) ? Math.min(500, Math.max(0, input.dtMs)) : 0;
  const shaped = (level: number, gain: number) => clamp01(clamp01((clamp01(level) - LEVEL_LO) / LEVEL_SPAN) * gain);
  // The mean of the recent band levels over `levelWindow` frames, weighted by the time each lasted.
  let bassIn = clamp01(input.bass);
  let highIn = clamp01(input.high);
  if (ui.autoLevel === true) {
    const g = autoGain(st, Math.max(bassIn, highIn), dt);
    bassIn = clamp01(bassIn * g);
    highIn = clamp01(highIn * g);
  }
  st.recent.push({ dt: Math.max(1, dt), bass: bassIn, high: highIn });
  const span = s.levelWindow * FRAME_MS;
  let total = st.recent.reduce((t, r) => t + r.dt, 0);
  while (st.recent.length > 1 && total - st.recent[0].dt >= span) total -= st.recent.shift()!.dt;
  const wb = st.recent.reduce((t, r) => t + r.dt * r.bass, 0) / total;
  const wh = st.recent.reduce((t, r) => t + r.dt * r.high, 0) / total;
  st.bassEnv = follow(st.bassEnv, clamp01(shaped(wb, s.bassGain) + bassMotion(st, wb, dt)), dt, s.attackMs, s.releaseMs);
  st.highEnv = follow(st.highEnv, shaped(wh, s.highGain), dt, s.attackMs, s.releaseMs);
  st.clockMs += dt;

  const colours = palette.colors.map(hexRgb);
  const kick = hexRgb(palette.kick);
  if (input.beatCount > st.seen) {
    st.nudgeLeft += s.beatNudge;
    if (!(st.kickAgeMs < s.minPulseGapMs)) st.kickAgeMs = Number.isFinite(input.beatLagMs) ? Math.min(MAX_BACKDATE_MS, Math.max(0, input.beatLagMs as number)) : 0;
  }
  st.seen = input.beatCount;
  const take = Math.min(st.nudgeLeft, (s.beatNudge * dt) / NUDGE_MS);
  st.nudgeLeft -= take;
  st.pos = (((st.pos + take + dt / driftOf(ui.colourBars)) % colours.length) + colours.length) % colours.length;
  const pulse = kickShape(st.kickAgeMs, s.kickRiseMs, s.kickDecayMs);

  const plays = st.plays.map((ls, i) => {
    const inner = i === 1 || i === 2;
    const env = bandLevel(ui.follow[i], st.bassEnv, st.highEnv);
    return lightFrame(st, s, dt, ls, paletteColour(colours, st.pos + i * 0.25), kick, env, pulse * (inner ? 1 : 0.5), 65535);
  });
  const env = bandLevel(ui.follow[4], st.bassEnv, st.highEnv);
  const front = st.kickAgeMs < s.rippleMs ? st.kickAgeMs / s.rippleMs : null;
  const panels = st.panels.map((ls, i) => {
    const d = Math.abs(i - 2) / 2;
    const lift = ui.ripple ? (front === null ? 0 : Math.exp(-(((d - front) / 0.2) ** 2)) * (1 - RIPPLE_FALLOFF * front)) : pulse;
    return lightFrame(st, s, dt, ls, paletteColour(colours, st.pos + i / PANELS), kick, env, lift, 255);
  });
  if (Number.isFinite(st.kickAgeMs)) st.kickAgeMs += dt;
  return { plays, panels };
}
