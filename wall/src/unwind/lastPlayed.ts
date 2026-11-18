import { create } from 'zustand';
import { isQuiet } from '../music/model';
import { playerName, sourceKey } from '../music/players';
import { useNowPlayingStore } from '../music/store';
import { loadLastOwn, saveLastOwn, type LastOwn } from './lastOwn';
import { useWatchStore } from './watch/store';
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
  /** The last item the wall's own player played (kept across a restart), or null when it does not know one. */
  own: LastOwn | null;
}

/**
 * The last track this wall saw playing, for Unwind's idle view ("Play again"). It follows
 * the shared now playing store for the whole app, so a track played while Work was open
 * still shows when Unwind opens later. Title, artist and source survive a restart.
 */
export const useLastPlayed = create<LastPlayedState>(() => ({ last: readLastPlayed(storage()), art: null, own: loadLastOwn() }));

useNowPlayingStore.subscribe((s) => {
  const info = s.info;
  if (!info || isQuiet(info) || !info.title) return;
  const next: LastPlayed = { title: info.title, artist: info.artist || info.album || '', source: playerName(sourceKey(info)) ?? '' };
  const prev = useLastPlayed.getState();
  const same = prev.last?.title === next.title && prev.last?.artist === next.artist && prev.last?.source === next.source;
  if (same && prev.art === s.art) return;
  if (!same) writeLastPlayed(storage(), next);
  useLastPlayed.setState({ last: next, art: s.art });
});

// The wall's own player: whatever it puts in the frame is remembered (kind, id, label, which path started it).
useWatchStore.subscribe((s, prev) => {
  const p = s.playing;
  if (!p || p.kind === 'own') return;
  if (prev.playing && prev.playing.kind === p.kind && prev.playing.id === p.id && prev.playing.label === p.label && prev.source === s.source) return;
  const own: LastOwn = { kind: p.kind, id: p.id, label: p.label, from: s.source };
  const cur = useLastPlayed.getState().own;
  if (cur && cur.kind === own.kind && cur.id === own.id && cur.label === own.label && cur.from === own.from) return;
  saveLastOwn(own);
  useLastPlayed.setState({ own });
});

/** Tests: forget the last track (and, unless given, the wall's own item). */
export function resetLastPlayed(last: LastPlayed | null = null, own: LastOwn | null = null): void {
  useLastPlayed.setState({ last, art: null, own });
}
