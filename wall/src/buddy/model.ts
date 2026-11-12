import { CINEMATIC_SECONDS, HOME_MORNING, cameraFor, glideSeconds, localDay, type CameraPreset } from '../horizon/cameras';
import { rowEdges } from '../screens/frameLayout';
import type { PlaceId } from '../state/places';
import { SPRITES, type Pose } from './sprites';

/** The places Watt lives on. Zen has none (Dream draws its own sleeping Watt); On air has none. */
export type WattPlace = 'work' | 'home' | 'meet' | 'unwind';

/** Where Watt walks on one place, in design pixels on the stage. */
export interface Walk {
  /** Left edge range of the sheep. */
  min: number;
  max: number;
  /** Size of one sprite pixel (the concept draws Watt larger as the camera closes in). */
  px: number;
  /** Highest stage y any part of Watt reaches, notes and z's included. */
  ceiling: number;
}

/** Bottom of the top band (stage y 510): on places with a ribbon, nothing of Watt goes above it. */
const TOP_BAND_BOTTOM = rowEdges()[0].bottom;

/**
 * Walk range per place. Work and Meet sit around the concept's (985, 534) at 4 px a pixel, Home
 * around (1616, 528) at 5 px between the wings, Unwind keeps today's 960 to 1220 at 6 px. The
 * ground line is the camera's `hy` (see `groundFor`). `model.test.ts` checks every range against
 * the frame's panel rectangles.
 */
export const WALKS: Readonly<Record<WattPlace, Walk>> = {
  work: { min: 880, max: 1090, px: 4, ceiling: TOP_BAND_BOTTOM },
  meet: { min: 880, max: 1090, px: 4, ceiling: TOP_BAND_BOTTOM },
  home: { min: 1506, max: 1726, px: 5, ceiling: TOP_BAND_BOTTOM },
  unwind: { min: 960, max: 1220, px: 6, ceiling: 380 },
};

/** Walking speed in design pixels a second (today's Unwind pace). */
export const WALK_SPEED = 14;

/**
 * The wander: stops as fractions of the walk range, and the seconds Watt stands at each before
 * walking slowly on to the next. Starts standing in the middle. One loop is several minutes.
 */
export const STOPS: readonly number[] = [0.5, 0.2, 0.65, 0.35, 0.9, 0.55, 0.1, 0.8];
export const IDLES: readonly number[] = [26, 34, 20, 40, 28, 32, 22, 38];

/** Minutes after midnight when Watt falls asleep (9:30 PM) and wakes (6:30 AM). */
export const SLEEP_FROM = 21 * 60 + 30;
export const WAKE_AT = 6 * 60 + 30;

/** True between 9:30 PM and 6:30 AM local time. */
export function isNight(date: Date): boolean {
  const m = date.getHours() * 60 + date.getMinutes();
  return m >= SLEEP_FROM || m < WAKE_AT;
}

/** Middle of a walk range: where Watt sleeps and where the still pose stands. */
export function middle(walk: Walk): number {
  return (walk.min + walk.max) / 2;
}

/** Seconds one full loop of the wander takes on `walk`. */
export function loopSeconds(walk: Walk): number {
  const span = walk.max - walk.min;
  let total = 0;
  for (let i = 0; i < STOPS.length; i++) {
    total += IDLES[i] + (Math.abs(STOPS[(i + 1) % STOPS.length] - STOPS[i]) * span) / WALK_SPEED;
  }
  return total;
}

/**
 * Where Watt is `t` seconds after arriving on a place: standing a long while at each stop, then
 * walking slowly to the next. `dir` is the way it faces (it keeps facing the way it last walked).
 */
