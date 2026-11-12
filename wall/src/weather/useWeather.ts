import { useEffect, useRef, useState } from 'react';
import { loadSettings } from '../settings/settings';
import { useVisible } from '../ui/useVisible';
import { buildUrl, parseWeather, shouldRefresh, type WeatherReading } from './model';

const CHECK_MS = 60_000;

export interface WeatherState {
  reading: WeatherReading | null;
  now: number;
}

/**
 * Fetches on mount and every 15 minutes while visible; fetches once when the
 * page becomes visible after 15 minutes or more. A failure keeps the last good
 * reading. `now` ticks each minute so the stale text stays current.
 */
const defaultFetch: typeof fetch = (...a) => fetch(...a);

export function useWeather(fetcher: typeof fetch = defaultFetch): WeatherState {
  const visible = useVisible();
  const [reading, setReading] = useState<WeatherReading | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastAttempt = useRef<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const run = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      lastAttempt.current = Date.now();
      try {
        const s = loadSettings();
        const res = await fetcher(buildUrl(s.latitude, s.longitude));
        if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
        const next = parseWeather(await res.json(), Date.now());
        if (alive) setReading(next);
      } catch {
        /* keep the last good reading; the card shows its age */
      } finally {
        inFlight.current = false;
      }
    };
    const check = () => {
      setNow(Date.now());
      if (shouldRefresh(lastAttempt.current, Date.now())) void run();
    };
    check();
    const id = setInterval(check, CHECK_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [visible, fetcher]);

  return { reading, now };
}
