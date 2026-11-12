import { useEffect, useState } from 'react';
import { useWeather } from '../weather/useWeather';
import { dateLine, freshReading } from './model';

/**
 * "Wednesday night, 49° and clear" under the clock. Re-renders each minute. The weather
 * part needs a reading under an hour old (by the wall clock); otherwise the line is the
 * day part alone.
 */
export function DateLine({ now = () => new Date(), wallNow = Date.now }: { now?: () => Date; wallNow?: () => number }) {
  const { reading } = useWeather();
  const [d, setD] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setD(now()), 60_000);
    return () => clearInterval(id);
  }, [now]);
  return <div className="u-date">{dateLine(d, freshReading(reading, wallNow()))}</div>;
}
