import { tip } from '../ui/HoverTip';
import { clockText } from '../meet/model';
import { freshReading, WEATHER_UNAVAILABLE } from '../unwind/model';
import { WeatherIcon } from '../weather/WeatherIcon';
import { WEATHER_SOURCE_NAMES, staleText, weatherFailureText, type WeatherFailure, type WeatherReading } from '../weather/model';
import { useWeather } from '../weather/useWeather';

export interface OutsideView {
  /** "50°" with the reading's own words, "partly cloudy". */
  temp: number;
  look: string;
  icon: WeatherReading['look']['icon'];
  /** "56° / 44°", or "updated 23 min ago" once the reading is older than a normal refresh. */
  side: string;
  stale: boolean;
  tip: string;
}

export type OutsideState = { kind: 'loading' } | { kind: 'missing'; tip: string } | { kind: 'reading'; view: OutsideView };

interface Input {
  reading: WeatherReading | null;
  failed: boolean;
  failure?: WeatherFailure | null;
  attemptedAt?: number | null;
  nextTryAt?: number | null;
}

/**
 * The outside row's state from the weather hook's public shape. A reading under an hour old
 * shows (dimmed, with its age, when a normal refresh is overdue); no usable reading says so
 * once it is known to be missing, and says nothing while the first read is still out.
 */
export function outsideState(w: Input, now: number): OutsideState {
  const fresh = freshReading(w.reading, now);
  if (!fresh) {
    if (!w.failed && w.reading === null) return { kind: 'loading' };
    const tried = w.attemptedAt ? clockText(w.attemptedAt) : 'recently';
    return { kind: 'missing', tip: `${weatherFailureText(w.failure, w.nextTryAt)} Last tried ${tried}.` };
  }
  const age = staleText(fresh.fetchedAt, now);
  const from = fresh.source === 'nws' ? ` (from ${WEATHER_SOURCE_NAMES.nws}, while Open-Meteo is not answering)` : '';
  const failedNote = w.failed ? ` The last try failed: ${weatherFailureText(w.failure, w.nextTryAt)}` : '';
  return {
    kind: 'reading',
    view: {
      temp: fresh.temp,
      look: fresh.look.label.toLowerCase(),
      icon: fresh.look.icon,
      side: age ?? `${fresh.high}° / ${fresh.low}°`,
      stale: age !== null,
      tip: `Weather read at ${clockText(fresh.fetchedAt)}${from}. Today's high ${fresh.high}°, low ${fresh.low}°.${failedNote}`,
    },
  };
}

const WARM = new Set(['sun', 'cloud-sun']);

/** "50° outside, partly cloudy" with the day's high and low, from the reading the wall already has. */
export function OutsideRow({ now = Date.now }: { now?: () => number }) {
  const w = useWeather();
  const s = outsideState(w, now());
  if (s.kind === 'loading') return null;
  if (s.kind === 'missing') {
    return (
      <div className="lw-row outside missing" aria-label="Outside" {...tip(s.tip)}>
        <span className="lw-dim">{WEATHER_UNAVAILABLE}</span>
      </div>
    );
  }
  const v = s.view;
  return (
    <div className={v.stale ? 'lw-row outside stale' : 'lw-row outside'} aria-label="Outside" {...tip(v.tip)}>
      <span className={WARM.has(v.icon) ? 'lw-glyph warm' : 'lw-glyph night'}>
        <WeatherIcon name={v.icon} size={22} />
      </span>
      <span className="lw-text">
        <b>{v.temp}° outside</b>, {v.look}
      </span>
      <span className="lw-side">{v.side}</span>
    </div>
  );
}
