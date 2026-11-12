import type { CameraPlace } from '../state/places';

/**
 * One camera framing of the west view. The first six keys feed the renderer; `ecx`,
 * `eamp`, `ea` and `en` shape the music ripple (centre, height, opacity at full
 * loudness, line count) and are used only while music plays.
 */
export interface CameraPreset {
  /** Compass azimuth in degrees at the left edge. */
  az0: number;
  /** Pixels per degree of azimuth (zoom). */
  ppd: number;
  /** Horizon line, design pixels from the top. */
  hy: number;
  /** Vertical exaggeration of the terrain. */
  vex: number;
  /** City size multiplier. */
  cs: number;
  /** Vanishing point x of the lake grid. */
  vx: number;
  /** Music ripple centre x. */
  ecx: number;
  /** Music ripple amplitude. */
  eamp: number;
  /** Music ripple opacity at full loudness, 0 to 1. */
  ea: number;
  /** Music ripple line count (rounded when drawn; it is blended during a glide). */
  en: number;
}

/** Moon centre x, centre y and radius, design pixels. Drawn on the Unwind camera only. */
export const MOON: readonly [number, number, number] = [1730, 112, 44];

/** Seconds a camera takes to glide to another place's framing. */
export const GLIDE_SECONDS = 1.6;

const WIDE: CameraPreset = { az0: 221.5, ppd: 34, hy: 582, vex: 1.25, cs: 1.25, vx: 1280, ecx: 1900, eamp: 8, ea: 0.3, en: 3 };

/** Framing per place: Work looks wide, Home closes in on the city, Unwind swings to the Olympics. */
export const CAMERAS: Readonly<Record<CameraPlace, CameraPreset>> = {
  work: { ...WIDE },
  home: { az0: 218.1, ppd: 54, hy: 582, vex: 1.3, cs: 1, vx: 1280, ecx: 2300, eamp: 6, ea: 0.22, en: 3 },
  unwind: { az0: 246, ppd: 49.2, hy: 505, vex: 2.5, cs: 1, vx: 1330, ecx: 1330, eamp: 34, ea: 0.9, en: 11 },
};

/** Cubic ease in and out, 0 to 1. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Camera between `from` (t = 0) and `to` (t = 1), eased. Every numeric key is interpolated. */
export function blendCamera<T extends object>(from: T, to: T, t: number): T {
  const k = ease(Math.min(1, Math.max(0, t)));
  const out: Record<string, number> = {};
  for (const key of Object.keys(to) as (keyof T & string)[]) {
    const a = from[key];
    const b = to[key];
    if (typeof a === 'number' && typeof b === 'number') out[key] = k >= 1 ? b : a + (b - a) * k; // exact at the ends, whatever the rounding
  }
  return out as T;
}

/** A glide in progress: `progress` runs 0 to 1 linearly; easing is applied when blending. */
export interface Glide {
  from: CameraPreset;
  to: CameraPreset;
  progress: number;
}

/** Glide with nothing left to do, sitting on `camera`. */
export function settled(camera: CameraPreset): Glide {
  return { from: camera, to: camera, progress: 1 };
}

/** Where the camera is now. */
export function glideCamera(g: Glide): CameraPreset {
  return g.progress >= 1 ? g.to : blendCamera(g.from, g.to, g.progress);
}

/** Start a glide from wherever the camera is now; `instant` jumps straight to the target. */
export function startGlide(g: Glide, target: CameraPreset, instant: boolean): Glide {
  return instant ? settled(target) : { from: glideCamera(g), to: target, progress: 0 };
}

/** Advance a glide by `dt` seconds. */
export function stepGlide(g: Glide, dt: number, seconds = GLIDE_SECONDS): Glide {
  return g.progress >= 1 ? g : { ...g, progress: Math.min(1, g.progress + dt / seconds) };
}
