import { create } from 'zustand';
import type { SpotifyItem, SpotifyTrack } from '../../music/spotify';

/** Which player Unwind's card follows: Spotify (browse and play) or YouTube Music (through Windows). */
export type ListenSource = 'spotify' | 'youtube';
export const LISTEN_SOURCE_KEY = 'wall2-unwind-source';

function readSource(): ListenSource {
  try {
    return window.localStorage.getItem(LISTEN_SOURCE_KEY) === 'youtube' ? 'youtube' : 'spotify';
  } catch {
    return 'spotify';
  }
}

interface SourceState {
  source: ListenSource;
  setSource: (s: ListenSource) => void;
}

/** The switch on top of the card, kept per display in local storage (blocked storage keeps Spotify). */
export const useListenSource = create<SourceState>((set) => ({
  source: readSource(),
  setSource: (source) => {
    try {
      window.localStorage.setItem(LISTEN_SOURCE_KEY, source);
    } catch {
      /* storage can be blocked; the choice then lasts until the wall restarts */
    }
    set({ source });
  },
}));

/** Tests only: read the stored choice again. */
export function resetListenSource(): void {
  useListenSource.setState({ source: readSource() });
}

/** What went wrong with a Spotify call, from the bridge's error text. */
export type SpotifyProblem = 'notsetup' | 'needsSignIn' | 'busy' | 'nodevice' | 'down' | 'failed';

export function spotifyProblem(e: unknown): SpotifyProblem {
  const text = (e instanceof Error ? e.message : typeof e === 'string' ? e : '').toLowerCase();
  if (text.includes('not set up')) return 'notsetup';
  if (text.includes('sign in')) return 'needsSignIn';
  if (text.includes('busy')) return 'busy';
  if (text.includes('no device')) return 'nodevice';
  if (text.includes('down')) return 'down';
  return 'failed';
}

/** The one line the card shows for a problem with a list read. */
export function problemLine(p: SpotifyProblem): string {
  switch (p) {
    case 'notsetup':
      return 'Spotify is not set up on this wall.';
    case 'needsSignIn':
      return 'Sign in to Spotify in Tools to browse here.';
    case 'busy':
      return 'Spotify is busy, try in a minute.';
    case 'nodevice':
      return 'Open Spotify on this PC first.';
    case 'down':
      return 'Spotify is not answering right now.';
    default:
      return 'Could not read Spotify.';
  }
}

/** The one line after a play that did not start. */
export function playProblemLine(p: SpotifyProblem): string {
  if (p === 'nodevice') return 'Open Spotify on this PC first, then try again.';
  if (p === 'busy') return 'Spotify is busy, try in a minute.';
  if (p === 'needsSignIn') return 'Sign in to Spotify in Tools first.';
  return 'Spotify did not start it.';
}

/** "Playlist, the owner · 58 songs", "Aurora Set · 12 songs", or the subtitle alone. */
export function itemLine(item: SpotifyItem): string {
  const parts: string[] = [];
  if (item.subtitle) parts.push(item.subtitle);
  else if (item.kind === 'album') parts.push('Album');
  else if (item.kind === 'playlist') parts.push('Playlist');
  if (item.count !== null && item.kind !== 'track') parts.push(songs(item.count));
  return parts.join(' · ');
}

export function songs(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'song' : 'songs'}`;
}

/** "3:05" for a track length; "1:02:10" past an hour. */
export function trackLength(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Search waits this long after the last key (or runs on Enter), with at least two characters. */
export const SEARCH_WAIT_MS = 400;
export const SEARCH_MIN = 2;

/** The list the wall last started a song from, and the ids of the songs read from it. */
interface ContextState {
  context: { kind: 'playlist' | 'album'; id: string } | null;
  ids: ReadonlySet<string>;
  remember: (context: { kind: 'playlist' | 'album'; id: string }, tracks: readonly SpotifyTrack[]) => void;
}

export const useLastContext = create<ContextState>((set) => ({
  context: null,
  ids: new Set(),
  remember: (context, tracks) => set({ context, ids: new Set(tracks.map((t) => t.id).filter((id): id is string => !!id)) }),
}));

export type UpNextPlan =
  | { kind: 'context'; context: { kind: 'playlist' | 'album'; id: string }; offsetId: string }
  | { kind: 'skip'; skips: number }
  | { kind: 'none'; line: string };

/** The quiet line when Up next cannot reach a track without replacing the queue. */
export const UP_NEXT_NONE_LINE = 'Open its list to play it';

/**
 * How Up next reaches a queued track without ever replacing the queue. In its list (context and
 * offset) only when the wall started that list, read this track from it, and the song Spotify is
 * playing now is in it too (so that list is what plays). Otherwise by skipping forward through
 * Windows, but only when Spotify is the player Windows reports as current (a skip could reach
 * another player). Otherwise nothing is sent and one quiet line says why.
 */
export function upNextPlan(id: string | null, index: number, last: Pick<ContextState, 'context' | 'ids'>, playingId: string | null, spotifyIsCurrent: boolean): UpNextPlan {
  if (id && playingId && last.context && last.ids.has(id) && last.ids.has(playingId)) return { kind: 'context', context: last.context, offsetId: id };
  if (spotifyIsCurrent) return { kind: 'skip', skips: index + 1 };
  return { kind: 'none', line: UP_NEXT_NONE_LINE };
}

/** The song Spotify is playing, by id, from the last playback or queue read (null when unknown). */
export const useSpotifyNow = create<{ id: string | null }>(() => ({ id: null }));

/**
 * Whether a row is the song playing now: by track id when a Spotify read gave one, else by the
 * title and the artist Windows reports (never the title alone, so two songs of one name are not
 * both marked).
 */
export function isNowPlaying(t: { id: string | null; name: string; artists?: string | null }, nowId: string | null, title: string, artist: string): boolean {
  if (nowId) return !!t.id && t.id === nowId;
  if (!title || !artist || !t.artists) return false;
  return t.name === title && t.artists.toLowerCase().includes(artist.toLowerCase());
}

/**
 * The kind and owner or artist said once: "Playlist by Robin Vale", "Playlist", "Album by
 * Aurora Set", "Song by Mira Vale". The bridge's playlist subtitle is "Playlist" or
 * "Playlist, <owner>", so the kind word is never repeated.
 */
export function kindLine(item: SpotifyItem): string {
  const word = item.kind === 'track' ? 'Song' : item.kind === 'album' ? 'Album' : 'Playlist';
  const sub = (item.subtitle ?? '').trim();
  if (!sub) return word;
  if (item.kind === 'playlist') {
    if (/^playlist$/i.test(sub)) return word;
    const owner = sub.replace(/^playlist,\s*/i, '');
    return `${word} by ${owner}`;
  }
  return `${word} by ${sub}`;
}

/** The second line under a tile: the song count when known, else the owner or artist. */
export function tileLine(item: SpotifyItem): string {
  if (item.count !== null && item.kind !== 'track') return songs(item.count);
  return kindLine(item);
}
