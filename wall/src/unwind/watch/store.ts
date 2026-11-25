import { create } from 'zustand';
import { usePlaceStore } from '../../state/places';
import { defaultLabel, parseLink, refKey, validId, type WatchRef } from './links';
import { playerLink } from './playerLink';
import { useWatchRest } from './rest';
import { PLAYER_VOLUME } from './urls';
import { driveInMode } from './DriveInFrame';
import { DRIVE_IN_SCREEN, lookFor, loadLooks, saveLooks, type LookId, type LookSettings, type WallRect } from './looks';
import { lookBox, loadTune, resetLook, saveTune, withPatch, type LookTune } from './lookSettings';

/** Real titles that arrived while that item's name field was open, by item key; applied when the field closes (a typed name still wins). */
const waitingTitles = new Map<string, string>();

/** A slider's steps update the stage at once but are written to storage at most this often (and on release, blur, settle and hide). */
export const TUNE_WRITE_MS = 300;
let tuneTimer: ReturnType<typeof setTimeout> | null = null;
let tuneDirty = false;

/** Write the settings now if a change waits to be written. */
export function flushTune(): void {
  if (tuneTimer !== null) clearTimeout(tuneTimer);
  tuneTimer = null;
  if (!tuneDirty) return;
  tuneDirty = false;
  saveTune(useWatchStore.getState().tune);
}

function cancelTuneWrite(): void {
  if (tuneTimer !== null) clearTimeout(tuneTimer);
  tuneTimer = null;
  tuneDirty = false;
}

function writeTuneSoon(): void {
  tuneDirty = true;
  if (tuneTimer === null) tuneTimer = setTimeout(flushTune, TUNE_WRITE_MS);
}
import { relinkSaved } from './rowMenu';
import { addSaved, cleanLabel, cleanText, loadSaved, MAX_LABEL, removeSaved, renameSaved, saveSaved, type SavedItem } from './saved';
import { stopLine, type StopReason } from './stops';

export type UnwindTab = 'listen' | 'watch';

/** Where the wall's own video level (0 to 100) is kept. */
export const VOLUME_KEY = 'wall2-watch-volume';

/** A level as a whole number from 0 to 100 (anything that is not a number is the player's full level). */
export function clampLevel(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return PLAYER_VOLUME;
  return Math.min(100, Math.max(0, Math.round(v)));
}

/** The stored level, read strictly: a whole number from 0 to 100, else the player's full level. */
export function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null || raw.length > 8 || !/^\d{1,3}$/.test(raw)) return PLAYER_VOLUME;
    return clampLevel(Number(raw));
  } catch {
    return PLAYER_VOLUME;
  }
}

function saveVolume(level: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(level));
  } catch {
    /* the level stays for this session */
  }
}

/** What the player has reported about the item now on (YouTube only; Twitch reports nothing). */
export interface PlayerReport {
  /** True once the picture has actually played. */
  started: boolean;
  /** Seconds played and the length, when the player has said (length 0 for a live stream). */
  time: number | null;
  duration: number | null;
  /** Items in the playlist the player is on, and which is playing (0 based); 0 for a single video. */
  count: number;
  index: number;
  /** True once a single video, a live stream or a playlist's last item has ended (no command is sent for it). */
  ended: boolean;
  /** The video's own title and channel, as the player reported them for the item now on (video and live stream only); null until then. */
  title: string | null;
  channel: string | null;
  /** The player's own error code for the item now on (`onError`, 0 to 999); null while it has reported none. */
  error: number | null;
}

export const NO_REPORT: PlayerReport = { started: false, time: null, duration: null, count: 0, index: 0, ended: false, title: null, channel: null, error: null };

/** What put the item in the frame: the Watch tab (a saved item, a pin) or a pick from the YouTube library on Listen (`playMusic`). */
export type PlaySource = 'watch' | 'music' | 'own';

