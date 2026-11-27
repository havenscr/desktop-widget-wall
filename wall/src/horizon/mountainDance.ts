import { MOUNTAIN_GAIN, type MountainLevel } from './vibeSettings';

/** Seconds the factor takes to settle after a change of level (about a second, with no jump). */
export const MOUNTAIN_EASE_S = 1;
/** The ease's time constant: the factor is within 1 percent of its target after `MOUNTAIN_EASE_S`. */
const TAU_S = MOUNTAIN_EASE_S / 5;
const SNAP = 0.002;

/** The factor a level gives the mountain lines' dance height: Off 0, Low 0.5, Medium 1, High 1.5. */
export const mountainGain = (level: MountainLevel): number => MOUNTAIN_GAIN[level];

/** The eased factor, moved `dt` seconds toward the level's own; it lands exactly on it once within `SNAP`. */
export function stepMountainGain(current: number, level: MountainLevel, dt: number): number {
  const target = MOUNTAIN_GAIN[level];
  if (!Number.isFinite(current)) return target;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / TAU_S));
  return Math.abs(target - next) < SNAP ? target : next;
}

/**
 * The echo's dance written in place: the ridge's amplitude times the factor, and the bump a drop gives the
 * lines (the swell) times the factor up to 1, so Off holds the lines in their shape and a drop moves nothing.
 */
export function applyMountainGain(echo: { amp: number; swell?: number }, gain: number): void {
  if (gain === 1) return;
  echo.amp *= gain;
  if (echo.swell !== undefined) echo.swell *= Math.min(1, gain);
}
