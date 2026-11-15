import { create } from 'zustand';
import { isKind, refKey, validId } from './links';
import type { SavedItem } from './saved';
import { useWatchStore } from './store';

/** Where the three pins are kept: an array of at most three keys (`refKey`), each null for an empty place. */
export const PINS_KEY = 'wall2-watch-pins';
export const PIN_PLACES = 3;
/** A stored value longer than this is not read at all. */
const MAX_STORED = 1000;

/** A pin's place: the key of a Watch list item, or null for an empty place. */
export type PinPlace = string | null;

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
 * refused whole), each entry null or a key of a known kind with a valid id, no key twice (the
 * second one becomes an empty place). Anything else is an empty place; a stored value over
 * 1000 characters, or one that is not an array, is not read at all.
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
    const k = v[i];
    if (!validKey(k) || seen.has(k)) continue;
    seen.add(k);
    out[i] = k;
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
 * The item for each place, from the Watch list as it is now (so a rename in the list shows on its
 * pin). A place whose item left the list is null, an empty place.
 */
export function resolvePins(places: readonly PinPlace[], saved: readonly SavedItem[]): (SavedItem | null)[] {
  const byKey = new Map(saved.map((i) => [refKey(i), i] as const));
  return Array.from({ length: PIN_PLACES }, (_, i) => {
    const k = places[i];
    return (k && byKey.get(k)) || null;
  });
}

/** The places with every key that is no longer in the Watch list dropped (what a write keeps). */
export function dropGone(places: readonly PinPlace[], saved: readonly SavedItem[]): PinPlace[] {
  const keys = new Set(saved.map(refKey));
  return Array.from({ length: PIN_PLACES }, (_, i) => {
    const k = places[i];
    return k && keys.has(k) ? k : null;
  });
}

/** Pin `key` in place `index` (an item already pinned elsewhere moves there). Unknown items change nothing. */
export function withPin(places: readonly PinPlace[], saved: readonly SavedItem[], index: number, key: string): PinPlace[] {
  if (index < 0 || index >= PIN_PLACES || !saved.some((i) => refKey(i) === key)) return dropGone(places, saved);
  const next = dropGone(places, saved).map((k) => (k === key ? null : k));
  next[index] = key;
  return next;
}

/** Empty place `index`. */
export function withoutPin(places: readonly PinPlace[], saved: readonly SavedItem[], index: number): PinPlace[] {
  const next = dropGone(places, saved);
  if (index >= 0 && index < PIN_PLACES) next[index] = null;
  return next;
}

/** The Watch list items the add and replace menus offer: every item not already pinned. */
export function pinnable(places: readonly PinPlace[], saved: readonly SavedItem[]): SavedItem[] {
  const pinned = new Set(places.filter((k): k is string => !!k));
  return saved.filter((i) => !pinned.has(refKey(i)));
}

interface PinsState {
  places: PinPlace[];
  load: () => void;
  pin: (index: number, key: string) => void;
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