export interface WatchState {
  /** Which view Unwind shows. The one value any switch (today the tabs) sets; nothing in Watch reads where that switch is. */
  tab: UnwindTab;
  saved: SavedItem[];
  looks: LookSettings;
  /** The settings of each look (sliders in the sheet), kept per look. */
  tune: LookTune;
  /** The item in the frame, or null: no frame at all. */
  playing: SavedItem | null;
  /** What put `playing` there (see `PlaySource`); `play` sets 'watch', `playMusic` sets 'music', `playOwnVideo` sets 'own'. */
  source: PlaySource;
  /** The item most recently stopped in Watch, used only to identify its stopped media session. */
  lastStopped: SavedItem | null;
  /** The owner's own pause and mute (YouTube only); the frame's state messages may correct `paused`. */
  paused: boolean;
  muted: boolean;
  /** The level the wall's own video plays at (0 to 100, whole numbers), kept across restarts. Twitch has no level to set. */
  volume: number;
  sheet: boolean;
  /** The sheet tab asked for when it opened (the palette strip's Settings item asks for Lights); null: the screen's own. */
  sheetTab: 'looks' | 'lines' | 'lights' | null;
  /** What the player has reported for the item now on. */
  report: PlayerReport;
  /** True while the pointer may reach the frame: YouTube until a refused autoplay plays; Twitch for one click or `TWITCH_CLICK_MS`. */
  needsClick: boolean;
  /** Twitch only: true once the start wait has passed, so the control row offers "Not started? Click the video". */
  clickHint: boolean;
  /** Why the last video stopped by itself, shown once in the left block until the next play. */
  stopped: string | null;
  /** The key of the row being renamed, if any. */
  editing: string | null;
  /** watch behaviour: true while the pointer is over the band on the video's lower edge, which wakes the faded controls. */
  peek: boolean;
  load: () => void;
  setTab: (t: UnwindTab) => void;
  /** Read and save a pasted link; returns the refusal line, or null when it was added. */
  addLink: (text: string) => string | null;
  /** Save one checked item at the top of the list (the same path as a pasted link); the refusal line, or null. `openName` false leaves the name field alone. */
  addRef: (ref: WatchRef, openName?: boolean) => string | null;
  /** Give a saved video or live stream that still has its default label the player's title for it, once; false when nothing changed. */
  fillLabel: (key: string, title: string) => boolean;
  remove: (key: string) => void;
  /** Take an item out of the Watch list only: what plays keeps playing. */
  unsave: (key: string) => void;
  rename: (key: string, label: string) => void;
  /** Replace a saved item's link with a pasted one, as the paste box reads it; returns the refusal line, or null when it changed. */
  relink: (key: string, text: string) => string | null;
  setEditing: (key: string | null) => void;
  play: (ref: WatchRef) => void;
  /**
   * Play a YouTube item pinned from a library panel: the same as `play` without the Watch list check, with the pin's name as label
   * (source 'watch', the Watch tab shown). Twitch, own and invalid refs do nothing; true when it started.
   */
  playPinned: (ref: WatchRef, label: string) => boolean;
  /**
   * Play a video picked in the YouTube library: needs only a valid video id (it is never saved, never changes the tab).
   * The same video already in the frame is not reloaded: it starts again from 0. False for an id that does not pass.
   */
  playMusic: (id: string, label: string) => boolean;
  /** The same as `playMusic` for a video of a playlist made on the wall: source 'own'. */
  playOwnVideo: (id: string, label: string) => boolean;
  stop: (why?: StopReason) => void;
  setPaused: (p: boolean) => void;
  setMuted: (m: boolean) => void;
  /** Set the video's level (bounded, whole numbers) and keep it; it is also the level the next video starts at. */
  setVolume: (v: number) => void;
  setLooks: (s: LookSettings) => void;
  /** Change settings of one look (each value bounded by its control). */
  setTune: (look: LookId, patch: Record<string, number | boolean>, persist?: 'now' | 'soon') => void;
  /** One look's settings back to its defaults. */
  resetTune: (look: LookId) => void;
  setReport: (r: Partial<PlayerReport>) => void;
  setNeedsClick: (on: boolean) => void;
  setClickHint: (on: boolean) => void;
  setSheet: (open: boolean, tab?: 'looks' | 'lines' | 'lights') => void;
  setPeek: (on: boolean) => void;
}

