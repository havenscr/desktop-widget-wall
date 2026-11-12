import { useEffect, useRef, useState } from 'react';
import { loadSettings } from '../settings/settings';
import { useVisible } from '../ui/useVisible';
import { buildUrl, parseWeather, shouldRefresh, type WeatherReading } from './model';

const CHECK_MS = 60_000;
export const FETCH_TIMEOUT_MS = 15_000;

export interface WeatherState {
  reading: WeatherReading | null;
  /** True after a failed fetch while there is still no reading. */
  failed: boolean;
  now: number;
}

const defaultFetch: typeof fetch = (...a) => fetch(...a);

/**
 * Fetches on mount and every 15 minutes while visible; fetches once when the
 * page becomes visible after 15 minutes or more. With no reading yet it retries
 * every minute. A failure keeps the last good reading. A request is aborted
 * after 15 seconds. A finished result is applied as long as the component is
 * still mounted, even if the effect that started it has been cleaned up
 * (StrictMode remount, window hidden and shown). `now` ticks each minute so the
 * stale text stays current.
 */
export function useWeather(fetcher: typeof fetch = defaultFetch): WeatherState {
  const visible = useVisible();
  const [reading, setReading] = useState<WeatherReading | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastAttempt = useRef<number | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const hasReading = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const run = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      lastAttempt.current = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const s = loadSettings();
        const res = await fetcher(buildUrl(s.latitude, s.longitude), { signal: controller.signal });
        if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
        const next = parseWeather(await res.json(), Date.now());
        hasReading.current = true;
        if (mounted.current) {
          setReading(next);
          setFailed(false);
        }
      } catch {
        /* keep the last good reading; the card shows its age */
        if (mounted.current && !hasReading.current) setFailed(true);
      } finally {
        clearTimeout(timeout);
        inFlight.current = false;
      }
    };
    const check = () => {
      setNow(Date.now());
      if (shouldRefresh(lastAttempt.current, Date.now(), hasReading.current)) void run();
    };
    check();
    const id = setInterval(check, CHECK_MS);
    return () => clearInterval(id);
  }, [visible, fetcher]);

  return { reading, failed, now };
}
