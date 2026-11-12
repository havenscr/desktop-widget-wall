import { create } from 'zustand';
import { isQuiet } from '../music/model';
import { useNowPlayingStore } from '../music/store';
import { readLastPlayed, writeLastPlayed, type LastPlayed } from './model';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

interface LastPlayedState {
  last: LastPlayed | null;
  /** Album art of `last`, kept in memory only (never written to storage). */
  art: string | null;
}

/**
 * The last track this wall saw playing, for Unwind's idle view ("Play again"). It follows
 * the shared now playing store for the whole app, so a track played while Work was open
 * still shows when Unwind opens later. Title, artist and source survive a restart.
 */
export const useLastPlayed = create<LastPlayedState>(() => ({ last: readLastPlayed(storage()), art: null }));

useNowPlayingStore.subscribe((s) => {
  const info = s.info;
  if (!info || isQuiet(info) || !info.title) return;
  const next: LastPlayed = { title: info.title, artist: info.artist || info.album || '', source: info.source_app || '' };
  const prev = useLastPlayed.getState();
  const same = prev.last?.title === next.title && prev.last?.artist === next.artist && prev.last?.source === next.source;
  if (same && prev.art === s.art) return;
  if (!same) writeLastPlayed(storage(), next);
  useLastPlayed.setState({ last: next, art: s.art });
});

/** Tests: forget the last track. */
export function resetLastPlayed(last: LastPlayed | null = null): void {
  useLastPlayed.setState({ last, art: null });
}
