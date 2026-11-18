import { useEffect, useRef } from 'react';
import { setOnAirLive } from '../bridge/meetBrief';
import { useSignalStore } from '../signals/store';
import { usePlaceStore } from '../state/places';
import { isOnAirLive } from './liveState';

/** First wait before a failed report is sent again; it doubles up to `RETRY_MAX_MS`. */
export const RETRY_MS = 2_000;
export const RETRY_MAX_MS = 30_000;

/**
 * Whether On Air is live, read at render straight from the place and signal stores, so the person card never draws a
 * frame from a value copied in an effect: `<PersonDetails personKey={p.key} onAirLive={useOnAirLive()} />`.
 */
export function useOnAirLive(): boolean {
  const active = usePlaceStore((s) => s.active);
  const known = useSignalStore((s) => s.known);
  const recording = useSignalStore((s) => s.recording);
  const call = useSignalStore((s) => s.call);
  const browserAv = useSignalStore((s) => s.browserAv);
  return isOnAirLive({ active, known, recording, call, browserAv, now: 0 });
}

/**
 * Mount once (App.tsx). Tells Rust through `setOnAirLive` at start and then whenever the value changes. A value counts as
 * sent only once the command succeeds: a failure is sent again after a short wait that doubles up to 30 s, always with the
 * value current at that moment. A browser without the command keeps trying quietly.
 */
export function useOnAirLiveReport(): void {
  const live = useOnAirLive();
  const liveRef = useRef(live);
  liveRef.current = live;
  const sent = useRef<boolean | null>(null);
  useEffect(() => {
    if (sent.current === live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let wait = RETRY_MS;
    const attempt = () => {
      const value = liveRef.current;
      const retry = () => {
        if (stopped) return;
        timer = setTimeout(attempt, wait);
        wait = Math.min(wait * 2, RETRY_MAX_MS);
      };
      let p: Promise<void>;
      try {
        p = setOnAirLive(value);
      } catch {
        retry();
        return;
      }
      p.then(
        () => {
          if (!stopped) sent.current = value;
        },
        retry,
      );
    };
    sent.current = null;
    attempt();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [live]);
}
