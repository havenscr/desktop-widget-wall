import { useEffect, useRef } from 'react';
import { create } from 'zustand';
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

const initial = (): WeatherState => ({ reading: null, failed: false, now: Date.now() });

/** The one shared reading every `useWeather` user sees. */
export const useWeatherStore = create<WeatherState>(() => initial());

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastAttempt: number | null = null;
let inFlight = false;
/** Bumped when the last user leaves, so a fetch started before that cannot land after it. */
let epoch = 0;
/** The fetcher of the most recently joined user (tests pass their own). */
let fetcher: typeof fetch = defaultFetch;

async function run(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  const mine = epoch;
  lastAttempt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const s = loadSettings();
    const res = await fetcher(buildUrl(s.latitude, s.longitude), { signal: controller.signal });
    if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
    const next = parseWeather(await res.json(), Date.now());
    if (mine === epoch) useWeatherStore.setState({ reading: next, failed: false });
  } catch {
    /* keep the last good reading; the card shows its age */
    if (mine === epoch && !useWeatherStore.getState().reading) useWeatherStore.setState({ failed: true });
  } finally {
    clearTimeout(timeout);
    if (mine === epoch) inFlight = false;
  }
}

function check(): void {
  useWeatherStore.setState({ now: Date.now() });
  if (shouldRefresh(lastAttempt, Date.now(), useWeatherStore.getState().reading !== null)) void run();
}

function join(f: typeof fetch): void {
  fetcher = f;
  users += 1;
  if (users === 1) {
    check();
    timer = setInterval(check, CHECK_MS);
  }
}

function leave(): void {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  if (timer !== null) clearInterval(timer);
  timer = null;
  // Nobody reads it any more: forget it, so a later first user starts clean.
  epoch += 1;
  inFlight = false;
  lastAttempt = null;
  useWeatherStore.setState(initial(), true);
}

/**
 * The weather, shared by every component that uses it (the Work card, the Unwind date line,
 * Watt): one fetch however many are mounted. Fetches when the first visible user mounts and
 * every 15 minutes while at least one is mounted and visible; fetches once when the page becomes
 * visible after 15 minutes or more. With no reading yet it retries every minute. A failure keeps
 * the last good reading. A request is aborted after 15 seconds. `now` ticks each minute so the
 * stale text stays current. When the last user unmounts the reading is forgotten.
 */
export function useWeather(f: typeof fetch = defaultFetch): WeatherState {
  const visible = useVisible();
  const fRef = useRef(f);
  fRef.current = f;
  useEffect(() => {
    if (!visible) return;
    join(fRef.current);
    return leave;
  }, [visible]);
  return useWeatherStore();
}
