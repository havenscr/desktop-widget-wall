import { create } from 'zustand';
import { isPlaying, type NowPlayingInfo } from '../../music/model';
import { isKnownPlayer, playerName, sourceKey } from '../../music/players';
import { spotify } from '../../music/spotify';
import { refreshNowPlaying, sendMediaCommand, useNowPlayingStore } from '../../music/store';
import { spotifyReady, useSpotifyStatus } from '../spotify/status';
import { useWatchStore } from './store';

/** The steps one click moves through, in minutes: Off, 30, 60, 90, then Off again. */
export const SLEEP_STEPS = [30, 60, 90] as const;
const MINUTE = 60_000;
/** What the player showed less than this long ago may be trusted for a play or pause toggle. */
export const INFO_FRESH_MS = 10_000;

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

/** True when the now playing session is the wall's own video or an app the wall cannot tell from it (a toggle sent there could start another player). */
function ownVideo(source: string | null): boolean {
  return source !== null && (playerName(source)?.toLowerCase() === 'msedgewebview2' || !isKnownPlayer(source));
}

/**
 * What the timer's end does to the player the wall follows. Spotify, when signed in: its own pause (a
 * real pause, never a toggle). Any other known player: one play and pause key, only when the player
 * said `playing` a moment ago. Anything else (paused, no information, a stale answer, the wall's own
 * video, an app the wall does not know): nothing, because a toggle must never start music.
 */
async function pausePlayer(): Promise<void> {
  // A fresh read first when the poll runs; without a poll the answer below may be stale.
  try {
    await refreshNowPlaying();
  } catch {
    /* the last answer stays */
  }
  const { info, at } = useNowPlayingStore.getState();
  const source = sourceKey(info);
  if (playerName(source) === 'Spotify' && spotifyReady(useSpotifyStatus.getState())) {
    spotify.pause().catch(() => {});
    return;
  }
  if (!info || !isPlaying(info as NowPlayingInfo) || ownVideo(source) || Date.now() - at > INFO_FRESH_MS) return;
  sendMediaCommand('media_play_pause');
}

async function finish(): Promise<void> {
  clearSleep();
  try {
    // The wall's own video goes first (removed with its reason); then the player the wall follows is read again and paused.
    useWatchStore.getState().stop('sleep');
    await pausePlayer();
  } catch {
    /* every failure is silent apart from the chip going back to Off */
  }
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
