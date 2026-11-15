import { create } from 'zustand';
import { MAX_SAVED, cleanText, ADD_ERRORS } from './saved';
import { refKey, validId } from './links';
import { useWatchStore } from './store';

/**
 * The videos of the playlists made on the wall (what the Watch list's `own` entries hold).
 *
 * The saved list (`wall2-watch-list`) keeps only an entry per playlist: kind `own`, a 12 character id
 * made here, and the name. The videos live in a second key, `wall2-watch-playlists`, so each key is read
 * and checked on its own and a damaged saved list never takes the videos with it. Everything stays on this
 * PC; nothing is sent anywhere and nothing is created on YouTube.
 *
 * A list is its videos in order (at most 50), with the owner's switches for shuffle and repeat. A video
 * holds its YouTube id and, once the player has reported them, a title, a channel and a length in seconds.
 * The stored value is read tolerantly (`parseOwn`): a value that is too long, not JSON or not version 1 is
 * an empty store; otherwise each list is read on its own and a bad list is dropped, not the whole value.
 * A record with no `own` entry in the saved list is ignored (never shown) and kept as stored.
 */

export const OWN_KEY = 'wall2-watch-playlists';
/** A stored value longer than this is not read at all. */
export const MAX_OWN_STORED = 600_000;
export const MAX_OWN_VIDEOS = 50;
/** At most this many list records are written back; records with an entry come first. */
export const MAX_OWN_RECORDS = 48;
const MAX_TITLE = 200;
const MAX_CHANNEL = 100;
const MAX_SECONDS = 86_400;
const OWN_ID = /^[a-z0-9]{12}$/;

export interface OwnVideo {
  id: string;
  title?: string;
  channel?: string;
  seconds?: number;
}

export interface OwnList {
  items: OwnVideo[];
  shuffle: boolean;
  repeat: boolean;
}

/** The lists by id; a plain object with no prototype, so a stored key such as `__proto__` is only a key. */
export type OwnLists = Record<string, OwnList>;

export interface OwnStore {
  v: 1;
  lists: OwnLists;
}

export const OWN_ERRORS = {
  dup: 'That video is already in this playlist.',
  full: `This playlist is full (${MAX_OWN_VIDEOS}). Remove one first.`,
} as const;

const emptyLists = (): OwnLists => Object.create(null) as OwnLists;

function cleanSeconds(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_SECONDS ? v : undefined;
}

/** One video from untrusted data; null when its id does not have the video shape. */
function readVideo(e: unknown): OwnVideo | null {
  if (!e || typeof e !== 'object') return null;
  const r = e as Record<string, unknown>;
  if (!validId('video', r.id)) return null;
  const out: OwnVideo = { id: r.id };
  const title = cleanText(r.title, MAX_TITLE);
  if (title) out.title = title;
  const channel = cleanText(r.channel, MAX_CHANNEL);
  if (channel) out.channel = channel;
  const seconds = cleanSeconds(r.seconds);
  if (seconds !== undefined) out.seconds = seconds;
  return out;
}

function readList(v: unknown): OwnList | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.items)) return null;
  const items: OwnVideo[] = [];
  const seen = new Set<string>();
  for (const e of r.items) {
    if (items.length >= MAX_OWN_VIDEOS) break;
    const video = readVideo(e);
    if (!video || seen.has(video.id)) continue;
    seen.add(video.id);
    items.push(video);
  }
  return { items, shuffle: r.shuffle === true, repeat: r.repeat === true };
}

/** The stored value, read tolerantly (see the top of this file). */
export function parseOwn(raw: string | null): OwnStore {
  const none: OwnStore = { v: 1, lists: emptyLists() };
  if (!raw || raw.length > MAX_OWN_STORED) return none;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return none;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return none;
  const top = v as Record<string, unknown>;
  if (top.v !== 1 || !top.lists || typeof top.lists !== 'object' || Array.isArray(top.lists)) return none;
  const lists = emptyLists();
  for (const key of Object.keys(top.lists)) {
    if (!OWN_ID.test(key)) continue;
    const list = readList((top.lists as Record<string, unknown>)[key]);
    if (list) lists[key] = list;
  }
  return { v: 1, lists };
}

export function loadOwn(): OwnLists {
  try {
    return parseOwn(localStorage.getItem(OWN_KEY)).lists;
  } catch {
    return emptyLists();
  }
}

/** The ids of the playlists the saved list holds an entry for. */
function entryIds(): Set<string> {
  const ids = new Set<string>();
  for (const i of useWatchStore.getState().saved) if (i.kind === 'own') ids.add(i.id);
  return ids;
}

/** Write the lists: at most 48 records, those with an entry first. A failed write keeps the session's copy. */
export function saveOwn(lists: OwnLists): void {
  const keep = entryIds();
  const keys = Object.keys(lists);
  const ordered = [...keys.filter((k) => keep.has(k)), ...keys.filter((k) => !keep.has(k))].slice(0, MAX_OWN_RECORDS);
  const out = emptyLists();
  for (const k of ordered) out[k] = lists[k];
  try {
    localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: out }));
  } catch {
    /* the lists stay for this session */
  }
}

/** A new playlist id: 12 base 36 characters from the browser's random source. */
export function newOwnId(): string {
  const bytes = new Uint8Array(12);
  let out = '';
  while (out.length < 12) {
    crypto.getRandomValues(bytes);
    // 252 is the largest multiple of 36 below 256: bytes above it are skipped so no character is likelier.
    for (const b of bytes) if (b < 252 && out.length < 12) out += (b % 36).toString(36);
  }
  return out;
}

