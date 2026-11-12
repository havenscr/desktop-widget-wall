import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { nextArt, type NowPlayingInfo } from './model';

export const POLL_MS = 2000;
export const CALL_TIMEOUT_MS = 5000;

class TimedOut extends Error {}

interface Timed<T> {
  promise: Promise<T>;
  /** Clear the timer and reject now (used on unmount). */
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

type Command = 'media_play_pause' | 'media_next' | 'media_previous';

export interface NowPlayingState {
  info: NowPlayingInfo | null;
  art: string | null;
  command: (name: Command) => void;
}

/**
 * Polls get_now_playing every 2 seconds while the page is visible, never while
 * hidden. One poll runs at a time and the next is scheduled only after it ends;
 * a sequence number drops an answer that a newer poll has already replaced. Each
 * call gives up after 5 seconds, so a hung call cannot stall the loop; its late
 * answer is dropped (the promise is already settled).
 */
export function useNowPlaying(): NowPlayingState {
  const visible = useVisible();
  const [info, setInfo] = useState<NowPlayingInfo | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const artRef = useRef<string | null>(null);
  const mounted = useRef(false);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(false);

  // The native call that has not settled yet, and the cancel for its timeout timer.
  const outstanding = useRef<Promise<unknown> | null>(null);
  const cancelTimer = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelTimer.current?.();
    };
  }, []);

  const pollOnce = useCallback(async () => {
    // At most one native call at a time: while a timed-out call is still hung, wait for it.
    if (outstanding.current) return;
    const mine = ++seq.current;
    const call = invoke<NowPlayingInfo | null>('get_now_playing');
    outstanding.current = call;
    const clear = () => {
      if (outstanding.current === call) outstanding.current = null;
    };
    call.then(clear, clear);
    const timed = withTimeout(call, CALL_TIMEOUT_MS);
    cancelTimer.current = timed.cancel;
    try {
      const next = await timed.promise;
      if (!mounted.current || mine !== seq.current) return;
      if (!next) {
        artRef.current = null;
        setArt(null);
        setInfo(null);
        return;
      }
      artRef.current = nextArt(next, artRef.current);
      setArt(artRef.current);
      setInfo(next);
    } catch {
      /* a failed or timed-out poll keeps what is on screen */
    } finally {
      if (cancelTimer.current === timed.cancel) cancelTimer.current = null;
    }
  }, []);

  const run = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    clearTimeout(timer.current);
    try {
      do {
        again.current = false;
        await pollOnce();
      } while (again.current && active.current && mounted.current);
    } finally {
      inFlight.current = false;
    }
    if (active.current && mounted.current) timer.current = setTimeout(() => void run(), POLL_MS);
  }, [pollOnce]);

  useEffect(() => {
    if (!visible) return;
    active.current = true;
    void run();
    return () => {
      active.current = false;
      clearTimeout(timer.current);
    };
  }, [visible, run]);

  const command = useCallback(
    (name: Command) => {
      invoke(name)
        .catch(() => {})
        .finally(() => {
          if (document.hidden || !active.current || !mounted.current) return;
          void run();
        });
    },
    [run],
  );

  return { info, art, command };
}
