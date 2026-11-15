import { create } from 'zustand';
import { invoke } from '../../bridge/tauri';
import { isPlaying, type NowPlayingInfo } from '../../music/model';
import { isKnownPlayer, playerName, sourceKey } from '../../music/players';
import { spotify, type SpotifyPlayback } from '../../music/spotify';
import { mediaTarget } from '../../music/store';
import { spotifyReady, useSpotifyStatus } from '../spotify/status';
import { useWatchStore } from './store';

/** The steps one click moves through, in minutes: Off, 30, 60, 90, then Off again. */
export const SLEEP_STEPS = [30, 60, 90] as const;
const MINUTE = 60_000;
/** Each native answer the end asks for is waited for this long at most. */
export const READ_WAIT_MS = 3_000;

interface SleepState {
  /** `Date.now()` when the timer ends, or null while it is off. */
  endsAt: number | null;
  /** Minutes of the step that started it (30, 60 or 90), 0 while off. */
  step: number;
}

/** The sleep timer: a small store that lives at module level, so it runs while Unwind is not shown. It is not kept across a restart. */
export const useSleep = create<SleepState>(() => ({ endsAt: null, step: 0 }));

let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function arm(): void {
  clearTimeout(timer);
  timer = undefined;
  const { endsAt } = useSleep.getState();
  if (endsAt === null) return;
  // A very long wait is cut into pieces a browser timer holds exactly.
  timer = setTimeout(check, Math.min(Math.max(0, endsAt - Date.now()), 2_000_000));
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', onVisible);
  }
}

function onVisible(): void {
  if (!document.hidden) check();
}

/** Ends the timer when its time has come (called by the timer and whenever the page shows again, so a PC that slept past the end stops at once on wake). */
export function check(now = Date.now()): void {
  const { endsAt } = useSleep.getState();
  if (endsAt === null) return;
  if (now >= endsAt) void finish();
  else arm();
}

/** Whole minutes left, rounded up (never under 1 while running); 0 when off. */
export function minutesLeft(endsAt: number | null, now = Date.now()): number {
  if (endsAt === null) return 0;
  return Math.max(1, Math.ceil((endsAt - now) / MINUTE));
}

/** The chip's words: "Stop in 30 min" while off, "Stops in 24 min" (or "Stops in 1 min") while running. */
export function sleepWords(endsAt: number | null, now = Date.now()): string {
  return endsAt === null ? 'Stop in 30 min' : `Stops in ${minutesLeft(endsAt, now)} min`;
}

/** The step the next click starts: 30 from Off, then 60, 90, and Off after 90. */
export function nextStep(step: number): number {
  const at = SLEEP_STEPS.findIndex((s) => s === step);
  return at < 0 ? SLEEP_STEPS[0] : (SLEEP_STEPS[at + 1] ?? 0);
}

/** A click: Off, 30, 60, 90, Off. Each step counts from the click. */
export function stepSleep(now = Date.now()): void {
  const step = nextStep(useSleep.getState().step);
  useSleep.setState(step === 0 ? { endsAt: null, step: 0 } : { endsAt: now + step * MINUTE, step });
  arm();
}

/** Back to Off. */
export function clearSleep(): void {
  clearTimeout(timer);
  timer = undefined;
  useSleep.setState({ endsAt: null, step: 0 });
}

/** Development and tests: a timer that ends at `endsAt`. */
export function startSleepAt(endsAt: number, step = 30): void {
  useSleep.setState({ endsAt, step });
  arm();
}

/** True for a source the wall can name as an outside app: a known player, and not the web view the wall's own video plays in. */
function outsideApp(source: string | null): boolean {
  return source !== null && isKnownPlayer(source) && playerName(source)?.toLowerCase() !== 'msedgewebview2';
}

type Read<T> = { ok: true; value: T } | { ok: false };

/** A native answer within `READ_WAIT_MS`, else "unknown": a failure and a silence read the same. Nothing cached stands in for it. */
function limited<T>(call: Promise<T>): Promise<Read<T>> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false }), READ_WAIT_MS);
    call.then(
      (value) => {
        clearTimeout(t);
        resolve({ ok: true, value });
      },
      () => {
        clearTimeout(t);
        resolve({ ok: false });
      },
    );
  });
}

/**
 * The end of the timer, in this order. One observation is taken for this end: a one-shot `get_now_playing` that does
 * not depend on the visible-only poll (it works while the page is hidden, the display being off), limited to three
 * seconds; a failed or silent read is "unknown" and no answer cached before this attempt stands in for it.
 *  1. Spotify, by its own state: when it is signed in and its own `playback` says playing, one `spotify.pause()`, whether
 *     or not a wall video is on and whatever session the observation names. Paused or unreadable: nothing for Spotify.
 *  2. The play and pause key, at most once, only when the observation succeeded and names a known outside app (not the
 *     wall's own web view, not an unknown or missing source, not Spotify when it is signed in, since step 1 owns it)
 *     that says `playing`; aimed at that session. A wall video being on does not forbid it. It is sent before the video
 *     is stopped.
 *  3. The wall's video is stopped with its reason, always, also when the read failed.
 * Every failure is silent; the chip is already Off.
 */
async function finish(): Promise<void> {
  clearSleep();
  try {
    const ready = spotifyReady(useSpotifyStatus.getState());
    const noRead: Read<SpotifyPlayback | null> = { ok: false };
    const [seen, own] = await Promise.all([limited(invoke<NowPlayingInfo | null>('get_now_playing', { artFor: '' })), ready ? limited(spotify.playback()) : Promise.resolve(noRead)]);
    const sends: Promise<unknown>[] = [];
    if (ready && own.ok && own.value?.playing === true) sends.push(limited(spotify.pause()));
    if (seen.ok && seen.value) {
      const info = seen.value;
      const source = sourceKey(info);
      const spotifyOwned = ready && playerName(source) === 'Spotify';
      if (outsideApp(source) && !spotifyOwned && isPlaying(info) && !info.ended) sends.push(limited(invoke('media_play_pause', mediaTarget(info))));
    }
    await Promise.all(sends);
  } catch {
    /* every failure is silent apart from the chip going back to Off */
  }
  useWatchStore.getState().stop('sleep');
}

/** Development only: end the timer now, as its end does. */
export function endSleepNow(): Promise<void> {
  return finish();
}

/** Tests only: Off, with the timer and the page listener dropped. */
export function resetSleep(): void {
  clearSleep();
  if (listening && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  listening = false;
}
