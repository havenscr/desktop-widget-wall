import { CAMERAS, homeCameraFor, type CameraPreset } from '../horizon/cameras';
import { MAIN_LEFT, ZONE_GAP, ZONES_WIDE, rowEdges } from '../screens/frameLayout';
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
  /** Furthest stage x any part of Watt reaches, notes and z's included. */
  right: number;
}

/** Bottom of the top band (stage y 510): on places with a ribbon, nothing of Watt goes above it. */
const TOP_BAND_BOTTOM = rowEdges()[0].bottom;

/**
 * Unwind's transport and volume row (`.u-transport` in `styles/unwind.css`), stage pixels at 2560
 * by 720. It starts at the centre zone's left edge (the frame constants); its top and bottom come
 * from the flow layout and were measured in the Unwind still (y 384 to 472, the row box running
 * to the player's right edge at x 1402). Watt stays left of it with a small gap.
 */
export const UNWIND_ROW = { left: MAIN_LEFT + ZONES_WIDE[0] + ZONE_GAP, right: 1402, top: 384, bottom: 472 } as const;

/**
 * Walk range per place. Work and Meet sit around the concept's (985, 534) at 4 px a pixel, Home
 * around (1616, 528) at 5 px between the wings, Unwind at the concept's spot in `f_unwind` (the
 * body between about x 430 and 580, below the wind down block and left of the transport row) at
 * 6 px. The ground line is the camera's `hy`. `model.test.ts` checks every range against the
 * frame's panel rectangles and Unwind's transport row.
 */
export const WALKS: Readonly<Record<WattPlace, Walk>> = {
  work: { min: 880, max: 1090, px: 4, ceiling: TOP_BAND_BOTTOM, right: 1820 },
  meet: { min: 880, max: 1090, px: 4, ceiling: TOP_BAND_BOTTOM, right: 1820 },
  home: { min: 1506, max: 1726, px: 5, ceiling: TOP_BAND_BOTTOM, right: 1930 },
  unwind: { min: 430, max: 470, px: 6, ceiling: 420, right: UNWIND_ROW.left - 8 },
};

/** Walking speed in design pixels a second. */
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

/**
 * What the wall clock means for Watt, worked out once a minute (night, and Home's camera), so the
 * frame loop builds no `Date`. Reused: `readClock` updates it in place.
 */
export interface ClockInfo {
  /** Epoch minute it was last worked out for. */
  minute: number;
  night: boolean;
  /** Home's camera at that minute (Rainier in the morning). */
  home: CameraPreset;
}

export function createClock(): ClockInfo {
  return { minute: Number.NaN, night: false, home: CAMERAS.home };
}

/** Bring `clock` up to `ms` (epoch milliseconds). Builds a `Date` only when the minute changes. */
export function readClock(clock: ClockInfo, ms: number): ClockInfo {
  const minute = Math.floor(ms / 60_000);
  if (minute !== clock.minute) {
    const d = new Date(ms);
    clock.minute = minute;
    clock.night = isNight(d);
    clock.home = homeCameraFor(d);
  }
  return clock;
}

/** True when `place` is one Watt lives on. */
export function isWattPlace(place: string): place is WattPlace {
  return Object.prototype.hasOwnProperty.call(WALKS, place);
}

/** The place Watt should be on, or null where it does not show: Zen, places without a walk, Meet in a call. */
export function wattPlaceFor(place: PlaceId, inCall = false): WattPlace | null {
  if (!isWattPlace(place) || (place === 'meet' && inCall)) return null;
  return place;
}

