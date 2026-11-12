import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import { nextArt, type NowPlayingInfo } from './model';

export const POLL_MS = 2000;
export const CALL_TIMEOUT_MS = 5000;

export type MediaCommand = 'media_play_pause' | 'media_next' | 'media_previous';

interface NowPlayingStoreState {
  info: NowPlayingInfo | null;
  art: string | null;
  /** `Date.now()` when `info` arrived; progress is advanced from this. */
  at: number;
}

export const useNowPlayingStore = create<NowPlayingStoreState>(() => ({ info: null, art: null, at: 0 }));

class TimedOut extends Error {}

interface Timed<T> {
  promise: Promise<T>;
  /** Clear the timer and reject now (used when the last consumer leaves). */
  cancel: () => void;
}

/**
 * Rejects after `ms` so a hung call cannot stall the single-flight loop; a late answer is
 * dropped. The timer is cleared on settle and on `cancel`.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Timed<T> {
  let cancel: () => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimedOut('timed out')), ms);
    cancel = () => {
      clearTimeout(id);
      reject(new TimedOut('cancelled'));
    };
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
  return { promise, cancel };
}

// One poll loop for the whole app. Consumers (the Work music bar, the Unwind view, the app
// itself) register with `acquireNowPlaying`; polling runs while any is registered and the
// page is visible. One poll at a time; the next is scheduled only after it ends; a sequence
// number drops an answer a newer poll has replaced; at most one native call is outstanding.
let consumers = 0;
let active = false;
let seq = 0;
let gen = 0; // bumped by a reset: an old loop that wakes later must not touch the new one
let inFlight = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let outstanding: Promise<unknown> | null = null;
let cancelTimer: (() => void) | null = null;
let art: string | null = null;

async function pollOnce(): Promise<void> {
  // At most one native call at a time: while a timed-out call is still hung, wait for it.
  if (outstanding) return;
  const mine = ++seq;
  const call = invoke<NowPlayingInfo | null>('get_now_playing');
  outstanding = call;
  const clear = () => {
    if (outstanding === call) outstanding = null;
  };
  call.then(clear, clear);
  const timed = withTimeout(call, CALL_TIMEOUT_MS);
  cancelTimer = timed.cancel;
  try {
    const next = await timed.promise;
    if (consumers === 0 || mine !== seq) return;
    if (!next) {
      art = null;
      useNowPlayingStore.setState({ info: null, art: null, at: Date.now() });
      return;
    }
    art = nextArt(next, art);
    useNowPlayingStore.setState({ info: next, art, at: Date.now() });
  } catch {
    /* a failed or timed-out poll keeps what is on screen */
  } finally {
    if (cancelTimer === timed.cancel) cancelTimer = null;
  }
}

async function run(): Promise<void> {
  if (inFlight) {
    again = true;
    return;
  }
  inFlight = true;
  const mine = gen;
  clearTimeout(timer);
  try {
    do {
      again = false;
      await pollOnce();
    } while (again && active && consumers > 0 && mine === gen);
  } finally {
    if (mine === gen) inFlight = false;
  }
  if (mine === gen && active && consumers > 0) timer = setTimeout(() => void run(), POLL_MS);
}

function sync(): void {
  const want = consumers > 0 && !document.hidden;
  if (want && !active) {
    active = true;
    void run();
  } else if (!want && active) {
    active = false;
    clearTimeout(timer);
  }
}

/** Register a consumer; returns the release function. Polling starts with the first consumer. */
export function acquireNowPlaying(): () => void {
  if (consumers++ === 0) document.addEventListener('visibilitychange', sync);
  sync();
  const mine = gen;
  let released = false;
  return () => {
    if (released || mine !== gen) return; // a reset already dropped this consumer
    released = true;
    if (--consumers === 0) {
      document.removeEventListener('visibilitychange', sync);
      sync();
      cancelTimer?.();
    }
  };
}

/** Send a media command, then refresh once if the page is still visible and someone is watching. */
export function sendMediaCommand(name: MediaCommand): void {
  invoke(name)
    .catch(() => {})
    .finally(() => {
      if (document.hidden || !active || consumers === 0) return;
      void run();
    });
}

/** Drop the shared state and the loop's bookkeeping, including a call that never settled (tests). */
export function resetNowPlaying(): void {
  clearTimeout(timer);
  cancelTimer?.();
  document.removeEventListener('visibilitychange', sync);
  consumers = 0;
  active = false;
  inFlight = false;
  again = false;
  outstanding = null;
  cancelTimer = null;
  seq++;
  gen++;
  art = null;
  useNowPlayingStore.setState({ info: null, art: null, at: 0 });
}