export const useWatchStore = create<WatchState>((set, get) => ({
  tab: 'listen',
  saved: loadSaved(),
  looks: loadLooks(),
  tune: loadTune(),
  playing: null,
  source: 'watch',
  lastStopped: null,
  paused: false,
  muted: false,
  volume: loadVolume(),
  report: NO_REPORT,
  needsClick: false,
  clickHint: false,
  sheet: false,
  sheetTab: null,
  stopped: null,
  editing: null,
  peek: false,
  load: () => {
    cancelTuneWrite();
    set({ saved: loadSaved(), looks: loadLooks(), tune: loadTune(), volume: loadVolume() });
  },
  setTab: (tab) => {
    if (tab === get().tab) return;
    // Leaving Watch never stops the video: it plays on out of sight (`StageLayer.tsx`).
    set({ tab, sheet: false, editing: null, peek: false });
  },
  addLink: (text) => {
    const parsed = parseLink(text);
    if (!parsed.ok) return parsed.error;
    return get().addRef(parsed.ref);
  },
  addRef: (ref, openName = true) => {
    const r = addSaved(get().saved, ref);
    if (!r.ok) return r.error;
    saveSaved(r.items);
    // A new item starts with its kind as its label; its name field opens so it can be named.
    set(openName ? { saved: r.items, editing: refKey(r.added) } : { saved: r.items });
    return null;
  },
  fillLabel: (key, title) => {
    const st = get();
    const item = st.saved.find((i) => refKey(i) === key);
    if (!item || (item.kind !== 'video' && item.kind !== 'live')) return false;
    if (item.label !== defaultLabel(item)) return false;
    if (st.editing === key) {
      // The name field is open: keep the answer and apply it when the field closes without a typed name.
      waitingTitles.set(key, title);
      return false;
    }
    const label = cleanLabel(title, item);
    if (label === item.label) return false;
    const items = st.saved.map((i) => (refKey(i) === key ? { ...i, label } : i));
    saveSaved(items);
    const playing = st.playing;
    set({ saved: items, playing: playing && refKey(playing) === key ? { ...playing, label } : playing });
    return true;
  },
  remove: (key) => {
    waitingTitles.delete(key);
    const items = removeSaved(get().saved, key);
    saveSaved(items);
    const playing = get().playing;
    if (playing && refKey(playing) === key) get().stop();
    set({ saved: items, editing: get().editing === key ? null : get().editing });
  },
  unsave: (key) => {
    waitingTitles.delete(key);
    const items = removeSaved(get().saved, key);
    saveSaved(items);
    set({ saved: items, editing: get().editing === key ? null : get().editing });
  },
  rename: (key, label) => {
    const items = renameSaved(get().saved, key, label);
    saveSaved(items);
    const playing = get().playing;
    set({ saved: items, editing: null, playing: playing && refKey(playing) === key ? (items.find((i) => refKey(i) === key) ?? playing) : playing });
  },
  relink: (key, text) => {
    const r = relinkSaved(get().saved, key, text);
    if (!r.ok) return r.error;
    // The same video again (a different spelling of its link): nothing to change.
    if (r.key === key) return null;
    waitingTitles.delete(key);
    saveSaved(r.items);
    // A video that was playing from the old link stops: the new one is not what is in the frame.
    const playing = get().playing;
    if (playing && refKey(playing) === key) get().stop();
    set({ saved: r.items });
    // A pin on the old link follows the item to the new one (`pins.ts` listens).
    for (const fn of relinkListeners) fn(key, r.key);
    return null;
  },
  setEditing: (editing) => set({ editing }),
  play: (ref) => {
    // A playlist made on the wall is never in the frame itself: its videos are played one at a time (`ownPlay`).
    if (ref.kind === 'own') return;
    const item = get().saved.find((i) => refKey(i) === refKey(ref));
    if (!item) return;
    set({ playing: item, source: 'watch', lastStopped: null, paused: false, muted: false, report: NO_REPORT, needsClick: false, clickHint: false, stopped: null, tab: 'watch' });
  },
  playPinned: (ref, label) => {
    if (ref.kind !== 'video' && ref.kind !== 'live' && ref.kind !== 'playlist') return false;
    if (!validId(ref.kind, ref.id)) return false;
    const item: SavedItem = { kind: ref.kind, id: ref.id, label: cleanText(label, MAX_LABEL) || defaultLabel(ref) };
    set({ playing: item, source: 'watch', lastStopped: null, paused: false, muted: false, report: NO_REPORT, needsClick: false, clickHint: false, stopped: null, tab: 'watch' });
    return true;
  },
  playMusic: (id, label) => playQueued(id, label, 'music'),
  playOwnVideo: (id, label) => playQueued(id, label, 'own'),
  stop: (why) => {
    const playing = get().playing;
    if (!playing) return;
    set({ playing: null, lastStopped: playing, paused: false, report: NO_REPORT, needsClick: false, clickHint: false, stopped: why ? stopLine(why) : null });
  },
  setPaused: (paused) => set({ paused }),
  setMuted: (muted) => set({ muted }),
  setVolume: (v) => {
    const volume = clampLevel(v);
    if (volume === get().volume) return;
    saveVolume(volume);
    set({ volume });
  },
  setTune: (look, patch, persist = 'now') => {
    set({ tune: withPatch(get().tune, look, patch) });
    if (persist === 'soon') writeTuneSoon();
    else {
      tuneDirty = true;
      flushTune();
    }
  },
  resetTune: (look) => {
    set({ tune: resetLook(get().tune, look) });
    tuneDirty = true;
    flushTune();
  },
  setLooks: (looks) => {
    saveLooks(looks);
    set({ looks });
  },
  setReport: (r) => {
    const cur = get().report;
    const next = { ...cur, ...r };
    if (next.started === cur.started && next.time === cur.time && next.duration === cur.duration && next.count === cur.count && next.index === cur.index && next.ended === cur.ended && next.title === cur.title && next.channel === cur.channel && next.error === cur.error) return;
    set({ report: next });
  },
  setNeedsClick: (needsClick) => {
    if (needsClick !== get().needsClick) set({ needsClick });
  },
  setClickHint: (clickHint) => {
    if (clickHint !== get().clickHint) set({ clickHint });
  },
  setSheet: (sheet, tab) => set({ sheet, sheetTab: sheet ? tab ?? null : null }),
  setPeek: (peek) => {
    if (peek !== get().peek) set({ peek });
  },
}));

