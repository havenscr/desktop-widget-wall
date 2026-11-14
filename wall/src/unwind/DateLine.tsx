import { useEffect, useState } from 'react';
import { useWeather } from '../weather/useWeather';
import { dateLine, freshReading, WEATHER_UNAVAILABLE } from './model';
import { tip } from '../ui/HoverTip';
import { weatherFailureText } from '../weather/model';

/**
 * "Wednesday night, 49° and clear" under the clock. Re-renders each minute. The weather
 * part needs a reading under an hour old (by the wall clock); otherwise the line is the
 * day part alone.
 */
export function DateLine({ now = () => new Date(), wallNow = Date.now }: { now?: () => Date; wallNow?: () => number }) {
  const { reading, failed, failure, attemptedAt } = useWeather();
  const [d, setD] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setD(now()), 60_000);
    return () => clearInterval(id);
  }, [now]);
  const fresh = freshReading(reading, wallNow());
  // Missing weather is said, dim, once it is known to be missing (a failed fetch, or a reading too old); not while still loading.
  const missing = !fresh && (failed || reading !== null);
  return (
    <div className="u-date">
      {dateLine(d, fresh)}
      {missing ? <span className="u-asof" {...tip(`${weatherFailureText(failure)} Last tried ${attemptedAt ? new Date(attemptedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'recently'}.`)}>, {WEATHER_UNAVAILABLE}</span> : null}
    </div>
  );
}