export function wanderAt(walk: Walk, t: number): { x: number; dir: 1 | -1; moving: boolean } {
  const span = walk.max - walk.min;
  const n = STOPS.length;
  let left = Math.max(0, t) % loopSeconds(walk);
  for (let i = 0; i < n; i++) {
    const from = STOPS[i];
    const to = STOPS[(i + 1) % n];
    const prev = STOPS[(i + n - 1) % n];
    const x0 = walk.min + from * span;
    if (left < IDLES[i]) return { x: x0, dir: from >= prev ? 1 : -1, moving: false };
    left -= IDLES[i];
    const walkS = (Math.abs(to - from) * span) / WALK_SPEED;
    const dir = to >= from ? 1 : -1;
    if (left < walkS) return { x: x0 + dir * left * WALK_SPEED, dir, moving: true };
    left -= walkS;
  }
  return { x: walk.min + STOPS[0] * span, dir: 1, moving: false };
}

export interface BuddyFrame {
  x: number;
  dir: 1 | -1;
  pose: Pose;
  /** Little music notes drift up. */
  notes: boolean;
  /** Sleeping z's drift up. */
  z: boolean;
}

/**
 * What Watt does on `walk` at local time `date`, `t` seconds after arriving, with music `playing`.
 * Asleep in the middle at night (z's, no notes); awake otherwise, wandering, with notes while music
 * plays. With `still` (reduced motion) a fixed pose in the middle, nothing drifting.
 */
export function buddyFrame(walk: Walk, date: Date, t: number, playing: boolean, still = false): BuddyFrame {
  const night = isNight(date);
  const mid = middle(walk);
  if (still) return { x: mid, dir: 1, pose: night ? 'sleep' : 'idle', notes: false, z: false };
  if (night) return { x: mid, dir: 1, pose: 'sleep', notes: false, z: true };
  const w = wanderAt(walk, t);
  const pose: Pose = w.moving && Math.floor(t * 5) % 2 ? 'walk' : 'idle';
  return { x: w.x, dir: w.dir, pose, notes: playing, z: false };
}

/** Width and height of a pose at `px`, design pixels. */
export function spriteSize(pose: Pose, px: number): { w: number; h: number } {
  const map = SPRITES[pose];
  return { w: map[0].length * px, h: map.length * px };
}

/** Note icon sizes, the larger then the smaller, design pixels. */
export const NOTE_SIZES = [20, 15] as const;

/**
 * Where a drifting note (`i` 0 or 1) or z sits at drift phase `k` (0 to 1), for a sheep with its
 * top left at (`x`, `y`) and width `w`. Offsets scale with the sprite (Unwind's 6 px is today's
 * look); the rise stops at the walk's ceiling, so on the band places the notes drift beside the
 * head as in the concept rather than up into the panels.
 */
export function driftAt(kind: 'note' | 'z', walk: Walk, x: number, y: number, w: number, i: number, k: number): { left: number; top: number } {
  const s = walk.px / 6;
  const start = kind === 'note' ? y - 6 * s : y - 14 * s;
  const rise = Math.max(0, Math.min((kind === 'note' ? 44 : 46) * s, start - walk.ceiling));
  const left = kind === 'note' ? x + w + 4 * s + k * 30 * s + i * 10 * s : x + w - 4 * s + k * 26 * s;
  return { left, top: Math.max(walk.ceiling, start - k * rise) };
}

/** Where Watt stands: a place and the camera the horizon is pointed at there. */
export interface Spot {
  place: WattPlace;
  camera: CameraPreset;
}

/** True when `place` is one Watt lives on. */
export function isWattPlace(place: string): place is WattPlace {
  return Object.prototype.hasOwnProperty.call(WALKS, place);
}

/**
 * Where Watt should be on `place` at `ms`, or null where it does not show: Zen, any place without
 * a walk, and Meet while a call is on.
 */
export function spotFor(place: PlaceId, ms: number, inCall = false): Spot | null {
  if (!isWattPlace(place) || (place === 'meet' && inCall)) return null;
  return { place, camera: cameraFor(place, ms) };
}

/** Ground line (stage y of Watt's feet) at a spot: the camera's horizon. */
export function groundFor(spot: Spot): number {
  return spot.camera.hy;
}

