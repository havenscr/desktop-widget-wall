import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import { loadSettings } from '../settings/settings';
import { useVisible } from '../ui/useVisible';
import {
  asksSecondSource,
  BACKOFF_MS,
  failureFromError,
  parseNws,
  parseWeather,
  isWindy,
  shouldRefresh,
  type WeatherFailure,
  type WeatherReading,
  type WeatherSource,
} from './model';

const CHECK_MS = 60_000;
export const FETCH_TIMEOUT_MS = 15_000;

export interface WeatherState {
  reading: WeatherReading | null;
  /** True after a failed fetch while there is still no reading. */
  failed: boolean;
  failure?: WeatherFailure | null;
  attemptedAt?: number | null;
  /** After a 429: the time (epoch ms) the first source is asked again; null otherwise. */
  nextTryAt?: number | null;
  now: number;
}

/**
 * Asks the native side for one source's reply text (it names the failure kind in the error).
 * The page never calls the weather services itself.
 */
export type WeatherReader = (source: WeatherSource, latitude: number, longitude: number) => Promise<string>;

const nativeReader: WeatherReader = (source, latitude, longitude) =>
  invoke<string>('wall2_weather', { latitude, longitude, source });

const initial = (): WeatherState => ({ reading: null, failed: false, failure: null, attemptedAt: null, nextTryAt: null, now: Date.now() });

/** The one shared reading every `useWeather` user sees. */
export const useWeatherStore = create<WeatherState>(() => initial());

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastAttempt: number | null = null;
let inFlight = false;
/** Bumped when the last user leaves, so a fetch started before that cannot land after it. */
let epoch = 0;
/** The reader of the most recently joined user (tests pass their own). */
let reader: WeatherReader = nativeReader;
/** The first source is left alone until this time (epoch ms) after a 429; 0 when it is not. */
let blockedUntil = 0;
/** Which of the 15, 30 and 60 minute waits comes next after a 429. */
let backoffStep = 0;
/** The highest temperature seen today (with its local date), for the second source's evening high. In memory only. */
let seenToday: { date: string; high: number } | null = null;

const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Notes a reading's highest value for today: Open-Meteo's high counts, the second source's reading only by its temperature now. */
function rememberHigh(reading: WeatherReading): void {
  const date = localDate(reading.fetchedAt);
  const seen = reading.source === 'nws' ? reading.temp : Math.max(reading.temp, reading.high);
  seenToday = seenToday && seenToday.date === date ? { date, high: Math.max(seenToday.high, seen) } : { date, high: seen };
}

/** Rejects with `timeout` when the reply does not come in time; a late reply is dropped. */
function withTimeout(p: Promise<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject('timeout'), FETCH_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/** One source: a reading, or the failure kind. */
async function attempt(source: WeatherSource, latitude: number, longitude: number): Promise<WeatherReading | WeatherFailure> {
  let text: string;
  try {
    text = await withTimeout(reader(source, latitude, longitude));
  } catch (error) {
    return failureFromError(error);
  }
  try {
    const body: unknown = JSON.parse(text);
    const at = Date.now();
    const seen = seenToday && seenToday.date === localDate(at) ? seenToday.high : null;
    return source === 'nws' ? parseNws(body, at, seen) : parseWeather(body, at);
  } catch {
    return 'parse';
  }
}

/** A reading kept through failed reads is dropped when it is older than this. */
export const KEEP_READING_MS = 24 * 3_600_000;

/**
 * One try. Open-Meteo first (not while a 429 holds it back, unless `force`); when it refuses (429)
 * or cannot be reached, the National Weather Service. A 429 moves the next Open-Meteo try 15, then
 * 30, then 60 minutes out; a success resets that.
 */
async function run(force = false): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  const mine = epoch;
  const started = Date.now();
  lastAttempt = started;
  useWeatherStore.setState({ attemptedAt: started });
  try {
    const s = loadSettings();
    let reading: WeatherReading | null = null;
    let failure: WeatherFailure;
    if (!force && started < blockedUntil) {
      failure = 'http 429';
    } else {
      const first = await attempt('open-meteo', s.latitude, s.longitude);
      if (typeof first !== 'string') {
        blockedUntil = 0;
        backoffStep = 0;
        reading = first;
        failure = 'parse';
      } else {
        failure = first;
        if (first === 'http 429') {
          const wait = BACKOFF_MS[Math.min(backoffStep, BACKOFF_MS.length - 1)];
          if (!force) {
            // Only a scheduled try that meets a 429 advances the wait (15, 30, 60 minutes).
            blockedUntil = started + wait;
            backoffStep = Math.min(backoffStep + 1, BACKOFF_MS.length - 1);
          } else if (started >= blockedUntil) {
            // A pressed Retry never lengthens a wait that is running; with none running it starts the current one.
            blockedUntil = started + wait;
          }
        }
      }
    }
    if (!reading && asksSecondSource(failure)) {
      const second = await attempt('nws', s.latitude, s.longitude);
      if (typeof second !== 'string') reading = second;
    }
    if (mine !== epoch) return;
    if (reading) rememberHigh(reading);
    if (reading) reading.windy = isWindy(useWeatherStore.getState().reading?.windy === true, reading.wind);
    if (reading) useWeatherStore.setState({ reading, failed: false, failure: null, nextTryAt: reading.source === 'nws' && failure === 'http 429' ? blockedUntil : null });
    /* a failure keeps the last good reading, and the card shows its age; one older than a day is dropped, so the card says it is unavailable */
    else {
      const kept = useWeatherStore.getState().reading;
      const tooOld = kept !== null && Date.now() - kept.fetchedAt > KEEP_READING_MS;
      useWeatherStore.setState({ ...(tooOld ? { reading: null } : {}), failed: true, failure, nextTryAt: failure === 'http 429' ? blockedUntil : null });
    }
  } finally {
    if (mine === epoch) inFlight = false;
  }
}

