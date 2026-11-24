import { create } from 'zustand';
import { refreshNowPlaying } from '../../music/store';
import { spotify, type SpotifyItem } from '../../music/spotify';
import { useWatchStore } from '../watch/store';
import { confirmPlayer, playDeviceId, playFailureLine, STARTING_NOTE, useListenSource, useSpotifyStart } from './model';
import { spotifyReady, useSpotifyStatus } from './status';

/** A note at the foot of the card goes away after this long (the card's own `NOTE_MS`). */
const PIN_NOTE_MS = 6_000;

const waitSecond = () => new Promise<void>((resolve) => setTimeout(resolve, 1_000));
/** Returns false when the answer was a second `starting` for a start already under way: it is ignored (the count and Cancel stay) and the caller leaves the note alone. */
export async function finishPlay(answer: 'played' | 'starting', onStarting: () => void, name?: string): Promise<boolean> {
  if (answer === 'starting') {
    if (useSpotifyStart.getState().starting) return false;
    if (name !== undefined) useSpotifyStart.setState({ name });
    onStarting();
    // The "Play on" chip says "Starting Spotify" while the start flow runs, and reads the players again after it.
    useSpotifyStart.setState({ starting: true, startedAt: Date.now() });
    try {
      for (;;) {
        const state = await spotify.startStatus();
        if (!state.starting) {
          if (state.result !== 'played') throw new Error(state.result ?? 'failed');
          break;
        }
        await waitSecond();
      }
    } finally {
      useSpotifyStart.setState((s) => ({ starting: false, startedAt: null, rev: s.rev + 1 }));
    }
  }
  await refreshNowPlaying();
  return true;
}

/** Play an item whole, or shuffled, and report startup only when Rust opened Spotify. */
export async function playWhole(item: SpotifyItem, shuffled: boolean, onStarting: () => void): Promise<boolean> {
  // The player is confirmed against a fresh list first (see `confirmPlayer`): nothing plays on another player than the one named.
  const player = await confirmPlayer();
  return finishPlay(await spotify.play(item.kind, item.id, { shuffle: shuffled, ...player }), onStarting, item.name);
}


/** The starting and failure words of a play that did not start from the card itself (a pin); the card's note line reads it. */
export const useSpotifyPinNote = create<{ note: string | null }>(() => ({ note: null }));
let noteTimer: ReturnType<typeof setTimeout> | undefined;
function setPinNote(note: string | null): void {
  clearTimeout(noteTimer);
  useSpotifyPinNote.setState({ note });
  if (note && note !== STARTING_NOTE) noteTimer = setTimeout(() => useSpotifyPinNote.setState({ note: null }), PIN_NOTE_MS);
}

/**
 * A click on a Spotify pin: Listen opens with Spotify. Where Spotify is not set up or not signed in, no call is made (the card shows
 * its own line and button). Otherwise the item plays whole through the card's own path, and the starting and failure words go to the note.
 */
export function playPinnedSpotify(kind: 'playlist' | 'album', id: string, name: string): void {
  useWatchStore.getState().setTab('listen');
  useListenSource.getState().setSource('spotify');
  if (!spotifyReady(useSpotifyStatus.getState())) return;
  const named = !!playDeviceId();
  const item: SpotifyItem = { id, name, kind, imageUrl: null, thumbUrl: null, subtitle: null, count: null };
  void playWhole(item, false, () => setPinNote(STARTING_NOTE)).then(
    (ran) => ran && setPinNote(null),
    (e) => setPinNote(playFailureLine(e, named)),
  );
}
