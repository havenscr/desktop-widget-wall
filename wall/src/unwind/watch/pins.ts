import { create } from 'zustand';
import { isKind, kindName, refKey, validId, type WatchKind } from './links';
import { cleanText, MAX_LABEL, type SavedItem } from './saved';
import { ownThumb } from './OwnParts';
import { useWatchStore } from './store';

/** Where the three pins are kept: an array of at most three keys (`refKey`), each null for an empty place. */
export const PINS_KEY = 'wall2-watch-pins';
export const PIN_PLACES = 3;
/**
 * A stored value longer than this is not read at all. The worst case is three library objects of about 400
 * characters each (a 16 character kind, a 22 character id, a 60 character name whose characters each need
 * a JSON escape, a 200 character cover address), about 1,200 in all; 2000 holds that with room.
 */
const MAX_STORED = 2000;

/** What a library pin can be: a Spotify playlist or album, or a YouTube video, live stream or playlist. */
export type PinKind = 'spotify-playlist' | 'spotify-album' | 'video' | 'live' | 'playlist';
export const PIN_KINDS: readonly PinKind[] = ['spotify-playlist', 'spotify-album', 'video', 'live', 'playlist'];

/** A pin made from a library panel: its kind, its id, its name and (Spotify kinds and YouTube playlists) a checked cover address. */
export interface LibraryPin {
  kind: PinKind;
  id: string;
  name: string;
  art?: string;
}

/** A pin's place: the key of a Watch list item, a library pin, or null for an empty place. */
export type PinPlace = string | LibraryPin | null;

/** Spotify ids: exactly 22 ASCII letters or digits (mirrors `valid_id` in `wall2_spotify.rs`). */
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
/**
 * A stored cover address is at most 200 characters: real Spotify picture addresses are about 64, and 200 keeps
 * three objects under the storage cap. (The Rust side accepts up to 2048; this is the stricter stored limit.)
 */
const MAX_ART = 200;
/** A YouTube playlist's picture, in the one shape `playlist_thumb` in `wall2_youtube.rs` rebuilds every picture into. */
const PLAYLIST_ART = /^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/mqdefault\.jpg$/;

/**
 * True for a Spotify picture address by the rules `valid_image` and `spotify_image_host` apply in Rust: it
 * parses, is `https`, has no explicit port, no user name or password, and its lower-cased host ends in
 * `.scdn.co` or `.spotifycdn.com` with a non-empty prefix on a label boundary, no trailing dot, no empty label.
 */
export function validSpotifyImage(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > MAX_ART) return false;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return false;
  const host = u.hostname.toLowerCase();
  if (!host || host.endsWith('.') || host.split('.').some((l) => l === '')) return false;
  return ['.scdn.co', '.spotifycdn.com'].some((parent) => host.endsWith(parent) && host.length > parent.length);
}

/** True for a YouTube playlist picture address in the exact `mqdefault` shape. */
export function validPlaylistArt(s: unknown): s is string {
  return typeof s === 'string' && s.length <= MAX_ART && PLAYLIST_ART.test(s);
}

/** True when `id` is a valid id for a pin of this kind. */
export function validPinId(kind: PinKind, id: unknown): id is string {
  if (kind === 'spotify-playlist' || kind === 'spotify-album') return typeof id === 'string' && SPOTIFY_ID.test(id);
  return validId(kind, id);
}

/** The kind's word for a library pin's tip and word fallback. */
export function pinKindName(kind: PinKind | WatchKind): string {
  if (kind === 'spotify-playlist') return 'Spotify playlist';
  if (kind === 'spotify-album') return 'Spotify album';
  return kindName(kind);
}

/** The key of a library pin: for YouTube kinds it equals the Watch list `refKey` of the same item. */
export function pinKey(p: { kind: PinKind; id: string }): string {
  return `${p.kind}:${p.id}`;
}

/** A library pin built from raw parts and checked, or null when its kind or id is not valid. A bad cover drops the field only. */
export function makeLibraryPin(raw: unknown): LibraryPin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== 'string' || !(PIN_KINDS as readonly string[]).includes(kind)) return null;
  const k = kind as PinKind;
  if (!validPinId(k, r.id)) return null;
  const out: LibraryPin = { kind: k, id: r.id, name: cleanText(r.name, MAX_LABEL) || pinKindName(k) };
  const spotify = k === 'spotify-playlist' || k === 'spotify-album';
  if ((spotify && validSpotifyImage(r.art)) || (k === 'playlist' && validPlaylistArt(r.art))) out.art = r.art as string;
  return out;
}

