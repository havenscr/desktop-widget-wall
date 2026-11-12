import { sun } from '../horizon/renderer';

/** Sunrise and sunset are when the sun's centre is 0.833 degrees below the horizon (refraction plus its radius). */
export const SUN_EDGE_DEG = -0.833;
const STEP_MS = 20 * 60_000;
const DAY_MS = 86_400_000;

export interface SunTimes {
  /** Epoch ms, or null on a day the sun does not rise or set. */
  rise: number | null;
  set: number | null;
}

/** Local midnight at the start of the day holding `ms`. */
export function localMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const height = (ms: number) => sun(ms).alt - SUN_EDGE_DEG;

/** Bisection between a and b, where `height` changes sign; good to well under a second. */
function crossing(a: number, b: number): number {
  let ha = height(a);
  for (let i = 0; i < 24; i++) {
    const mid = (a + b) / 2;
    const hm = height(mid);
    if (ha < 0 === hm < 0) {
      a = mid;
      ha = hm;
    } else {
      b = mid;
    }
  }
  return Math.round((a + b) / 2);
}

const cache = new Map<number, SunTimes>();

/**
 * Sunrise and sunset on the local day holding `ms`, at the horizon's own place (the
 * renderer's `sun()`). Scans the day in 20 minute steps for the sign changes, then
 * bisects each one. Cached per day.
 */
export function sunTimes(ms: number): SunTimes {
  const day = localMidnight(ms);
  const hit = cache.get(day);
  if (hit) return hit;
  const end = localMidnight(day + DAY_MS + 3 * 3_600_000); // the next midnight, DST safe
  let rise: number | null = null;
  let set: number | null = null;
  let t = day;
  let h = height(t);
  while (t < end && (rise === null || set === null)) {
    const n = Math.min(end, t + STEP_MS);
    const hn = height(n);
    if (h < 0 && hn >= 0 && rise === null) rise = crossing(t, n);
    if (h >= 0 && hn < 0 && set === null) set = crossing(t, n);
    t = n;
    h = hn;
  }
  const out = { rise, set };
  if (cache.size > 8) cache.clear();
  cache.set(day, out);
  return out;
}
