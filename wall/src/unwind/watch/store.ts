import { create } from 'zustand';
import { usePlaceStore } from '../../state/places';
import { parseLink, refKey, type WatchRef } from './links';
import { driveInMode } from './DriveInFrame';
import { DRIVE_IN_SCREEN, lookFor, loadLooks, pickLook, saveLooks, type LookId, type LookSettings, type WallRect } from './looks';
import { addSaved, loadSaved, removeSaved, renameSaved, saveSaved, type SavedItem } from './saved';
import { stopLine, type StopReason } from './stops';

export type UnwindTab = 'listen' | 'watch';

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
}

export const NO_REPORT: PlayerReport = { started: false, time: null, duration: null, count: 0, index: 0, ended: false };

export interface WatchState {
  /** Which view Unwind shows. The one value any switch (today the tabs) sets; nothing in Watch reads where that switch is. */
  tab: UnwindTab;
  saved: SavedItem[];
  looks: LookSettings;
  /** The item in the frame, or null: no frame at all. */
  playing: SavedItem | null;
  /** The item most recently stopped in Watch, used only to identify its stopped media session. */
  lastStopped: SavedItem | null;
  /** The owner's own pause and mute (YouTube only); the frame's state messages may correct `paused`. */
  paused: boolean;
  muted: boolean;
  sheet: boolean;
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
  remove: (key: string) => void;
  rename: (key: string, label: string) => void;
  setEditing: (key: string | null) => void;
  play: (ref: WatchRef) => void;
  stop: (why?: StopReason) => void;
  setPaused: (p: boolean) => void;
  setMuted: (m: boolean) => void;
  setLooks: (s: LookSettings) => void;
  /** The Look switch: set the look for what is on (or, with nothing on, for the first saved item's kind). */
  pickLook: (look: LookId) => void;
  setReport: (r: Partial<PlayerReport>) => void;
  setNeedsClick: (on: boolean) => void;
  setClickHint: (on: boolean) => void;
  setSheet: (open: boolean) => void;
  setPeek: (on: boolean) => void;
}

export const useWatchStore = create<WatchState>((set, get) => ({
  tab: 'listen',
  saved: loadSaved(),
  looks: loadLooks(),
  playing: null,
  lastStopped: null,
  paused: false,
  muted: false,
  report: NO_REPORT,
  needsClick: false,
  clickHint: false,
  sheet: false,
  stopped: null,
  editing: null,
  peek: false,
  load: () => set({ saved: loadSaved(), looks: loadLooks() }),
  setTab: (tab) => {
    if (tab === get().tab) return;
    // Leaving Watch never stops the video: it plays on out of sight (`StageLayer.tsx`).
    set({ tab, sheet: false, editing: null, peek: false });
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
    set({ playing: item, lastStopped: null, paused: false, muted: false, report: NO_REPORT, needsClick: false, clickHint: false, stopped: null, tab: 'watch' });
  },
  stop: (why) => {
    const playing = get().playing;
    if (!playing) return;
    set({ playing: null, lastStopped: playing, paused: false, report: NO_REPORT, needsClick: false, clickHint: false, stopped: why ? stopLine(why) : null });
  },
  setPaused: (paused) => set({ paused }),
  setMuted: (muted) => set({ muted }),
  setLooks: (looks) => {
    saveLooks(looks);
    set({ looks });
  },
  pickLook: (look) => {
    const kind = get().playing?.kind ?? get().saved[0]?.kind ?? 'video';
    get().setLooks(pickLook(get().looks, kind, look));
  },
  setReport: (r) => {
    const cur = get().report;
    const next = { ...cur, ...r };
    if (next.started === cur.started && next.time === cur.time && next.duration === cur.duration && next.count === cur.count && next.index === cur.index && next.ended === cur.ended) return;
    set({ report: next });
  },
  setNeedsClick: (needsClick) => {
    if (needsClick !== get().needsClick) set({ needsClick });
  },
  setClickHint: (clickHint) => {
    if (clickHint !== get().clickHint) set({ clickHint });
  },
  setSheet: (sheet) => set({ sheet }),
  setPeek: (peek) => {
    if (peek !== get().peek) set({ peek });
  },
}));

/**
 * For the buddy: while something is on in the drive-in look, the screen's rectangle in wall
 * pixels (so the sheep can sit in front of it and watch); otherwise null. Pass the store's
 * state (`driveInAudience(useWatchStore.getState())`) or use it as a store selector
 * (`useWatchStore(driveInAudience)`).
 */
export function driveInAudience(s: Pick<WatchState, 'playing' | 'looks'>): Readonly<WallRect> | null {
  if (!s.playing) return null;
  if (lookFor(s.looks, s.playing.kind) !== 'drivein') return null;
  // One frozen object, so a store selector sees the same value from call to call.
  return DRIVE_IN_SCREEN;
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

// Leaving Unwind (another place, Zen or Dream) closes the sheet; the video plays on out of sight.
usePlaceStore.subscribe((s) => {
  if (s.active !== 'unwind') {
    const st = useWatchStore.getState();
    if (st.sheet || st.peek) useWatchStore.setState({ sheet: false, peek: false });
  }
});

/** Tests only: back to a fresh store over whatever local storage holds now. */
export function resetWatch(): void {
  useWatchStore.setState({ tab: 'listen', saved: loadSaved(), looks: loadLooks(), playing: null, lastStopped: null, paused: false, muted: false, report: NO_REPORT, needsClick: false, clickHint: false, sheet: false, stopped: null, editing: null, peek: false });
}