/** The key of any place, or null for an empty one. */
export function placeKey(p: PinPlace): string | null {
  return p === null ? null : typeof p === 'string' ? p : pinKey(p);
}

const EMPTY: readonly PinPlace[] = Object.freeze([null, null, null]);

/** True for a key of a known kind with an id of that kind's exact shape. */
function validKey(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 80) return false;
  const at = v.indexOf(':');
  if (at < 1) return false;
  const kind = v.slice(0, at);
  return isKind(kind) && validId(kind, v.slice(at + 1));
}

/**
 * The pins from their stored text, checked whole on every read: an array (one of more than three is
 * refused whole), each entry null, a Watch list key of a known kind with a valid id, or a library object
 * checked as strictly (`makeLibraryPin`), no key twice (the second one becomes an empty place). Anything
 * else is an empty place; a stored value over 2000 characters, or one that is not an array, is not read at all.
 */
export function parsePins(raw: string | null): PinPlace[] {
  const out: PinPlace[] = [null, null, null];
  if (!raw || raw.length > MAX_STORED) return out;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!Array.isArray(v)) return out;
  const seen = new Set<string>();
  if (v.length > PIN_PLACES) return out;
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    const place = typeof e === 'string' ? (validKey(e) ? e : null) : makeLibraryPin(e);
    const key = placeKey(place);
    if (!place || !key || seen.has(key)) continue;
    seen.add(key);
    out[i] = place;
  }
  return out;
}

export function loadPins(): PinPlace[] {
  try {
    return parsePins(localStorage.getItem(PINS_KEY));
  } catch {
    return [...EMPTY];
  }
}

function savePins(places: readonly PinPlace[]): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(places.slice(0, PIN_PLACES)));
  } catch {
    /* the pins stay for this session */
  }
}

/**
 * The Watch list item for each string place, from the list as it is now (so a rename in the list shows on its
 * pin). A string place whose item left the list is null, an empty place; a library object is null here (see `displayPins`).
 */
export function resolvePins(places: readonly PinPlace[], saved: readonly SavedItem[]): (SavedItem | null)[] {
  const byKey = new Map(saved.map((i) => [refKey(i), i] as const));
  return Array.from({ length: PIN_PLACES }, (_, i) => {
    const k = places[i];
    return (typeof k === 'string' && byKey.get(k)) || null;
  });
}

/** What a pin draws and plays: one shape for a Watch list item and a library object. */
export interface PinShown {
  key: string;
  kind: PinKind | WatchKind;
  id: string;
  name: string;
  /** The cover address, or null for the gradient and glyph. Twitch never has one. */
  art: string | null;
  from: 'watch' | 'library';
}

/**
 * The display of each place. A string place is its Watch list item (null once the item left the list); a library object is
 * itself, and when its YouTube key is also in the Watch list the list's label wins (a rename shows). Videos and live streams
 * (from either source) take their picture from the id through `ownThumb`; a Spotify kind or YouTube playlist takes its stored cover.
 */
export function displayPins(places: readonly PinPlace[], saved: readonly SavedItem[]): (PinShown | null)[] {
  const byKey = new Map(saved.map((i) => [refKey(i), i] as const));
  return Array.from({ length: PIN_PLACES }, (_, i): PinShown | null => {
    const p = places[i];
    if (!p) return null;
    if (typeof p === 'string') {
      const item = byKey.get(p);
      if (!item) return null;
      const art = item.kind === 'video' || item.kind === 'live' ? ownThumb.url(item.id) : null;
      return { key: p, kind: item.kind, id: item.id, name: item.label, art, from: 'watch' };
    }
    const key = pinKey(p);
    const listed = byKey.get(key);
    const art = p.kind === 'video' || p.kind === 'live' ? ownThumb.url(p.id) : (p.art ?? null);
    return { key, kind: p.kind, id: p.id, name: listed?.label ?? p.name, art, from: 'library' };
  });
}

/** The places with every Watch list key that is no longer in the list dropped (what a write keeps). Library objects never depend on the list. */
export function dropGone(places: readonly PinPlace[], saved: readonly SavedItem[]): PinPlace[] {
  const keys = new Set(saved.map(refKey));
  return Array.from({ length: PIN_PLACES }, (_, i) => {
    const k = places[i];
    if (k && typeof k === 'object') return k;
    return k && keys.has(k) ? k : null;
  });
}

