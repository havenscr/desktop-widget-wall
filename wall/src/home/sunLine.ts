import { sunTimes } from '../ribbon/sun';

/** "Sunset in N min" shows from this long before sunset. */
export const SUNSET_SOON_MIN = 90;
const DAY_MS = 86_400_000;

export interface SunLine {
  /** The small capitals line. */
  key: string;
  /** The sentence under it. */
  text: string;
  /** Amber key: sunset is close. */
  soon: boolean;
}

/** 4:40 PM */
export function clockText(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const toMinute = (ms: number) => Math.round(ms / 60_000) * 60_000;

/** "3 h 12 min", "45 min" */
function span(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * The left wing's sun block, from the horizon's own sun. Within 90 minutes before sunset:
 * "Sunset in N min" in amber. Earlier in the day: the sunset time and the daylight left.
 * Before sunrise: the sunrise time. After sunset: tonight's sunset and tomorrow's sunrise.
 * Null on a day the sun neither rises nor sets.
 */
export function sunLine(now: number): SunLine | null {
  const times = sunTimes(now);
  if (times.rise === null || times.set === null) return null;
  // Shown to the minute, so round to the nearest one ("in 1 min" never pairs with a time already past).
  const rise = toMinute(times.rise);
  const set = toMinute(times.set);
  if (now < rise) {
    return { key: `Sunrise at ${clockText(rise)}`, text: `Sunset at ${clockText(set)}, ${span(set - rise)} of daylight`, soon: false };
  }
  if (now < set) {
    const left = set - now;
    const mins = Math.ceil(left / 60_000);
    if (mins <= SUNSET_SOON_MIN) {
      return { key: `Sunset in ${mins} min`, text: `The sun goes down at ${clockText(set)}`, soon: true };
    }
    return { key: `Sunset at ${clockText(set)}`, text: `${span(left)} of daylight left`, soon: false };
  }
  const tomorrow = sunTimes(now + DAY_MS).rise;
  const next = tomorrow === null ? null : toMinute(tomorrow);
  return {
    key: `Sunset, ${clockText(set)}`,
    text: next === null ? 'The sun is down' : `Sunrise at ${clockText(next)} tomorrow`,
    soon: false,
  };
}
