import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import { nextAnchor, nextArt, type NowPlayingInfo, type ProgressAnchor } from './model';

export const POLL_MS = 2000;
export const CALL_TIMEOUT_MS = 5000;
/** A track that came without art is asked for its art again this often (players add it late). */
export const ART_RETRY_MS = 10_000;

export type MediaCommand = 'media_play_pause' | 'media_next' | 'media_previous';

interface NowPlayingStoreState {
  info: NowPlayingInfo | null;
  art: string | null;
  /** `Date.now()` when `info` arrived; progress is advanced from this. */
  at: number;
  /** Local progress clock; see `nextAnchor`. */
  anchor: ProgressAnchor | null;
}

export const useNowPlayingStore = create<NowPlayingStoreState>(() => ({ info: null, art: null, at: 0, anchor: null }));

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
/**
 * The `art_key` of the track `art` belongs to, sent back as `artFor` so Rust skips the art
 * only while this copy still matches the track. Empty asks for the art: before the first
 * answer, after a dropped or timed-out answer (this stays as it was), and after a reload,
 * so the art is never lost while Rust thinks it was delivered.
 */
let artKey: string | null = null;
/** When a track came without art, the time to ask again. */
let artRetryAt = 0;
/**
 * The `art_key` whose cover was refused here (a type outside the allowed list, bad base64,
 * or an image the web view could not decode). It is never asked for again, so a refused
 * cover does not cross the bridge every 10 seconds.
 */
let rejectedKey: string | null = null;

async function pollOnce(): Promise<void> {
  // At most one native call at a time: while a timed-out call is still hung, wait for it.
  if (outstanding) return;
  const mine = ++seq;
  if (art === null && artKey !== null && artKey !== rejectedKey && Date.now() >= artRetryAt) artKey = null;
  const call = invoke<NowPlayingInfo | null>('get_now_playing', { artFor: artKey ?? '' });
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
      artKey = null;
      useNowPlayingStore.setState({ info: null, art: null, at: Date.now(), anchor: null });
      return;
    }
    art = nextArt(next, art);
    if (!next.art_unchanged) {
      artKey = typeof next.art_key === 'string' && next.art_key ? next.art_key : null;
      if (art === null) {
        artRetryAt = Date.now() + ART_RETRY_MS;
        // Bytes came but were refused: remember the track so they are not asked for again.
        if (next.album_art_base64 && artKey) rejectedKey = artKey;
      }
    }
    const at = Date.now();
    useNowPlayingStore.setState({ info: next, art, at, anchor: nextAnchor(useNowPlayingStore.getState().anchor, next, at) });
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

/**
 * The cover could not be shown (the `<img>` failed to decode it): drop it and do not ask
 * for this track's cover again.
 */
export function rejectArt(): void {
  if (art === null) return;
  rejectedKey = artKey;
  art = null;
  useNowPlayingStore.setState({ art: null });
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
  artKey = null;
  artRetryAt = 0;
  rejectedKey = null;
  useNowPlayingStore.setState({ info: null, art: null, at: 0, anchor: null });
}

/** The Tools drawer's Retry for Music: one poll now while the loop runs. False when nothing is polling, so no read was made. */
export async function refreshNowPlaying(): Promise<boolean> {
  if (!active || consumers === 0) return false;
  await run();
  return true;
}
