import type { CameraPlace } from '../state/places';
import { STAGE_WIDTH } from '../stage/fitScale';
import type { TerrainName } from './renderer';

/**
 * One camera framing of the panorama. The first six keys and `snowDeg` feed the renderer;
 * `ecx`, `eamp`, `ea` and `en` shape the music ripple (centre, height, opacity at full
 * loudness, line count) and `gp` sets the grid pulse strength; both are used only while music plays.
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
  /** Snow line in degrees before vex (0.84 on the west presets, 0.86 in the morning); blended during a glide. */
  snowDeg: number;
  /** Grid pulse strength, 0 to 1: scales the beat's glow bands and the bass brightening (subtle 0.5 on Work, Home and Rainier, full 1 on Unwind); blended during a glide. */
  gp: number;
  /** Which terrain the camera looks at; omitted means `'pano'`. */
  ter?: Terrain;
}

/** The terrain a camera looks at: the one panorama (azimuth 128 to 300), so every move is a glide. */
export type Terrain = TerrainName;

/**
 * The moon's candidate places, in order (centre x, centre y and radius, design pixels). Drawn on
 * the Unwind camera only, at the first place whose disc is at least 40 px clear of every picture
 * and every card a screen claims (`moonFor` in `sky.ts`); with none clear, no moon. Every place is
 * in open sky, wholly above the Unwind ridgeline (the drawn ranges' top under the disc, `ridgeTopY`)
 * and clear of the clock:
 * - 1890, 260: right of Listen's player, the place it has always had (ridge top 334 under it).
 * - 760, 352: low in the sky under the player's left half, right of Up next, for a layout whose
 *   right side is taken by a wide card. It sits 40 px or more under the player in every state
 *   (playing ends at y 251, nothing playing or the last track at y 265: 43 px) and rises just
 *   clear of the ranges (ridge top 401.5 under it, the disc's foot at 396). Between the player
 *   and the ridge there is no room for more: the ranges are lowest here (about x 720 to 800).
 * - 1450, 150: high in the middle of the sky, for a layout that takes both of those.
 */
export const MOON_PLACES: readonly (readonly [number, number, number])[] = [
  [1890, 260, 44],
  [760, 352, 44],
  [1450, 150, 44],
];

/** The moon's first place (see `MOON_PLACES`): where it sits when nothing on screen is in its way. */
export const MOON: readonly [number, number, number] = MOON_PLACES[0];

/** Seconds a camera takes to glide to another place's framing. */
export const GLIDE_SECONDS = 1.6;
/** Seconds a swing takes: a glide that turns the view more than `SWING_DEGREES` (Home's morning turn to Rainier and back). */
export const SWING_SECONDS = 3.2;
/** Azimuth change, in degrees at the left edge, above which a glide is a swing. */
export const SWING_DEGREES = 40;

/**
 * How long a glide between two place cameras takes: a swing for a big turn (any turn between a
 * west camera and the Rainier camera), the usual glide otherwise. Pass the logical ends (the
 * presets), never a half-way camera, so the length depends on the kind of move only.
 */
export function glideSeconds(from: CameraPreset, to: CameraPreset): number {
  return Math.abs(to.az0 - from.az0) > SWING_DEGREES ? SWING_SECONDS : GLIDE_SECONDS;
}

const WIDE: CameraPreset = { az0: 221.5, ppd: 34, hy: 582, vex: 1.25, cs: 1.25, vx: 1280, ecx: 1900, eamp: 8, ea: 0.3, en: 3, snowDeg: 0.84, gp: 0.5, ter: 'pano' };

/** Framing per place: Work looks wide, Home closes in on the city, Unwind swings to the Olympics. */
export const CAMERAS: Readonly<Record<CameraPlace, CameraPreset>> = {
  work: { ...WIDE },
  home: { az0: 218.1, ppd: 54, hy: 582, vex: 1.3, cs: 1, vx: 1280, ecx: 2300, eamp: 6, ea: 0.22, en: 3, snowDeg: 0.84, gp: 0.5, ter: 'pano' },
  meet: { ...WIDE },
  onair: { ...WIDE },
  unwind: { az0: 246, ppd: 49.2, hy: 505, vex: 2.5, cs: 1, vx: 1330, ecx: 1330, eamp: 34, ea: 0.9, en: 11, snowDeg: 0.84, gp: 1, ter: 'pano' },
};

/**
 * Home in the morning: the same panorama turned south to Mount Rainier at sunrise (the approved
 * concept's strip: azimuth 132 at the left edge, 42 px per degree, terrain exaggerated 1.9).
 * `hy` 582 is the Home horizon line, so Rainier (about 168 px tall at these values) peaks near
 * y 414, clear of the clock and the mood row. No ripple (ea 0): the echo is a filled copy of
 * the far ridge, which would draw a dark hump over Rainier. Reached by a swing, never a fade.
 */
export const HOME_MORNING: CameraPreset = { az0: 132, ppd: 42, hy: 582, vex: 1.9, cs: 1, vx: 1280, ecx: 2300, eamp: 6, ea: 0, en: 3, snowDeg: 0.86, gp: 0.5, ter: 'pano' };

/** Morning view runs from 5:00 AM to 11:30 AM local time, in minutes after midnight. */
export const MORNING_START_MIN = 5 * 60;
export const MORNING_END_MIN = 11 * 60 + 30;

/** Home's camera at a moment: Rainier from 5:00 AM up to 11:30 AM local time, the west Home view otherwise. */
export function homeCameraFor(date: Date): CameraPreset {
  const min = date.getHours() * 60 + date.getMinutes();
  return min >= MORNING_START_MIN && min < MORNING_END_MIN ? HOME_MORNING : CAMERAS.home;
}

