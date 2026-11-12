import type { Pose } from './sprites';

/** Left edge x range Watt walks between, design pixels, on the stage. */
export const WALK_MIN = 960;
export const WALK_MAX = 1220;
/** Walking speed in design pixels a second. */
export const WALK_SPEED = 14;

/** Minutes after midnight when Watt falls asleep (9:30 PM) and wakes (6:30 AM). */
export const SLEEP_FROM = 21 * 60 + 30;
export const WAKE_AT = 6 * 60 + 30;

/** True between 9:30 PM and 6:30 AM local time. */
export function isNight(date: Date): boolean {
  const m = date.getHours() * 60 + date.getMinutes();
  return m >= SLEEP_FROM || m < WAKE_AT;
}

/** Position and direction of a slow bounce between the walk limits after `t` seconds. */
export function walkAt(t: number): { x: number; dir: 1 | -1 } {
  const range = WALK_MAX - WALK_MIN;
  const p = (Math.max(0, t) * WALK_SPEED) % (2 * range);
  return p < range ? { x: WALK_MIN + p, dir: 1 } : { x: WALK_MAX - (p - range), dir: -1 };
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
 * What Watt does at local time `date`, `t` seconds into the animation, with music `playing`.
 * Asleep at night (z's, no notes); awake otherwise, walking, with notes while music plays.
 * With `still` (reduced motion) a fixed pose in the middle of the walk, nothing drifting.
 */
export function buddyFrame(date: Date, t: number, playing: boolean, still = false): BuddyFrame {
  const night = isNight(date);
  if (still) {
    return { x: (WALK_MIN + WALK_MAX) / 2, dir: 1, pose: night ? 'sleep' : 'idle', notes: false, z: false };
  }
  if (night) return { x: (WALK_MIN + WALK_MAX) / 2, dir: 1, pose: 'sleep', notes: false, z: true };
  const w = walkAt(t);
  return { x: w.x, dir: w.dir, pose: Math.floor(t * 5) % 2 ? 'walk' : 'idle', notes: playing, z: false };
}