/** Pin `key` in place `index` (an item already pinned elsewhere moves there). Unknown items change nothing. */
export function withPin(places: readonly PinPlace[], saved: readonly SavedItem[], index: number, key: string): PinPlace[] {
  // A playlist made on the wall is never pinned (a pin plays through `play`, and an own entry is never in the frame).
  if (index < 0 || index >= PIN_PLACES || key.startsWith('own:') || !saved.some((i) => refKey(i) === key)) return dropGone(places, saved);
  const next = dropGone(places, saved).map((k) => (placeKey(k) === key ? null : k));
  next[index] = key;
  return next;
}

/** The index that holds `key`, or -1. */
export function pinnedAt(places: readonly PinPlace[], key: string): number {
  return places.findIndex((p) => placeKey(p) === key);
}

/**
 * Pin a library item in place `index`, replacing whatever is there. An invalid entry, an invalid index, or a key already
 * in any place changes nothing (beyond `dropGone`).
 */
export function withLibraryPin(places: readonly PinPlace[], saved: readonly SavedItem[], index: number, entry: unknown): PinPlace[] {
  const base = dropGone(places, saved);
  const pin = makeLibraryPin(entry);
  if (!pin || !Number.isInteger(index) || index < 0 || index >= PIN_PLACES || pinnedAt(base, pinKey(pin)) >= 0) return base;
  base[index] = pin;
  return base;
}

/** Empty place `index`. */
export function withoutPin(places: readonly PinPlace[], saved: readonly SavedItem[], index: number): PinPlace[] {
  const next = dropGone(places, saved);
  if (index >= 0 && index < PIN_PLACES) next[index] = null;
  return next;
}

/** The Watch list items the add and replace menus offer: every item not already pinned (from either source), and no playlist made on the wall. */
export function pinnable(places: readonly PinPlace[], saved: readonly SavedItem[]): SavedItem[] {
  const pinned = new Set(places.map(placeKey).filter((k): k is string => !!k));
  return saved.filter((i) => i.kind !== 'own' && !pinned.has(refKey(i)));
}

/**
 * Library pins whose key matches an item of a loaded list take the list's cleaned name and checked cover when either
 * differs. Returns the same array when nothing changes (so one write, or none).
 */
export function refreshLibraryPins(places: readonly PinPlace[], fresh: readonly { kind: PinKind; id: string; name: string; art?: string | null }[]): PinPlace[] {
  let changed = false;
  const next = places.map((p) => {
    if (!p || typeof p === 'string') return p;
    const f = fresh.find((x) => x.kind === p.kind && x.id === p.id);
    if (!f) return p;
    const q = makeLibraryPin({ kind: p.kind, id: p.id, name: f.name, art: f.art ?? undefined });
    if (!q) return p;
    // A list without a good cover keeps the stored one.
    if (!q.art && p.art) q.art = p.art;
    if (q.name === p.name && q.art === p.art) return p;
    changed = true;
    return q;
  });
  return changed ? next : (places as PinPlace[]);
}

interface PinsState {
  places: PinPlace[];
  load: () => void;
  pin: (index: number, key: string) => void;
  /** Pin a library item (checked) in place `index`; an item already pinned changes nothing. */
  pinLibrary: (index: number, entry: unknown) => void;
  /** A loaded library list names the pins it holds again: names and covers refresh in one write. */
  refresh: (fresh: readonly { kind: PinKind; id: string; name: string; art?: string | null }[]) => void;
  unpin: (index: number) => void;
}

export const usePins = create<PinsState>((set, get) => ({
  places: loadPins(),
  load: () => set({ places: loadPins() }),
  pin: (index, key) => {
    const places = withPin(get().places, useWatchStore.getState().saved, index, key);
    savePins(places);
    set({ places });
  },
  pinLibrary: (index, entry) => {
    const places = withLibraryPin(get().places, useWatchStore.getState().saved, index, entry);
    savePins(places);
    set({ places });
  },
  refresh: (fresh) => {
    const cur = get().places;
    const places = refreshLibraryPins(cur, fresh);
    if (places === cur) return;
    savePins(places);
    set({ places });
  },
  unpin: (index) => {
    const places = withoutPin(get().places, useWatchStore.getState().saved, index);
    savePins(places);
    set({ places });
  },
}));

/** Tests only: back to what storage holds now. */
export function resetPins(): void {
  usePins.setState({ places: loadPins() });
}

/** A hue 0 to 359 from a key, the same every time (a small string hash). */
export function artHue(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

/** The art square's gradient for a key: three stops from its hue (drawn, never fetched). */
export function artBackground(key: string): string {
  const h = artHue(key);
  return `linear-gradient(135deg, hsl(${h} 85% 60%), hsl(${(h + 250) % 360} 70% 22%) 60%, hsl(${(h + 150) % 360} 80% 52%))`;
}
