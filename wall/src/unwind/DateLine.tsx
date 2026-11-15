import { useEffect, useState } from 'react';
import { useWeather } from '../weather/useWeather';
import { dateLine, freshReading, WEATHER_UNAVAILABLE } from './model';
import { tip } from '../ui/HoverTip';
import { clockText } from '../meet/model';
import { WEATHER_SOURCE_NAMES, weatherFailureText } from '../weather/model';

/**
 * "Wednesday night, 49° and clear" under the clock. Re-renders each minute. The weather
 * part needs a reading under an hour old (by the wall clock); otherwise the line is the
 * day part alone.
 */
export function DateLine({ now = () => new Date(), wallNow = Date.now }: { now?: () => Date; wallNow?: () => number }) {
  const { reading, failed, failure, attemptedAt, nextTryAt } = useWeather();
  const [d, setD] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setD(now()), 60_000);
    return () => clearInterval(id);
  }, [now]);
  const fresh = freshReading(reading, wallNow());
  // Missing weather is said, dim, once it is known to be missing (a failed fetch, or a reading too old); not while still loading.
  const missing = !fresh && (failed || reading !== null);
  const minutes = attemptedAt ? Math.max(0, Math.floor((wallNow() - attemptedAt) / 60_000)) : 0;
  const tried = minutes < 1 ? 'less than a minute ago' : `${minutes} min ago`;
  const failedTip = failed && reading ? `Last try failed ${tried}: ${weatherFailureText(failure, nextTryAt)} Showing the reading from ${new Date(reading.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${reading.source === 'nws' ? ` (from ${WEATHER_SOURCE_NAMES.nws})` : ''}.` : null;
  // A reading from the second source says so (Open-Meteo is refusing this address or cannot be reached).
  const sourceTip = !failedTip && fresh && reading?.source === 'nws' ? `Weather from ${WEATHER_SOURCE_NAMES.nws}, read at ${clockText(reading.fetchedAt)}, while Open-Meteo is not answering.` : null;
  const hoverTip = failedTip ?? sourceTip;
  return (
    <div className="u-date" {...(hoverTip ? tip(hoverTip) : {})}>
      {dateLine(d, fresh)}
      {missing ? <span className="u-asof" {...tip(`${weatherFailureText(failure, nextTryAt)} Last tried ${attemptedAt ? new Date(attemptedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'recently'}.`)}>, {WEATHER_UNAVAILABLE}</span> : null}
    </div>
  );
}
