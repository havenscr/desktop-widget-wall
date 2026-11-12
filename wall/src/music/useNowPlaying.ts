import { useEffect } from 'react';
import type { NowPlayingInfo } from './model';
import { acquireNowPlaying, sendMediaCommand, useNowPlayingStore, type MediaCommand } from './store';

export { POLL_MS, CALL_TIMEOUT_MS } from './store';

export interface NowPlayingState {
  info: NowPlayingInfo | null;
  art: string | null;
  /** `Date.now()` when `info` arrived. */
  at: number;
  command: (name: MediaCommand) => void;
}

/**
 * Now playing from the one shared poll (see `store.ts`). Every component that calls this
 * shares the same `get_now_playing` loop; it runs only while at least one is mounted and the
 * page is visible.
 */
export function useNowPlaying(): NowPlayingState {
  const info = useNowPlayingStore((s) => s.info);
  const art = useNowPlayingStore((s) => s.art);
  const at = useNowPlayingStore((s) => s.at);
  useEffect(() => acquireNowPlaying(), []);
  return { info, art, at, command: sendMediaCommand };
}
