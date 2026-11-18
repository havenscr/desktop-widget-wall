import { useEffect, useRef } from 'react';
import { setOnAirLive } from '../bridge/meetBrief';
import { useSignalStore } from '../signals/store';
import { usePlaceStore } from '../state/places';
import { isOnAirLive, useOnAirLiveStore } from './liveState';

/**
 * Mount once, near where the active place is known (App.tsx). Keeps `useOnAirLiveStore` current and tells Rust through
 * `setOnAirLive` once at start and then only when the value changes. A missing or failing command is ignored.
 */
export function useOnAirLiveReport(): void {
  const active = usePlaceStore((s) => s.active);
  const known = useSignalStore((s) => s.known);
  const recording = useSignalStore((s) => s.recording);
  const call = useSignalStore((s) => s.call);
  const browserAv = useSignalStore((s) => s.browserAv);
  const sent = useRef<boolean | null>(null);
  const live = isOnAirLive({ active, known, recording, call, browserAv, now: 0 });
  useEffect(() => {
    useOnAirLiveStore.getState().set(live);
    if (sent.current === live) return;
    sent.current = live;
    try {
      void setOnAirLive(live).catch(() => undefined);
    } catch {
      // Not running with the command (a browser without the mock); nothing to tell.
    }
  }, [live]);
}

/** The shared answer, for the person card: `<PersonDetails personKey={p.key} onAirLive={useOnAirLive()} />`. */
export const useOnAirLive = (): boolean => useOnAirLiveStore((s) => s.live);
