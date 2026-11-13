import { create } from 'zustand';
import { usePlaceStore } from '../../state/places';
import { parseLink, refKey, type WatchRef } from './links';
import { loadLooks, saveLooks, stepLook, type LookSettings } from './looks';
import { addSaved, loadSaved, removeSaved, renameSaved, saveSaved, type SavedItem } from './saved';
import { stopLine, type StopReason } from './stops';

export type UnwindTab = 'listen' | 'watch';

interface WatchState {
  /** Which view Unwind shows. The one value any switch (today the tabs) sets; nothing in Watch reads where that switch is. */
  tab: UnwindTab;
  saved: SavedItem[];
  looks: LookSettings;
  /** The item in the frame, or null: no frame at all. */
  playing: SavedItem | null;
  /** The owner's own pause and mute (YouTube only); the frame's state messages may correct `paused`. */
  paused: boolean;
  muted: boolean;
  sheet: boolean;
  /** Why the last video stopped by itself, shown once in the left block until the next play. */
  stopped: string | null;
  /** The key of the row being renamed, if any. */
  editing: string | null;
  load: () => void;
  setTab: (t: UnwindTab) => void;
  /** Read and save a pasted link; returns the refusal line, or null when it was added. */
  addLink: (text: string) => string | null;
  remove: (key: string) => void;
  rename: (key: string, label: string) => void;
  setEditing: (key: string | null) => void;
  play: (ref: WatchRef) => void;
  stop: (why?: StopReason) => void;
  setPaused: (p: boolean) => void;
  setMuted: (m: boolean) => void;
  setLooks: (s: LookSettings) => void;
  stepLook: () => void;
  setSheet: (open: boolean) => void;
}

export const useWatchStore = create<WatchState>((set, get) => ({
  tab: 'listen',
  saved: loadSaved(),
  looks: loadLooks(),
  playing: null,
  paused: false,
  muted: false,
  sheet: false,
  stopped: null,
  editing: null,
  load: () => set({ saved: loadSaved(), looks: loadLooks() }),
  setTab: (tab) => {
    if (tab === get().tab) return;
    if (tab !== 'watch') get().stop('tab');
    set({ tab, sheet: false, editing: null });
  },
  addLink: (text) => {
    const parsed = parseLink(text);
    if (!parsed.ok) return parsed.error;
    const r = addSaved(get().saved, parsed.ref);
    if (!r.ok) return r.error;
    saveSaved(r.items);
    // A new item starts with its kind as its label; its name field opens so it can be named.
    set({ saved: r.items, editing: refKey(r.added) });
    return null;
  },
  remove: (key) => {
    const items = removeSaved(get().saved, key);
    saveSaved(items);
    const playing = get().playing;
    if (playing && refKey(playing) === key) get().stop();
    set({ saved: items, editing: get().editing === key ? null : get().editing });
  },
  rename: (key, label) => {
    const items = renameSaved(get().saved, key, label);
    saveSaved(items);
    const playing = get().playing;
    set({ saved: items, editing: null, playing: playing && refKey(playing) === key ? (items.find((i) => refKey(i) === key) ?? playing) : playing });
  },
  setEditing: (editing) => set({ editing }),
  play: (ref) => {
    const item = get().saved.find((i) => refKey(i) === refKey(ref));
    if (!item) return;
    set({ playing: item, paused: false, muted: false, stopped: null, tab: 'watch' });
  },
  stop: (why) => {
    if (!get().playing) return;
    set({ playing: null, paused: false, stopped: why ? stopLine(why) : null });
  },
  setPaused: (paused) => set({ paused }),
  setMuted: (muted) => set({ muted }),
  setLooks: (looks) => {
    saveLooks(looks);
    set({ looks });
  },
  stepLook: () => {
    const p = get().playing;
    if (!p) return;
    get().setLooks(stepLook(get().looks, p.kind));
  },
  setSheet: (sheet) => set({ sheet }),
}));

// Leaving Unwind (another place, Zen or Dream) removes the frame at once.
usePlaceStore.subscribe((s) => {
  if (s.active !== 'unwind') {
    useWatchStore.getState().stop('place');
    if (useWatchStore.getState().sheet) useWatchStore.setState({ sheet: false });
  }
});

/** Tests only: back to a fresh store over whatever local storage holds now. */
export function resetWatch(): void {
  useWatchStore.setState({ tab: 'listen', saved: loadSaved(), looks: loadLooks(), playing: null, paused: false, muted: false, sheet: false, stopped: null, editing: null });
}