/** The camera a place uses at a moment (epoch milliseconds). Only Home changes with the hour. */
export function cameraFor(place: CameraPlace, ms: number): CameraPreset {
  return place === 'home' ? homeCameraFor(new Date(ms)) : CAMERAS[place];
}

/** Clouds move at this fraction of the horizon's speed when the camera turns. */
export const CLOUD_PARALLAX = 0.35;

/**
 * Sideways cloud offset for a camera, in design pixels: `(221.5 - az0) * ppd * 0.35`. Zero on the
 * Work camera (the clouds sit where they always have); as the view turns, clouds slide the same
 * way as the land at about a third of its speed, so the move reads as a camera turning.
 */
export function cloudShiftFor(camera: CameraPreset): number {
  return (CAMERAS.work.az0 - camera.az0) * camera.ppd * CLOUD_PARALLAX;
}

/** Cubic ease in and out, 0 to 1. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Camera between `from` (t = 0) and `to` (t = 1), eased. Every numeric key is interpolated. */
export function blendCamera<T extends object>(from: T, to: T, t: number): T {
  return mixCamera(from, to, ease(Math.min(1, Math.max(0, t))));
}

/** Camera a fraction `k` (already eased) of the way from `from` to `to`; exact at k 1. */
function mixCamera<T extends object>(from: T, to: T, k: number): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(to) as (keyof T & string)[]) {
    const a = from[key];
    const b = to[key];
    if (typeof a === 'number' && typeof b === 'number') out[key] = k >= 1 ? b : a + (b - a) * k; // exact at the ends, whatever the rounding
  }
  // Non-numeric keys (the terrain) cannot be blended; the target's value holds, so a same-terrain glide keeps its terrain.
  for (const key of Object.keys(to) as (keyof T & string)[]) {
    if (typeof to[key] !== 'number') (out as Record<string, unknown>)[key] = to[key];
  }
  return out as T;
}

/** Seconds the cinematic turn to Rainier takes (the first turn of each morning). */
export const CINEMATIC_SECONDS = 4.6;
/** Pull-back at the middle of the cinematic turn, in pixels per degree taken off `ppd`. */
export const CINEMATIC_PULL_PPD = 10;
/** Lift at the middle of the cinematic turn, in design pixels added to `hy` (the horizon drops). */
export const CINEMATIC_DROP_HY = 14;
/** The panorama's usable azimuths: the left edge never goes below `PANO_MIN_AZ` and the right edge never past `PANO_MAX_AZ`. */
export const PANO_MIN_AZ = 128.3;
export const PANO_MAX_AZ = 299.8;

/**
 * The cinematic turn at `k` (0 to 1, linear in time). Every number blends with a sine ease,
 * `e = 0.5 - 0.5 cos(pi k)`; on top, the view pulls back (`ppd - 10 sin(pi k)`) and the horizon
 * drops (`hy + 14 sin(pi k)`), so it widens mid-turn and then pushes in on the mountain.
 * Clamped so the view stays on the panorama: `az0` at least 128.3 and `ppd` at least
 * `2560 / (299.8 - az0)`. Exactly `from` at 0 and `to` at 1.
 */
export function cinematicCamera(from: CameraPreset, to: CameraPreset, k: number): CameraPreset {
  if (k <= 0) return from;
  if (k >= 1) return to;
  const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
  const s = Math.sin(Math.PI * k);
  const cam = mixCamera(from, to, e);
  cam.ppd -= CINEMATIC_PULL_PPD * s;
  cam.hy += CINEMATIC_DROP_HY * s;
  cam.az0 = Math.max(cam.az0, PANO_MIN_AZ);
  cam.ppd = Math.max(cam.ppd, STAGE_WIDTH / (PANO_MAX_AZ - cam.az0));
  return cam;
}

/** The local calendar day of a moment, as `YYYY-M-D`; the cinematic turn plays once per day. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** A glide in progress: `progress` runs 0 to 1 linearly; easing is applied when blending. */
export interface Glide {
  from: CameraPreset;
  to: CameraPreset;
  progress: number;
  /** Seconds the whole glide takes (`glideSeconds` of its logical ends, or `CINEMATIC_SECONDS`). */
  seconds: number;
  /** True for the cinematic turn (`cinematicCamera`); a plain cubic glide otherwise. */
  cinematic?: boolean;
}

/** Glide with nothing left to do, sitting on `camera`. */
export function settled(camera: CameraPreset): Glide {
  return { from: camera, to: camera, progress: 1, seconds: GLIDE_SECONDS };
}

/** Where the camera is now. */
export function glideCamera(g: Glide): CameraPreset {
  if (g.progress >= 1) return g.to;
  return g.cinematic ? cinematicCamera(g.from, g.to, g.progress) : blendCamera(g.from, g.to, g.progress);
}

/**
 * Start a glide from wherever the camera is now; `instant` jumps straight to the target. A big
 * turn takes `SWING_SECONDS`; `cinematic` plays `cinematicCamera` over `CINEMATIC_SECONDS`.
 */
export function startGlide(g: Glide, target: CameraPreset, instant: boolean, cinematic = false): Glide {
  if (instant) return settled(target);
  const from = glideCamera(g);
  if (cinematic) return { from, to: target, progress: 0, seconds: CINEMATIC_SECONDS, cinematic: true };
  // The length comes from the move's logical ends (the camera it was heading to, and the new
  // target), not from where an interrupted move happens to be, so a turn back is always a swing.
  return { from, to: target, progress: 0, seconds: glideSeconds(g.to, target) };
}

/** Advance a glide by `dt` seconds, over the glide's own duration. */
export function stepGlide(g: Glide, dt: number): Glide {
  return g.progress >= 1 ? g : { ...g, progress: Math.min(1, g.progress + dt / g.seconds) };
}
