import { useEffect, useState } from 'react';
import { useWeather } from '../weather/useWeather';
import { dateLine } from './model';

/** "Wednesday night, 49° and clear" under the clock. Re-reads the time each minute. */
export function DateLine({ now = () => new Date() }: { now?: () => Date }) {
  const { reading } = useWeather();
  const [d, setD] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setD(now()), 60_000);
    return () => clearInterval(id);
  }, [now]);
  return <div className="u-date">{dateLine(d, reading)}</div>;
}