export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export interface OwnState {
  lists: OwnLists;
  /** The playlist in the editor, or null. */
  open: string | null;
  load: () => void;
  /** Make a playlist (an entry in the saved list and its record), with `first` in it when given. */
  create: (name: string, first?: OwnVideo) => CreateResult;
  /** The refusal line, or null when added. */
  addVideo: (listId: string, video: OwnVideo) => string | null;
  removeVideo: (listId: string, videoId: string) => void;
  move: (listId: string, from: number, to: number) => void;
  setShuffle: (listId: string, on: boolean) => void;
  setRepeat: (listId: string, on: boolean) => void;
  /** Fill only the absent fields of every item with this id, in every list; writes only when something changed. */
  learn: (videoId: string, info: { title?: string; channel?: string; seconds?: number }) => void;
  /** Remove the record and the saved entry together. */
  deleteList: (id: string) => void;
  setOpen: (id: string | null) => void;
}

function patch(lists: OwnLists, id: string, list: OwnList): OwnLists {
  const next = emptyLists();
  for (const k of Object.keys(lists)) next[k] = lists[k];
  next[id] = list;
  return next;
}

export const useOwnLists = create<OwnState>((set, get) => {
  const commit = (lists: OwnLists) => {
    saveOwn(lists);
    set({ lists });
  };
  return {
    lists: loadOwn(),
    open: null,
    load: () => set({ lists: loadOwn() }),
    create: (name, first) => {
      const watch = useWatchStore.getState();
      if (watch.saved.length >= MAX_SAVED) return { ok: false, error: ADD_ERRORS.full };
      let id = newOwnId();
      while (get().lists[id] || watch.saved.some((i) => refKey(i) === `own:${id}`)) id = newOwnId();
      const err = watch.addRef({ kind: 'own', id }, false);
      if (err) return { ok: false, error: err };
      watch.rename(`own:${id}`, name);
      const video = first ? readVideo(first) : null;
      commit(patch(get().lists, id, { items: video ? [video] : [], shuffle: false, repeat: false }));
      return { ok: true, id };
    },
    addVideo: (listId, video) => {
      const list = get().lists[listId];
      const v = readVideo(video);
      if (!list || !v) return 'That video cannot go in a playlist.';
      if (list.items.some((i) => i.id === v.id)) return OWN_ERRORS.dup;
      if (list.items.length >= MAX_OWN_VIDEOS) return OWN_ERRORS.full;
      commit(patch(get().lists, listId, { ...list, items: [...list.items, v] }));
      return null;
    },
    removeVideo: (listId, videoId) => {
      const list = get().lists[listId];
      if (!list || !list.items.some((i) => i.id === videoId)) return;
      commit(patch(get().lists, listId, { ...list, items: list.items.filter((i) => i.id !== videoId) }));
    },
    move: (listId, from, to) => {
      const list = get().lists[listId];
      if (!list || from === to || from < 0 || to < 0 || from >= list.items.length || to >= list.items.length) return;
      const items = [...list.items];
      const [one] = items.splice(from, 1);
      items.splice(to, 0, one);
      commit(patch(get().lists, listId, { ...list, items }));
    },
    setShuffle: (listId, on) => {
      const list = get().lists[listId];
      if (!list || list.shuffle === on) return;
      commit(patch(get().lists, listId, { ...list, shuffle: on }));
    },
    setRepeat: (listId, on) => {
      const list = get().lists[listId];
      if (!list || list.repeat === on) return;
      commit(patch(get().lists, listId, { ...list, repeat: on }));
    },
    learn: (videoId, info) => {
      const title = cleanText(info.title, MAX_TITLE);
      const channel = cleanText(info.channel, MAX_CHANNEL);
      const seconds = cleanSeconds(info.seconds);
      if (!title && !channel && seconds === undefined) return;
      const cur = get().lists;
      let changed = false;
      const next = emptyLists();
      for (const k of Object.keys(cur)) {
        const list = cur[k];
        let listChanged = false;
        const items = list.items.map((i) => {
          if (i.id !== videoId) return i;
          const n = { ...i };
          if (!n.title && title) n.title = title;
          if (!n.channel && channel) n.channel = channel;
          if (n.seconds === undefined && seconds !== undefined) n.seconds = seconds;
          if (n.title !== i.title || n.channel !== i.channel || n.seconds !== i.seconds) {
            listChanged = true;
            return n;
          }
          return i;
        });
        next[k] = listChanged ? { ...list, items } : list;
        if (listChanged) changed = true;
      }
      if (changed) commit(next);
    },
    deleteList: (id) => {
      const cur = get().lists;
      if (cur[id]) {
        const next = emptyLists();
        for (const k of Object.keys(cur)) if (k !== id) next[k] = cur[k];
        // The entry goes first, so the write keeps no record for it.
        useWatchStore.getState().remove(`own:${id}`);
        commit(next);
      } else useWatchStore.getState().remove(`own:${id}`);
      if (get().open === id) set({ open: null });
    },
    setOpen: (open) => set({ open }),
  };
});

/** Tests only: back to what local storage holds now. */
export function resetOwnLists(): void {
  useOwnLists.setState({ lists: loadOwn(), open: null });
}

/** The saved entries that are playlists made on the wall, in list order. */
export function ownEntries(saved: readonly { kind: string; id: string; label: string }[]): { id: string; label: string }[] {
  return saved.filter((i) => i.kind === 'own').map((i) => ({ id: i.id, label: i.label }));
}

export const EMPTY_LIST: OwnList = { items: [], shuffle: false, repeat: false };