function sameSpot(a: Spot | null, b: Spot | null): boolean {
  return a === b || (!!a && !!b && a.place === b.place && a.camera === b.camera);
}

/** Seconds Watt takes to fade out before a move, and to fade in at the new spot. */
export const FADE_OUT_S = 0.6;
export const FADE_IN_S = 0.9;

/**
 * Watt's presence: where it is drawn, how visible, and where it is going. A change of place (or
 * of Home's camera with the hour) fades it out where it stands; it reappears at the new spot only
 * once the horizon's camera has settled there, so it never walks across the screen and is never
 * up during the morning turn to Rainier.
 */
export interface Presence {
  /** The spot Watt is drawn at, or null when it is away. */
  at: Spot | null;
  /** 0 to 1. */
  opacity: number;
  /** The spot it is heading for. */
  target: Spot | null;
  /** Seconds until the camera settles on `target`. */
  wait: number;
  /** The camera the horizon is pointed at (the horizon keeps it while Zen is up). */
  camera: CameraPreset | null;
  /** Local day the cinematic morning turn was used up (the horizon's own rule, mirrored). */
  cinematicDay: string | null;
  /** True while the camera is playing the cinematic turn. */
  cinematic: boolean;
  /** Seconds since Watt arrived at `at`; the wander starts over on every arrival. */
  since: number;
}

export function initialPresence(want: Spot | null): Presence {
  return { at: want, opacity: want ? 1 : 0, target: want, wait: 0, camera: want?.camera ?? null, cinematicDay: null, cinematic: false, since: 0 };
}

/**
 * How long the horizon takes to move from `from` to `to`, mirroring `HorizonCanvas`: nothing for
 * the same camera, the cinematic 4.6 s for the first turn to Rainier on a local day, otherwise
 * the glide or swing length.
 */
export function settleSeconds(from: CameraPreset | null, to: CameraPreset, cinematic: boolean): number {
  if (!from || from === to) return 0;
  return cinematic ? CINEMATIC_SECONDS : glideSeconds(from, to);
}

/**
 * Advance the presence by `dt` seconds toward `want` (the spot for the current place and time).
 * `ms` is the wall clock (for the cinematic day). `instant` (reduced motion) jumps straight there,
 * as the horizon does.
 */
export function stepPresence(p: Presence, want: Spot | null, dt: number, ms: number, instant = false): Presence {
  let next = p;
  if (!sameSpot(want, p.target)) {
    let { camera, cinematicDay } = next;
    let wait = 0;
    let cinematic = false;
    if (want) {
      cinematic = !instant && want.camera === HOME_MORNING && camera !== null && camera !== HOME_MORNING && cinematicDay !== localDay(ms);
      wait = instant ? 0 : settleSeconds(camera, want.camera, cinematic);
      camera = want.camera;
    }
    next = { ...next, target: want, wait, camera, cinematicDay, cinematic };
  }
  if (instant) {
    const moved = !sameSpot(next.at, next.target);
    return { ...next, at: next.target, opacity: next.target ? 1 : 0, wait: 0, since: moved ? 0 : next.since + dt };
  }
  if (!sameSpot(next.at, next.target)) {
    const opacity = Math.max(0, next.opacity - dt / FADE_OUT_S);
    const wait = Math.max(0, next.wait - dt);
    // The horizon uses up the day's cinematic turn once it is past half-way.
    let { cinematicDay, cinematic } = next;
    if (cinematic && wait <= CINEMATIC_SECONDS / 2) {
      cinematicDay = localDay(ms);
      cinematic = false;
    }
    if (opacity === 0 && wait === 0) return { ...next, at: next.target, opacity: 0, wait: 0, cinematicDay, cinematic, since: 0 };
    return { ...next, opacity, wait, cinematicDay, cinematic };
  }
  if (!next.at) return next;
  return { ...next, opacity: Math.min(1, next.opacity + dt / FADE_IN_S), since: next.since + dt };
}