/** Put one YouTube video in the frame for a queue (the library's or a wall-made playlist): never saved, never changes the tab. */
function playQueued(id: string, label: string, source: 'music' | 'own'): boolean {
  if (!validId('video', id)) return false;
  const st = useWatchStore.getState();
  const cur = st.playing;
  if (cur && cur.kind === 'video' && cur.id === id) {
    // The same video: the frame is keyed by it, so it is not reloaded; it starts again from the top.
    playerLink.send('seekTo', [0, true]);
    // An error code that was acted on is cleared, so a replay of an id that errored before is not skipped at once.
    useWatchStore.setState({ source, paused: false, report: st.report.ended || st.report.error !== null ? { ...st.report, ended: false, error: null } : st.report, needsClick: false, clickHint: false, stopped: null });
    return true;
  }
  const item: SavedItem = { kind: 'video', id, label: cleanText(label, MAX_LABEL) || 'YouTube video' };
  // The saved list, the tab and the owner's mute are left alone; the item it replaces is remembered for the top player's match.
  useWatchStore.setState({ playing: item, source, lastStopped: cur ?? st.lastStopped, paused: false, report: NO_REPORT, needsClick: false, clickHint: false, stopped: null });
  return true;
}

/**
 * For the buddy: while something is on in the drive-in look, the screen's rectangle in wall
 * pixels (so the sheep can sit in front of it and watch); otherwise null. Pass the store's
 * state (`driveInAudience(useWatchStore.getState())`) or use it as a store selector
 * (`useWatchStore(driveInAudience)`).
 */
export function driveInAudience(s: Pick<WatchState, 'playing' | 'looks'> & Partial<Pick<WatchState, 'tune'>>): Readonly<WallRect> | null {
  if (!s.playing) return null;
  if (lookFor(s.looks, s.playing.kind) !== 'drivein') return null;
  // One frozen object, so a store selector sees the same value from call to call.
  return s.tune ? lookBox('drivein', s.tune) : DRIVE_IN_SCREEN;
}

