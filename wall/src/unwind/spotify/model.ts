import { create } from 'zustand';
import type { SpotifyItem } from '../../music/spotify';

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
export type SpotifyProblem = 'notsetup' | 'needsSignIn' | 'busy' | 'starting' | 'choose' | 'restricted' | 'nodevice' | 'notYours' | 'gone' | 'connection' | 'refused' | 'down' | `server:${number}` | `status:${number}` | 'failed';

export function spotifyProblem(e: unknown): SpotifyProblem {
  const text = (e instanceof Error ? e.message : typeof e === 'string' ? e : '').toLowerCase();
  if (text.includes('not set up')) return 'notsetup';
  if (text.includes('sign in')) return 'needsSignIn';
  if (text.includes('busy')) return 'busy';
  if (text.includes('starting')) return 'starting';
  if (text.includes('choose')) return 'choose';
  if (text.includes('restricted')) return 'restricted';
  if (text.includes('no device')) return 'nodevice';
  if (text.includes('not yours')) return 'notYours';
  if (text.includes('no longer offered')) return 'gone';
  if (text.includes('no connection')) return 'connection';
  if (text.includes('refused')) return 'refused';
  if (text.includes('down')) return 'down';
  const server = text.match(/server-(\d{3})/);
  if (server) return `server:${Number(server[1])}`;
  const status = text.match(/status-(\d{3})/);
  if (status) return `status:${Number(status[1])}`;
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
    case 'starting':
      return 'Spotify is still starting.';
    case 'choose':
      return 'More than one computer is signed in to Spotify. Pick this PC in Spotify once, then press Play.';
    case 'restricted':
      return 'Spotify on this PC does not allow remote control right now. Press Play in Spotify.';
    case 'nodevice':
      return 'Open Spotify on this PC first.';
    case 'notYours':
      return 'Spotify only lists the songs of playlists you own. Play it whole.';
    case 'gone':
      return 'Spotify no longer offers this to the wall.';
    case 'connection':
      return 'No connection to Spotify.';
    case 'refused':
      return 'Spotify refused this list.';
    case 'down':
      return 'Spotify is not answering right now.';
    default:
      if (p.startsWith('server:')) return `Spotify has a problem right now (${p.slice(7)}).`;
      if (p.startsWith('status:')) return `Spotify answered with status ${p.slice(7)}.`;
      return 'Could not read Spotify.';
  }
}

/** The one line after a play that did not start. */
export function playProblemLine(p: SpotifyProblem): string {
  if (p === 'nodevice') return 'Spotify opened but did not show up as a player. Press Play in Spotify once, then try again.';
  if (p === 'starting') return 'Spotify is still starting.';
  if (p === 'choose') return 'More than one computer is signed in to Spotify. Pick this PC in Spotify once, then press Play.';
  if (p === 'restricted') return 'Spotify on this PC does not allow remote control right now. Press Play in Spotify.';
  if (p === 'busy') return 'Spotify is busy, try in a minute.';
  if (p === 'needsSignIn') return 'Sign in to Spotify in Tools first.';
  return problemLine(p);
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

export type UpNextPlan = { kind: 'skip'; skips: number } | { kind: 'none'; line: string };

/** The quiet line when Up next cannot reach a track without replacing the queue. */
export const UP_NEXT_NONE_LINE = 'Open its list to play it';

/**
 * How Up next reaches a queued track without ever replacing the queue: by skipping forward
 * through Windows (the n-th row is n skips, never more than the queue holds), and only when
 * Spotify is the player Windows reports as current (a skip could reach another player).
 * Otherwise nothing is sent and one quiet line says why. It never starts a list: the wall
 * cannot know which list is playing, so a play with a list could replace the queue with the wrong one.
 */
export function upNextPlan(index: number, queued: number, spotifyIsCurrent: boolean): UpNextPlan {
  if (spotifyIsCurrent && queued > 0) return { kind: 'skip', skips: Math.min(index + 1, queued) };
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

/** The tall view closes by itself this long after the pointer has left the card. */
export const TALL_CLOSE_MS = 15_000;

/** A player the owner picked in "Play on": the next Play goes there. An empty id is "this PC" (Spotify is started there). */
export interface SpotifyTarget {
  id: string;
  name: string;
  kind: string;
}

interface TargetState {
  /** The owner's own pick, kept until the wall restarts. */
  target: SpotifyTarget | null;
  /** The device Spotify last said is active and allows control (what the music follows when nothing was picked). */
  activeId: string | null;
  setTarget: (t: SpotifyTarget | null) => void;
  setActiveId: (id: string | null) => void;
}

export const useSpotifyTarget = create<TargetState>((set) => ({
  target: null,
  activeId: null,
  setTarget: (target) => set({ target }),
  setActiveId: (activeId) => set({ activeId }),
}));

/** The device id a Play sends: the owner's pick, else the active device; none means "this PC" as before. */
export function playDeviceId(): string | undefined {
  const { target, activeId } = useSpotifyTarget.getState();
  if (target) return target.id || undefined;
  return activeId ?? undefined;
}

/** Tests only. */
export function resetSpotifyTarget(): void {
  useSpotifyTarget.setState({ target: null, activeId: null });
}

/** True while the wall waits for Spotify to start on this PC; `rev` changes when a play ends, so the device list is read again. */
export const useSpotifyStart = create<{ starting: boolean; rev: number }>(() => ({ starting: false, rev: 0 }));

/** "Computer", "Phone", "Speaker", or Spotify's own word for another kind. */
export function deviceKindWord(kind: string): string {
  const k = kind.toLowerCase();
  if (k === 'computer') return 'Computer';
  if (k === 'smartphone' || k === 'phone') return 'Phone';
  if (k === 'speaker') return 'Speaker';
  if (k === 'tv') return 'TV';
  if (!k || k === 'unknown') return 'Player';
  return kind;
}

/** A position (0 to 1) along the time bar as a track position, never past the end. */
export function seekPosition(fraction: number, durationMs: number): number {
  if (!Number.isFinite(fraction) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * durationMs);
}
