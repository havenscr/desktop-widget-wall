import type { Follow, LightSyncSettings, LightsUi } from './model';

/**
 * The Lights tab's preview: the same maths as the native frame (`engine.rs`) for the settings that show on screen,
 * so a change reads before you look up. One tick in, one frame out; the caller owns the clock and the sound.
 */
export interface PreviewState {
  bassEnv: number;
  highEnv: number;
  kickAgeMs: number;
  colourPos: number;
  beats: number;
  /** The beat count last seen, to spot a new beat. */
  seen: number;
}

export interface PreviewFrame {
  /** Brightness 0 to 1 of each Play, left to right (four). */
  plays: number[];
  /** Brightness of each of the five panel triangles. */
  panels: number[];
  /** Palette index the Plays show; panel `i` shows `colour + i`. */
  colour: number;
}

export const KICK_FLASH_MS = 220;
const LEVEL_LO = 0.2;
const LEVEL_SPAN = 0.7;

export const newPreview = (floor: number, beatCount = 0): PreviewState => ({ bassEnv: floor, highEnv: floor, kickAgeMs: Infinity, colourPos: 0, beats: 0, seen: beatCount });

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const follow = (env: number, target: number, dt: number, attack: number, release: number) => env + (target - env) * (1 - Math.exp(-dt / (target > env ? attack : release)));

/** What a light follows. "Both" is the mean of the two envelopes, as the engine takes it. */
export function bandLevel(f: Follow, bass: number, high: number): number {
  return f === 'bass' ? bass : f === 'highs' ? high : (bass + high) / 2;
}

export function stepPreview(st: PreviewState, s: LightSyncSettings, ui: LightsUi, colours: number, input: { bass: number; high: number; beatCount: number; dtMs: number }): PreviewFrame {
  const dt = Number.isFinite(input.dtMs) ? Math.min(500, Math.max(0, input.dtMs)) : 0;
  const target = (level: number) => s.floor + (s.brightness - s.floor) * clamp01((clamp01(level) - LEVEL_LO) / LEVEL_SPAN);
  st.bassEnv = follow(st.bassEnv, target(input.bass), dt, s.attackMs, s.releaseMs);
  st.highEnv = follow(st.highEnv, target(input.high), dt, s.attackMs, s.releaseMs);
  if (input.beatCount > st.seen) {
    st.kickAgeMs = 0;
    if (s.beatStep) {
      st.beats += input.beatCount - st.seen;
      const every = Math.round(ui.colourBars * 4);
      if (st.beats >= every) {
        st.beats = 0;
        st.colourPos = (st.colourPos + 1) % Math.max(1, colours);
      }
    }
  }
  st.seen = input.beatCount;
  const kick = st.kickAgeMs < KICK_FLASH_MS ? (1 - st.kickAgeMs / KICK_FLASH_MS) * s.kickFlash : 0;
  const lift = (env: number, k: number) => Math.min(1, env + k * (1 - env));
  const plays = [0, 1, 2, 3].map((i) => {
    const inner = i === 1 || i === 2;
    return lift(bandLevel(ui.follow[i], st.bassEnv, st.highEnv), kick * (inner ? 1 : 0.5));
  });
  const env = bandLevel(ui.follow[4], st.bassEnv, st.highEnv);
  const front = st.kickAgeMs < s.rippleMs ? st.kickAgeMs / s.rippleMs : null;
  const panels = [0, 1, 2, 3, 4].map((i) => {
    const d = Math.abs(i - 2) / 2;
    const ring = ui.ripple ? (front === null ? 0 : Math.exp(-(((d - front) / 0.2) ** 2)) * s.kickFlash) : kick;
    return lift(env, ring);
  });
  if (Number.isFinite(st.kickAgeMs)) st.kickAgeMs += dt;
  return { plays, panels, colour: st.colourPos };
}