/** The camera a Watt place uses at the clock's minute. Only Home changes with the hour. */
export function cameraOf(place: WattPlace, clock: ClockInfo): CameraPreset {
  return place === 'home' ? clock.home : CAMERAS[place];
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

/** Where Watt is in its wander. Reused. */
export interface WanderPoint {
  x: number;
  dir: 1 | -1;
  moving: boolean;
}

export function createWander(): WanderPoint {
  return { x: 0, dir: 1, moving: false };
}

/**
 * Where Watt is `t` seconds after arriving on a place: standing a long while at each stop, then
 * walking slowly to the next. `dir` is the way it faces (it keeps facing the way it last walked).
 * Written into `out`.
 */
export function wanderAt(walk: Walk, t: number, out: WanderPoint = createWander()): WanderPoint {
  const span = walk.max - walk.min;
  const n = STOPS.length;
  let left = Math.max(0, t) % loopSeconds(walk);
  for (let i = 0; i < n; i++) {
    const from = STOPS[i];
    const to = STOPS[(i + 1) % n];
    const prev = STOPS[(i + n - 1) % n];
    const x0 = walk.min + from * span;
    if (left < IDLES[i]) {
      out.x = x0;
      out.dir = from >= prev ? 1 : -1;
      out.moving = false;
      return out;
    }
    left -= IDLES[i];
    const walkS = (Math.abs(to - from) * span) / WALK_SPEED;
    const dir = to >= from ? 1 : -1;
    if (left < walkS) {
      out.x = x0 + dir * left * WALK_SPEED;
      out.dir = dir;
      out.moving = true;
      return out;
    }
    left -= walkS;
  }
  out.x = walk.min + STOPS[0] * span;
  out.dir = 1;
  out.moving = false;
  return out;
}

/** What Watt does this frame. Reused. */
export interface BuddyFrame {
  x: number;
  dir: 1 | -1;
  pose: Pose;
  /** Little music notes drift up. */
  notes: boolean;
  /** Sleeping z's drift up. */
  z: boolean;
}

export function createFrame(): BuddyFrame {
  return { x: 0, dir: 1, pose: 'idle', notes: false, z: false };
}

const scratchWander = createWander();

/**
 * What Watt does on `walk`, at `night` or not, `t` seconds after arriving, with music `playing`.
 * Asleep in the middle at night (z's, no notes); awake otherwise, wandering, with notes while music
 * plays. With `still` (reduced motion) a fixed pose in the middle, nothing drifting. Written into `out`.
 */
export function buddyFrame(walk: Walk, night: boolean, t: number, playing: boolean, still = false, out: BuddyFrame = createFrame()): BuddyFrame {
  out.notes = false;
  out.z = false;
  out.dir = 1;
  out.x = middle(walk);
  if (still) {
    out.pose = night ? 'sleep' : 'idle';
    return out;
  }
  if (night) {
    out.pose = 'sleep';
    out.z = true;
    return out;
  }
  const w = wanderAt(walk, t, scratchWander);
  out.x = w.x;
  out.dir = w.dir;
  out.pose = w.moving && Math.floor(t * 5) % 2 ? 'walk' : 'idle';
  out.notes = playing;
  return out;
}

/** Width of a pose at `px`, design pixels. */
export function spriteWidth(pose: Pose, px: number): number {
  return SPRITES[pose][0].length * px;
}

/** Height of a pose at `px`, design pixels. */
export function spriteHeight(pose: Pose, px: number): number {
  return SPRITES[pose].length * px;
}

/** Note icon sizes, the larger then the smaller, and the larger z's width, design pixels. */
export const NOTE_SIZES = [20, 15] as const;
export const Z_WIDTH = 22;

/** Where a drifting note or z sits. Reused. */
export interface DriftPoint {
  left: number;
  top: number;
}

export function createDrift(): DriftPoint {
  return { left: 0, top: 0 };
}

/**
 * Where a drifting note (`i` 0 or 1) or z sits at drift phase `k` (0 to 1), for a sheep with its
 * top left at (`x`, `y`) and width `w`. Offsets scale with the sprite; the rise stops at the walk's
 * ceiling and the sideways drift at its right limit, so the notes drift beside the head as in the
 * concept rather than into a panel. Written into `out`.
 */
export function driftAt(kind: 'note' | 'z', walk: Walk, x: number, y: number, w: number, i: number, k: number, out: DriftPoint = createDrift()): DriftPoint {
  const s = walk.px / 6;
  const start = kind === 'note' ? y - 6 * s : y - 14 * s;
  const rise = Math.max(0, Math.min((kind === 'note' ? 44 : 46) * s, start - walk.ceiling));
  const left = kind === 'note' ? x + w + 4 * s + k * 30 * s + i * 10 * s : x + w - 4 * s + k * 26 * s;
  const size = kind === 'note' ? NOTE_SIZES[i === 0 ? 0 : 1] : Z_WIDTH;
  out.left = Math.min(left, walk.right - size);
  out.top = Math.max(walk.ceiling, start - k * rise);
  return out;
}

/** Seconds Watt takes to fade out before a move, and to fade in where it lands. */
export const FADE_OUT_S = 0.6;
export const FADE_IN_S = 0.9;

/**
 * Watt's presence: where it is drawn and how visible. Reused: `stepPresence` changes it in place.
 * It is only up while the horizon's camera is settled on Watt's place; any change (place, Home's
 * camera with the hour, night and day) fades it out where it stands, moves it while unseen, and
 * fades it in, so it never walks across the screen and is never up during a camera move.
 */
export interface Presence {
  /** The place Watt is drawn on, or null when it is away. */
  place: WattPlace | null;
  /** The camera it is standing under. */
  camera: CameraPreset | null;
  /** Asleep (night) or awake. */
  night: boolean;
  /** 0 to 1. */
  opacity: number;
  /** Seconds since Watt arrived; the wander starts over on every arrival. */
  since: number;
}

/** Away and unseen; the first step puts it where it belongs. */
export function createPresence(): Presence {
  return { place: null, camera: null, night: false, opacity: 0, since: 0 };
}

/**
 * True when Watt may be up on `place` under `camera`: the horizon is not moving and is pointed at
 * that camera (so before the horizon has turned at 5:00 or 11:30, or while it glides, it is not).
 */
export function cameraReady(place: WattPlace | null, camera: CameraPreset | null, signal: { readonly to: CameraPreset | null; readonly moving: boolean }): boolean {
  return place !== null && !signal.moving && signal.to === camera;
}

/**
 * Advance `p` by `dt` seconds toward `place` under `camera` at `night`, when `ready` (see
 * `cameraReady`); away otherwise. `instant` (reduced motion) jumps there, as the horizon does.
 * Changes `p` in place and returns it.
 */
export function stepPresence(p: Presence, place: WattPlace | null, camera: CameraPreset | null, night: boolean, ready: boolean, dt: number, instant = false): Presence {
  const wantPlace = ready ? place : null;
  const wantCamera = wantPlace ? camera : null;
  const same = p.place === wantPlace && p.camera === wantCamera && (wantPlace === null || p.night === night);
  if (!same) {
    p.opacity = instant ? 0 : Math.max(0, p.opacity - dt / FADE_OUT_S);
    if (p.opacity > 0) return p;
    p.place = wantPlace;
    p.camera = wantCamera;
    p.night = night;
    p.since = 0;
    if (instant && wantPlace) p.opacity = 1;
    return p;
  }
  if (!p.place) return p;
  p.opacity = instant ? 1 : Math.min(1, p.opacity + dt / FADE_IN_S);
  p.since += dt;
  return p;
}

/**
 * True when Watt is away and unseen, and either has nowhere to go or is waiting for a camera that
 * is not ready: the frame loop can stop (a place, call or camera change wakes it).
 */
export function isIdle(p: Presence, place: WattPlace | null, ready: boolean): boolean {
  return p.place === null && p.opacity === 0 && (place === null || !ready);
}
