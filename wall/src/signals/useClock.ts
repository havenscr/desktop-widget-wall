import { useEffect, useState } from 'react';

/** The current time, refreshed every `ms` milliseconds while the caller is mounted. */
export function useClock(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
