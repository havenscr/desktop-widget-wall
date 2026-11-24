import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { playerName } from '../music/players';
import { spotify } from '../music/spotify';
import { spotifyReady, useSpotifyStatus } from './spotify/status';

/** The song Spotify itself confirmed for one source, kept only for the at-rest line after the session ends. */
interface Seen {
  source: string;
  title: string;
  artist: string;
}

export const useSpotifySeen = create<{ seen: Seen | null }>(() => ({ seen: null }));

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** One session's identity: its source id, title and artist. A later session from another app never shares it. */
const keyOf = (source: string | null | undefined, title: string | null | undefined, artist: string | null | undefined) =>
  [norm(source), norm(title), norm(artist)].join('\u0000');

/**
 * True when the saved confirmation is for this very source and song. The at-rest line has only the saved record, so it
 * needs the artist on both sides; a record without one is never labelled.
 */
export function isSpotifySong(seen: Seen | null, source: string | null | undefined, title: string | null | undefined, artist: string | null | undefined): boolean {
  if (!seen || !norm(source) || !norm(title) || !norm(artist) || !norm(seen.artist)) return false;
  return norm(seen.source) === norm(source) && norm(seen.title) === norm(title) && norm(seen.artist) === norm(artist);
}

/**
 * Spotify played in a browser's installed web app reports the browser's raw app id, which says nothing. When the session
 * is such an unnamed one and Spotify is set up and signed in, ask Spotify which song it plays; only a playing answer
 * with this session's title (and artist, when both sides have one) makes the source Spotify. The answer belongs to the
 * session it was asked for: any new session, failed, empty, paused or different answer leaves it false.
 */
export function useConfirmSpotify(source: string | null | undefined, title: string | null | undefined, artist: string | null | undefined, unnamed: boolean): boolean {
  const ready = useSpotifyStatus(spotifyReady);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const key = keyOf(source, title, artist);
  useEffect(() => {
    setConfirmed(null);
    // A live session of another source or song makes the kept record stale; with no session the record is all the at-rest line has.
    const kept = useSpotifySeen.getState().seen;
    if (kept && title && (norm(kept.source) !== norm(playerName(source)) || norm(kept.title) !== norm(title))) useSpotifySeen.setState({ seen: null });
    if (!unnamed || !title || !ready) return;
    let live = true;
    const unconfirmed = () => {
      if (live) setConfirmed(null);
    };
    spotify.playback().then((p) => {
      if (!live) return;
      const t = p?.track;
      if (!p || p.playing !== true || !t || norm(t.name) !== norm(title) || (norm(artist) && norm(t.artists) && norm(t.artists) !== norm(artist))) {
        unconfirmed();
        // A different song, or none, on that source: the kept record is stale.
        const kept = useSpotifySeen.getState().seen;
        if (kept && norm(kept.source) === norm(playerName(source)) && p?.playing === true && t && norm(t.name) !== norm(kept.title)) useSpotifySeen.setState({ seen: null });
        return;
      }
      setConfirmed(key);
      if (norm(t.artists) && playerName(source)) useSpotifySeen.setState({ seen: { source: playerName(source) ?? '', title: t.name, artist: t.artists } });
    }, unconfirmed);
    return () => {
      live = false;
    };
  }, [key, unnamed, ready, source, title, artist]);
  return confirmed === key;
}