function check(): void {
  const now = Date.now();
  useWeatherStore.setState({ now });
  const st = useWeatherStore.getState();
  // No reading and Open-Meteo is refusing this address: no new try before the planned time.
  if (!st.reading && st.nextTryAt && now < st.nextTryAt) return;
  if (shouldRefresh(lastAttempt, now, st.reading !== null)) void run();
}

function join(r: WeatherReader): void {
  reader = r;
  users += 1;
  if (users === 1) timer = setInterval(check, CHECK_MS);
  // Every mount checks (and refreshes the clock), throttled by the last attempt; a mount with
  // no reading yet retries after a minute at most.
  check();
}

function leave(): void {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  if (timer !== null) clearInterval(timer);
  timer = null;
  // Stop polling and drop any answer still on its way, but keep the reading, the failure flag
  // and the last attempt time, so a hide then show shows the old reading with its age and
  // does not fetch again inside the interval.
  epoch += 1;
  // An answer we just dropped never landed, so the next show may ask again.
  if (inFlight) lastAttempt = null;
  inFlight = false;
}

/** Forget everything. For tests only. */
export function resetWeatherStore(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  users = 0;
  epoch += 1;
  inFlight = false;
  lastAttempt = null;
  blockedUntil = 0;
  backoffStep = 0;
  seenToday = null;
  reader = nativeReader;
  useWeatherStore.setState(initial(), true);
}

/**
 * The weather, shared by every component that uses it (the Work card, the Unwind date line,
 * Watt): one fetch however many are mounted. Fetches when the first visible user mounts and
 * every 15 minutes while at least one is mounted and visible; fetches once when the page becomes
 * visible after 15 minutes or more. With no reading yet it retries every minute. A failure keeps
 * the last good reading. The read is native (`wall2_weather`) and gives up after 15 seconds. After a
 * 429 Open-Meteo is left alone for 15, then 30, then 60 minutes, and the National Weather Service is
 * asked instead. `now` ticks each minute so the
 * stale text stays current. When the last user leaves (the page is hidden) polling stops but the
 * reading and the time of the last attempt are kept.
 */
export function useWeather(r: WeatherReader = nativeReader): WeatherState {
  const visible = useVisible();
  const fRef = useRef(r);
  fRef.current = r;
  useEffect(() => {
    if (!visible) return;
    join(fRef.current);
    return leave;
  }, [visible]);
  return useWeatherStore();
}

/**
 * The Tools drawer's Retry for Weather: one fetch now, outside the 15 minute check and outside a
 * 429 wait (skipped while one runs).
 */
export function refreshWeather(): Promise<void> {
  return run(true);
}
