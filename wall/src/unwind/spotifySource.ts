import { useEffect } from 'react';
import { create } from 'zustand';
import { spotify } from '../music/spotify';

/** The song Spotify itself confirmed it was playing, for a media session whose app id names no known player. */
interface Seen {
  title: string;
  artist: string;
}

export const useSpotifySeen = create<{ seen: Seen | null }>(() => ({ seen: null }));

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** True when this title (and artist, when both are known) is the song Spotify confirmed playing. */
export function isSpotifySong(seen: Seen | null, title: string | null | undefined, artist?: string | null): boolean {
  if (!seen || !norm(title) || norm(seen.title) !== norm(title)) return false;
  return !norm(artist) || !norm(seen.artist) || norm(seen.artist) === norm(artist);
}

/**
 * Spotify played in a browser's installed web app reports the browser's raw app id, which says nothing. When the session
 * is such an unnamed one, ask Spotify (only when it is set up and signed in) which song it plays; when that is this
 * session's title the source really is Spotify. A failed or empty answer keeps the neutral words.
 */
export function useConfirmSpotify(title: string | null | undefined, unnamed: boolean): void {
  useEffect(() => {
    if (!unnamed || !title) return;
    let live = true;
    spotify.playback().then(
      (p) => {
        const t = p?.track;
        if (live && t && norm(t.name) === norm(title)) useSpotifySeen.setState({ seen: { title: t.name, artist: t.artists } });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [title, unnamed]);
}
