import { tip } from '../ui/HoverTip';
import { clockText } from '../meet/model';
import { WEATHER_UNAVAILABLE } from '../unwind/model';
import { WeatherIcon } from '../weather/WeatherIcon';
import { REFRESH_MS, WEATHER_SOURCE_NAMES, weatherFailureText, type WeatherFailure, type WeatherReading } from '../weather/model';

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

/** "updated 12 min ago", "updated 2 h ago": how old a kept reading is. */
export function updatedText(ageMs: number): string {
  const mins = Math.max(1, Math.floor(ageMs / 60_000));
  return mins < 60 ? `updated ${mins} min ago` : `updated ${Math.floor(mins / 60)} h ago`;
}

/**
 * The outside row's state from the weather hook's public shape. The hook keeps the last good
 * reading through an outage on purpose, so any usable reading shows: dimmed, with its age in
 * place of the high and low, once a normal refresh is overdue, and with the failed refresh's
 * reason in the hover card. "Unavailable" is only for no reading at all, said once it is known
 * to be missing; nothing is said while the first read is still out.
 */
export function outsideState(w: Input, now: number): OutsideState {
  const r = w.reading;
  if (!r || !Number.isFinite(r.fetchedAt) || !Number.isFinite(r.temp)) {
    if (!w.failed && r === null) return { kind: 'loading' };
    const tried = w.attemptedAt ? clockText(w.attemptedAt) : 'recently';
    return { kind: 'missing', tip: `${weatherFailureText(w.failure, w.nextTryAt)} Last tried ${tried}.` };
  }
  const age = now - r.fetchedAt;
  const stale = age >= REFRESH_MS + 60_000;
  const from = r.source === 'nws' ? ` (from ${WEATHER_SOURCE_NAMES.nws}, while Open-Meteo is not answering)` : '';
  const failedNote = w.failed ? ` The last try failed: ${weatherFailureText(w.failure, w.nextTryAt)}` : '';
  return {
    kind: 'reading',
    view: {
      temp: r.temp,
      look: r.look.label.toLowerCase(),
      icon: r.look.icon,
      side: stale ? updatedText(age) : `${r.high}° / ${r.low}°`,
      stale,
      tip: `Weather read at ${clockText(r.fetchedAt)}${from}. Today's high ${r.high}°, low ${r.low}°.${failedNote}${stale ? ` ${updatedText(age)}.` : ''}`,
    },
  };
}

const WARM = new Set(['sun', 'cloud-sun']);

/** "50° outside, partly cloudy" with the day's high and low, from the reading the wall already has. */
export function OutsideRow({ state: s }: { state: OutsideState }) {
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
