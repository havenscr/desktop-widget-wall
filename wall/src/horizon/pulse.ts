import type { HorizonGrid } from './renderer';

/** Seconds a glow band takes to roll from the horizon to the bottom edge. */
export const WAVE_LIFE_S = 1.2;
/** Glow bands alive at once; a new beat takes the oldest slot when all are busy. */
export const WAVE_SLOTS = 4;
/** Peak opacity of a glow band at full strength (`gp` 1, Unwind). */
export const WAVE_ALPHA = 0.42;
/** Fraction of a band's life spent fading in. */
const FADE_IN = 0.12;
/** Fraction of a band's life after which it fades out. */
const FADE_OUT = 0.7;
/** Depth eases out over the band's life (`p = u^0.75`), so it leaves the horizon briskly and spends more of its life on the near floor. */
const DEPTH_EASE = 0.75;
/** Seconds the kick part of the line brightening takes to fall to about a third. */
export const KICK_DECAY_S = 0.28;
/** Share of the line brightening that follows the kick; the rest follows the plain bass level. */
const KICK_SHARE = 0.65;

/**
 * The grid pulse between frames: a fixed set of glow band slots (nothing is allocated per
 * frame) and the `grid` option object handed to the renderer, updated in place.
 */
export interface GridPulse {
  /** Seconds since each slot's beat; Infinity when the slot is free. */
  ages: Float64Array;
  /** The detector's beat count last seen. */
  seen: number;
  /** Kick brightness, 1 on a beat, decaying. */
  kick: number;
  /** The renderer option, reused every frame. */
  grid: HorizonGrid;
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function createGridPulse(): GridPulse {
  return {
    ages: new Float64Array(WAVE_SLOTS).fill(Infinity),
    seen: 0,
    kick: 0,
    grid: { bright: 0, waves: Array.from({ length: WAVE_SLOTS }, () => ({ p: 0, a: 0 })) },
  };
}

/** Free every slot and drop the brightness (music stopped, page hidden). Keeps `seen`. */
export function clearGridPulse(s: GridPulse): void {
  s.ages.fill(Infinity);
  s.kick = 0;
  s.grid.bright = 0;
  for (const w of s.grid.waves) {
    w.p = 0;
    w.a = 0;
  }
}

/**
 * Advance the pulse by `dt` seconds and return the `grid` option to draw, or null while no
 * music plays. A beat count above `seen` starts a band in a free slot (or the oldest), already
 * `lag` seconds old so it lines up with the kick's onset rather than its confirmation. Over
 * `WAVE_LIFE_S` a band's depth runs 0 to 1 as `u^0.75` of its age fraction `u` (the renderer's
 * perspective spacing still makes it speed up as it nears the viewer); its opacity eases in
 * over the first 12 percent of its life and out over the last 30, times `WAVE_ALPHA * gp`. The lines brighten with
 * `gp * (0.65 * kick + 0.35 * bass)`.
 */
export function stepGridPulse(
  s: GridPulse,
  dt: number,
  input: { playing: boolean; beats: number; lag: number; bass: number; gp: number },
): HorizonGrid | null {
  if (input.beats < s.seen) s.seen = input.beats; // the detector was reset
  if (!input.playing) {
    clearGridPulse(s);
    s.seen = input.beats;
    return null;
  }
  const step = Math.max(0, dt);
  for (let i = 0; i < WAVE_SLOTS; i++) s.ages[i] += step;
  if (input.beats > s.seen) {
    s.seen = input.beats;
    let slot = 0;
    for (let i = 1; i < WAVE_SLOTS; i++) if (s.ages[i] > s.ages[slot]) slot = i; // free slots are Infinity, so they win
    s.ages[slot] = Math.max(0, input.lag);
    s.kick = 1;
  } else {
    s.kick *= Math.exp(-step / KICK_DECAY_S);
  }
  const gp = Math.min(1, Math.max(0, input.gp));
  for (let i = 0; i < WAVE_SLOTS; i++) {
    const w = s.grid.waves[i];
    const p = s.ages[i] / WAVE_LIFE_S;
    if (p >= 1) {
      s.ages[i] = Infinity;
      w.p = 0;
      w.a = 0;
      continue;
    }
    w.p = Math.pow(p, DEPTH_EASE);
    w.a = WAVE_ALPHA * gp * smooth(p / FADE_IN) * (1 - smooth((p - FADE_OUT) / (1 - FADE_OUT)));
  }
  const bass = Math.min(1, Math.max(0, input.bass));
  s.grid.bright = gp * (KICK_SHARE * s.kick + (1 - KICK_SHARE) * bass);
  return s.grid;
}