/**
 * For the buddy: whether he keeps out of the video's area: only for the drive-in screen
 * (the movie screen), the Hologram or the Feathered picture while a video plays, or the empty drive-in
 * screen with nothing on (the only look drawn then). Only the whole-sky and sun looks sit behind the
 * land: he walks the whole floor in front of them, which reads as under the video. He never walks
 * over a video picture. Use it as a store selector.
 */
export function videoInFront(s: Pick<WatchState, 'playing' | 'looks' | 'saved'>): boolean {
  if (s.playing) {
    const look = lookFor(s.looks, s.playing.kind);
    return look === 'drivein' || look === 'holo' || look === 'feather';
  }
  return lookFor(s.looks, s.saved[0]?.kind ?? 'video') === 'drivein';
}

/**
 * True while the video stage is in sight: Unwind is the place and its Watch tab is showing. One
 * decision for the stage layer (`StageLayer.tsx`: a video that keeps playing out of sight is parked,
 * not shown) and for the show selector below, so the two never disagree.
 */
export function stageShown(place: string | null, tab: UnwindTab): boolean {
  return place === 'unwind' && tab === 'watch';
}

/** What the drive-in's marquee says is on, as `audience.ts` reads it (the same words as `driveInMode`, plus `ended`). */
export type DriveInMarquee = 'none' | 'playing' | 'paused' | 'waiting' | 'ended';

/**
 * For the buddy: the marquee's state for whatever is chosen. A selector over the Watch store alone
 * (it says nothing of the look or of whether the stage is in sight: `driveInAudience` and
 * `stageShown` do). `ended` is a video that is over; `waiting` is loading or awaiting a click.
 */
export function driveInMarquee(s: Pick<WatchState, 'playing' | 'paused' | 'needsClick' | 'clickHint' | 'report'>): DriveInMarquee {
  if (!s.playing) return 'none';
  if (s.report.ended) return 'ended';
  const m = driveInMode({ paused: s.paused, started: s.report.started, needsClick: s.needsClick, clickHint: s.clickHint, ended: false, reports: s.playing.kind !== 'twitch' });
  return m === 'empty' ? 'none' : m;
}

/**
 * The show now on, as one value: the marquee's state while the stage is in sight with something
 * chosen in the drive-in look, else `none`. A parked video (another tab or place) is not a show.
 */
export function driveInShow(s: WatchState, place: string | null): DriveInMarquee {
  if (!stageShown(place, s.tab) || driveInAudience(s) === null) return 'none';
  return driveInMarquee(s);
}

// A page that is hidden or closed writes any settings change still waiting.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushTune();
  });
  window.addEventListener('pagehide', flushTune);
}

// Leaving Unwind (another place, Zen or Dream) closes the sheet; the video plays on out of sight.
usePlaceStore.subscribe((s) => {
  if (s.active !== 'unwind') {
    const st = useWatchStore.getState();
    if (st.sheet || st.peek) useWatchStore.setState({ sheet: false, sheetTab: null, peek: false });
  }
});

// When a name field closes, a title that arrived meanwhile fills the name if none was typed (`fillLabel` refuses a typed one).
useWatchStore.subscribe((s, prev) => {
  const key = prev.editing;
  if (key === null || key === s.editing) return;
  const title = waitingTitles.get(key);
  waitingTitles.delete(key);
  if (title !== undefined) s.fillLabel(key, title);
});

/** Tests only: back to a fresh store over whatever local storage holds now. */
/** Told when a saved item's link changes (old key, new key), so what holds the old key can follow. */
export const relinkListeners: Array<(from: string, to: string) => void> = [];

export function resetWatch(): void {
  cancelTuneWrite();
  waitingTitles.clear();
  useWatchStore.setState({ tab: 'listen', saved: loadSaved(), looks: loadLooks(), tune: loadTune(), volume: loadVolume(), playing: null, source: 'watch', lastStopped: null, paused: false, muted: false, report: NO_REPORT, needsClick: false, clickHint: false, sheet: false, sheetTab: null, stopped: null, editing: null, peek: false });
}

// The controls' rest belongs to one tab. Any tab change (setTab, or a play that jumps to Watch) clears it before React
// renders the incoming tab, so neither tab ever mounts rested; the outgoing tab's own cleanup comes after.
useWatchStore.subscribe((s, p) => {
  if (s.tab !== p.tab) useWatchRest.setState({ rest: false });
});
