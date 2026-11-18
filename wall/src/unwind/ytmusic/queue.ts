import { create } from 'zustand';
import type { YtVideo } from '../../music/youtube';
import { playerLink } from '../watch/playerLink';
import { useWatchStore, type WatchState } from '../watch/store';
import { usePins } from '../watch/pins';
import { MAX_PAGES } from './model';
import { loadList, onLibraryReset, useYtLibrary } from './store';

/**
 * The wall's music queue: the list a YouTube library pick came from, in memory only (never kept across a
 * restart), never wrapping. It plays through the Watch store's one player (`playMusic`): each entry is the
 * item in the one frame, so exactly one of a Watch video and the wall's music plays.
 *
 * - `entries` are the rows of the list that play outside YouTube, in order (or shuffled once); `at` is the row's
 *   place in its list. `pos` is the entry now on. `from` names the list, so a row of that list can be marked.
 * - The queue is ACTIVE only while the Watch store holds a music item whose id is the entry at `pos`. A Watch
 *   play or a pin (`source` 'watch') or a stop makes it inactive at once; the entries stay for "Play again".
 * - It grows only through the library store: when within `NEAR_END` entries of its end, or for a while after
 *   Play, Shuffle or a row click (up to `AHEAD_ROWS`), it takes the rows the store has read since and asks the
 *   store for its next page (`loadList`). It never reads with a page token of its own, and it ends where its
 *   rows end once the list has left the store.
 * - Loads are at least `LOAD_GAP_MS` apart: a request inside that time waits for the rest of it and the last
 *   request wins. A video that ends advances once. An error from the player skips the entry (100, 101 and 150
 *   also grey its row for the session); five in a row stop the queue.
 */

export interface QueueEntry {
  id: string;
  title: string;
  channel: string;
  seconds: number;
  thumb: string | null;
  /** The row's place in its list (0 based). */
  at: number;
}

export type QueueFrom = { list: 'songs'; playlistId: string } | { list: 'liked' } | { list: 'found'; query: string };

export type FailedWhy = 'embed' | 'removed';

interface QueueState {
  entries: QueueEntry[];
  pos: number;
  from: QueueFrom | null;
  shuffled: boolean;
  /** Entries in a row the player refused; five stop the queue. */
  errorsInRow: number;
  /** One quiet line (a skip, or the stop after five), or null. */
  note: string | null;
  /** Videos that failed this session, by id: shown greyed with the library's own words. At most `MAX_FAILED`. */
  failed: ReadonlyMap<string, FailedWhy>;
  /** How many rows of the list the queue has taken (the next to take is this one). */
  readTo: number;
}

const fresh = (): QueueState => ({ entries: [], pos: 0, from: null, shuffled: false, errorsInRow: 0, note: null, failed: new Map(), readTo: 0 });

export const useYtQueue = create<QueueState>(() => fresh());

/** The least time between two loads of a video. */
export const LOAD_GAP_MS = 1000;
/** Within this many entries of its end, the queue takes more rows. */
export const NEAR_END = 10;
/** Right after Play, Shuffle or a row click, the queue reads ahead up to this many rows. */
export const AHEAD_ROWS = 200;
export const MAX_FAILED = 500;
/** A line stays this long (or until the next play). */
export const NOTE_MS = 8000;
export const ERRORS_STOP = 5;
/** A video counts as played once its reported time passes this many seconds. */
export const PLAYED_S = 2;

export const FIVE_LINE = 'Stopped after five videos in a row would not play.';
export const AUTOPLAY_LINE = 'YouTube did not start the sound.';

const ID = /^[A-Za-z0-9_-]{11}$/;

/** True for an id with a video id's exact shape: the queue's own test of whether a row can be a control. */
export const validVideoId = (id: unknown): boolean => typeof id === 'string' && ID.test(id);

/** The line when the entry that would not play was the last one. */
export function lastLine(title: string, why: FailedWhy | null): string {
  const t = title || 'This video';
  if (why === 'embed') return `${t} would not play: it plays only on YouTube. That was the last one.`;
  if (why === 'removed') return `${t} would not play: it is no longer on YouTube. That was the last one.`;
  return `${t} would not play. That was the last one.`;
}

export function skipLine(title: string, why: FailedWhy | null): string {
  const t = title || 'this video';
  if (why === 'embed') return `Skipped ${t}: it plays only on YouTube.`;
  if (why === 'removed') return `Skipped ${t}: it is no longer on YouTube.`;
  return `Skipped ${t}: YouTube would not play it here.`;
}

/** Whether the queue is the player's: a music item in the frame that is the entry at `pos`. */
export function queueActive(w: Pick<WatchState, 'source' | 'playing'>, q: Pick<QueueState, 'entries' | 'pos'>): boolean {
  return w.source === 'music' && !!w.playing && q.entries[q.pos]?.id === w.playing.id;
}

export function isActive(): boolean {
  return queueActive(useWatchStore.getState(), useYtQueue.getState());
}

/** True while the queue is the wall's player (a hook). */
export function useQueueActive(): boolean {
  const entry = useYtQueue((s) => s.entries[s.pos]?.id ?? null);
  const playing = useWatchStore((s) => (s.source === 'music' ? (s.playing?.id ?? null) : null));
  return entry !== null && entry === playing;
}

export function sameList(a: QueueFrom | null, b: QueueFrom | null): boolean {
  if (!a || !b || a.list !== b.list) return false;
  if (a.list === 'songs' && b.list === 'songs') return a.playlistId === b.playlistId;
  if (a.list === 'found' && b.list === 'found') return a.query === b.query;
  return true;
}

/** Why a failed video is greyed: the library's own words for the row. */
export function failedWords(why: FailedWhy): string {
  return why === 'embed' ? 'Only on YouTube' : 'Removed';
}

export function toEntry(v: YtVideo, at: number): QueueEntry {
  return { id: v.id, title: v.title, channel: v.channel, seconds: v.seconds, thumb: v.thumb, at };
}

/** True for a row the queue may take: it plays outside YouTube, its id has a video id's exact shape and it has not failed. */
export function queueable(v: YtVideo, failed: ReadonlyMap<string, FailedWhy> = useYtQueue.getState().failed): boolean {
  return v.playable === 'yes' && ID.test(v.id) && !failed.has(v.id);
}

function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Section: The one note, the one load timer.

let noteTimer: ReturnType<typeof setTimeout> | undefined;

/** Show one quiet line (it goes after `NOTE_MS` or at the next play); null clears it. */
export function setNote(line: string | null): void {
  clearTimeout(noteTimer);
  noteTimer = undefined;
  useYtQueue.setState({ note: line });
  if (line) {
    noteTimer = setTimeout(() => {
      noteTimer = undefined;
      useYtQueue.setState({ note: null });
    }, NOTE_MS);
  }
}

let lastLoadAt = -Infinity;
let pending: { pos: number; keepNote: boolean } | null = null;
let loadTimer: ReturnType<typeof setTimeout> | undefined;
/** The entry (position and id) whose end or error has been acted on, so a second report of it does nothing. */
let advancedFor: string | null = null;
let errorFor: string | null = null;
/** Set by Play, Shuffle and a row click until the list has been read `AHEAD_ROWS` rows past the pick, or has no more. */
let ahead = false;
/**
 * Reading ahead and growing near the end are bounded by rows READ, not by entries accepted: the list is never read past
 * this place (a row count in the list). A pick sets it to the picked row plus `AHEAD_ROWS`; each entry that plays moves it
 * on to its own place (or, for a shuffled queue near its end, to the rows read) plus `AHEAD_ROWS`. A list of mostly
 * private, removed or blocked rows therefore stops at 200 rows past the place, however few of them could play.
 */
let readCeiling = AHEAD_ROWS;

const keyOf = (pos: number, id: string) => `${pos}:${id}`;

function cancelPending(): void {
  clearTimeout(loadTimer);
  loadTimer = undefined;
  pending = null;
}

export function markFailed(id: string, why: FailedWhy): void {
  const failed = new Map(useYtQueue.getState().failed);
  failed.delete(id);
  failed.set(id, why);
  while (failed.size > MAX_FAILED) failed.delete(failed.keys().next().value as string);
  useYtQueue.setState({ failed });
}

/** The first entry at or after `from` that has not failed, or null. */
function nextPlayable(from: number): number | null {
  const { entries, failed } = useYtQueue.getState();
  for (let i = Math.max(0, from); i < entries.length; i += 1) if (!failed.has(entries[i]!.id)) return i;
  return null;
}

function prevPlayable(from: number): number | null {
  const { entries, failed } = useYtQueue.getState();
  for (let i = Math.min(from, entries.length - 1); i >= 0; i -= 1) if (!failed.has(entries[i]!.id)) return i;
  return null;
}

/** Put the entry at `pos` in the frame now (the spacing is `request`'s business). */
function load(pos: number, keepNote = false): void {
  const e = useYtQueue.getState().entries[pos];
  if (!e) return;
  clearTimeout(loadTimer);
  loadTimer = undefined;
  pending = null;
  lastLoadAt = Date.now();
  advancedFor = null;
  errorFor = null;
  const q0 = useYtQueue.getState();
  readCeiling = Math.max(readCeiling, (q0.shuffled ? (q0.entries.length - pos <= NEAR_END ? q0.readTo : 0) : e.at) + AHEAD_ROWS);
  // `pos` first, so the queue is already the player's when the Watch store announces the new item.
  useYtQueue.setState({ pos });
  // A skip keeps the line that says why; a play the owner asked for clears it.
  if (!keepNote) setNote(null);
  // The id is checked again right here (`playMusic` refuses anything that is not a video id).
  if (!ID.test(e.id) || !useWatchStore.getState().playMusic(e.id, e.title)) {
    const n = nextPlayable(pos + 1);
    markFailed(e.id, 'removed');
    if (n !== null) load(n, keepNote);
    return;
  }
  maybeGrow();
}

/** Ask for the entry at `pos`: at once when a second has passed since the last load, else after the rest of it (the last request wins). */
function request(pos: number, keepNote = false): void {
  const wait = lastLoadAt + LOAD_GAP_MS - Date.now();
  if (wait <= 0 && pending === null) {
    load(pos, keepNote);
    return;
  }
  pending = { pos, keepNote };
  if (loadTimer === undefined) {
    loadTimer = setTimeout(() => {
      loadTimer = undefined;
      const p = pending;
      pending = null;
      if (p) load(p.pos, p.keepNote);
    }, Math.max(0, wait));
  }
}

// Section: Starting a queue.

function start(entries: QueueEntry[], pos: number, from: QueueFrom, rows: number, shuffled: boolean, place: number): void {
  if (entries.length === 0 || !entries[pos]) return;
  ahead = true;
  readCeiling = place + AHEAD_ROWS;
  // A play the owner asked for is heard, and starts the count of videos that would not play again.
  useWatchStore.getState().setMuted(false);
  useYtQueue.setState({ entries, pos, note: null, from, shuffled, errorsInRow: 0, readTo: rows });
  request(pos);
}

/** A row click: the list's playable rows in order, starting at that row (`index` is the row's place in `rows`). */
export function playFrom(rows: readonly YtVideo[], index: number, from: QueueFrom): void {
  const failed = useYtQueue.getState().failed;
  const entries: QueueEntry[] = [];
  let pos = -1;
  rows.forEach((v, i) => {
    if (!queueable(v, failed)) return;
    if (i === index) pos = entries.length;
    entries.push(toEntry(v, i));
  });
  if (pos < 0) return;
  start(entries, pos, from, rows.length, false, index);
}

/** Play: from the first playable row. Shuffle: every playable row once, in a random order. */
export function playAll(rows: readonly YtVideo[], doShuffle: boolean, from: QueueFrom): void {
  const failed = useYtQueue.getState().failed;
  let entries = rows.flatMap((v, i) => (queueable(v, failed) ? [toEntry(v, i)] : []));
  if (doShuffle) entries = shuffle(entries);
  start(entries, 0, from, rows.length, doShuffle, 0);
}

/** Every play the owner asks for starts the count of videos in a row that would not play again. */
function owner(): void {
  if (useYtQueue.getState().errorsInRow > 0) useYtQueue.setState({ errorsInRow: 0 });
}

export function next(): void {
  owner();
  const base = pending?.pos ?? useYtQueue.getState().pos;
  const n = nextPlayable(base + 1);
  if (n !== null) request(n);
}

/** Back: the start of this entry when more than 3 seconds in (or at the first), else the entry before. */
export function previous(): void {
  owner();
  const q = useYtQueue.getState();
  const base = pending?.pos ?? q.pos;
  const time = useWatchStore.getState().report.time ?? 0;
  const before = pending || time <= 3 ? prevPlayable(base - 1) : null;
  request(before ?? base);
}

/** Up next: play the entry at this place in the queue. */
export function jump(index: number): void {
  owner();
  const q = useYtQueue.getState();
  const e = q.entries[index];
  if (e && !q.failed.has(e.id)) request(index);
}

/** "Play again": the entry at `pos`, from the start, from the owner's click. */
export function playAgain(): void {
  const q = useYtQueue.getState();
  if (!q.entries[q.pos]) return;
  owner();
  // A play the owner asked for is heard, even after a Watch video was muted.
  useWatchStore.getState().setMuted(false);
  request(q.pos);
}

/** The queue stops being anyone's: gone, with its note and timers (tests, and a sign-out). */
export function resetQueue(): void {
  cancelPending();
  clearTimeout(noteTimer);
  noteTimer = undefined;
  lastLoadAt = -Infinity;
  advancedFor = null;
  errorFor = null;
  ahead = false;
  readCeiling = AHEAD_ROWS;
  useYtQueue.setState(fresh());
}

// Section: Growing, only through the library store.

function listOf(from: QueueFrom): { items: YtVideo[]; next: string | null; loading: boolean; problem: unknown; pages: number; key: 'songs' | 'liked' | null } | null {
  const lib = useYtLibrary.getState();
  if (from.list === 'songs') return lib.opened?.id === from.playlistId ? { ...lib.songs, key: 'songs' } : null;
  if (from.list === 'liked') return { ...lib.liked, key: 'liked' };
  return lib.found && lib.query === from.query ? { ...lib.found, key: null } : null;
}

/** Take the rows the library store has read since: newer by place, none twice; a shuffled queue takes them shuffled, after its own. */
function absorb(): void {
  const q = useYtQueue.getState();
  if (!q.from) return;
  const l = listOf(q.from);
  if (!l || l.items.length <= q.readTo) return;
  const have = new Set(q.entries.map((e) => e.id));
  let more = l.items.flatMap((v, i) => (i >= q.readTo && queueable(v, q.failed) && !have.has(v.id) ? [toEntry(v, i)] : []));
  if (q.shuffled) more = shuffle(more);
  useYtQueue.setState({ entries: more.length ? [...q.entries, ...more] : q.entries, readTo: l.items.length });
}

function maybeGrow(): void {
  if (!isActive()) return;
  absorb();
  const q = useYtQueue.getState();
  if (!q.from) return;
  const near = q.entries.length - q.pos <= NEAR_END;
  // Never more than `readCeiling` rows of the list, whatever share of them could play.
  if (q.readTo >= readCeiling) {
    ahead = false;
    return;
  }
  if (!near && !ahead) return;
  const l = listOf(q.from);
  if (!l) {
    ahead = false;
    return;
  }
  if (!l.key || !l.next || l.problem) {
    ahead = false;
    return;
  }
  // Only through the store's own `loadList`: it holds the token it was handed and refuses any other.
  if (!l.loading && l.pages < MAX_PAGES) void loadList(l.key, true);
}

useYtLibrary.subscribe((s, p) => {
  if (s.songs !== p.songs || s.liked !== p.liked || s.found !== p.found) maybeGrow();
});

onLibraryReset(() => {
  useYtQueue.setState({ failed: new Map() });
});

// Section: Following the player.

useWatchStore.subscribe((s, p) => {
  // The queue is no longer the player's (a Watch play, a pin, a stop): a load that was waiting never happens.
  if (s.playing !== p.playing && (s.playing === null || s.source !== 'music')) cancelPending();
  if (s.source !== 'music' || !s.playing) return;
  const q = useYtQueue.getState();
  const e = q.entries[q.pos];
  if (!e || e.id !== s.playing.id) return;
  const key = keyOf(q.pos, e.id);
  const r = s.report;
  // The count of videos in a row that would not play starts again only when one has really played (past 2 seconds).
  if (q.errorsInRow > 0 && r.error === null && (r.time ?? 0) > PLAYED_S) useYtQueue.setState({ errorsInRow: 0 });
  if (r.error !== null && errorFor !== key) {
    errorFor = key;
    onError(r.error, q.pos, e);
    return;
  }
  if (r.ended && advancedFor !== key) {
    advancedFor = key;
    const n = nextPlayable(q.pos + 1);
    if (n !== null) request(n);
  }
});

function onError(code: number, pos: number, e: QueueEntry): void {
  const why: FailedWhy | null = code === 100 ? 'removed' : code === 101 || code === 150 ? 'embed' : null;
  if (why) markFailed(e.id, why);
  const errors = useYtQueue.getState().errorsInRow + 1;
  if (errors >= ERRORS_STOP) {
    cancelPending();
    useYtQueue.setState({ errorsInRow: 0 });
    useWatchStore.getState().stop();
    setNote(FIVE_LINE);
    return;
  }
  useYtQueue.setState({ errorsInRow: errors });
  const n = nextPlayable(pos + 1);
  if (n === null) {
    // The last one: the queue ends as it does after the last entry ends (the wall's player stops, the entries are kept, Play again is offered).
    cancelPending();
    useWatchStore.getState().stop();
    setNote(lastLine(e.title, why));
    return;
  }
  setNote(skipLine(e.title, why));
  request(n, true);
}

// Section: What the rest of the wall reads.

/** The wall's music as one value (null while no music item is in the frame and no queue is kept). */
export interface MusicView {
  entry: QueueEntry;
  /** The reported title and channel, else the entry's. */
  title: string;
  channel: string;
  thumb: string | null;
  /** 'playing', 'paused', 'ended' (the item is over) or 'stopped' (the frame is gone, the queue is kept). */
  state: 'playing' | 'paused' | 'ended' | 'stopped';
  /** Autoplay was refused: the sound starts only with a click on Watch. */
  needsClick: boolean;
  time: number | null;
  duration: number | null;
  /** Place in the queue (1 based) and its length. */
  place: number;
  count: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** A pure read of the wall's music for the given stores' states; null when there is none to show. */
export function musicView(w: Pick<WatchState, 'source' | 'playing' | 'paused' | 'needsClick' | 'report'>, q: Pick<QueueState, 'entries' | 'pos' | 'failed'>): MusicView | null {
  const entry = q.entries[q.pos];
  if (!entry || w.source !== 'music') return null;
  const live = !!w.playing && w.playing.id === entry.id;
  if (w.playing && !live) return null;
  const state: MusicView['state'] = !live ? 'stopped' : w.report.ended ? 'ended' : w.paused || w.needsClick ? 'paused' : 'playing';
  let hasPrevious = false;
  let hasNext = false;
  for (let i = 0; i < q.entries.length; i += 1) {
    if (q.failed.has(q.entries[i]!.id) || i === q.pos) continue;
    if (i < q.pos) hasPrevious = true;
    else hasNext = true;
  }
  return {
    entry,
    title: live && w.report.title ? w.report.title : entry.title,
    channel: live && w.report.channel ? w.report.channel : entry.channel,
    thumb: entry.thumb,
    state,
    needsClick: live && w.needsClick,
    time: live ? w.report.time : null,
    duration: live ? w.report.duration : null,
    place: q.pos + 1,
    count: q.entries.length,
    hasPrevious,
    hasNext,
  };
}

/** The wall's music, subscribed field by field so only a real change redraws. */
export function useMusicView(): MusicView | null {
  const source = useWatchStore((s) => s.source);
  const playing = useWatchStore((s) => s.playing);
  const paused = useWatchStore((s) => s.paused);
  const needsClick = useWatchStore((s) => s.needsClick);
  const report = useWatchStore((s) => s.report);
  const entries = useYtQueue((s) => s.entries);
  const pos = useYtQueue((s) => s.pos);
  const failed = useYtQueue((s) => s.failed);
  return musicView({ source, playing, paused, needsClick, report }, { entries, pos, failed });
}

/** The entries after the one now on that can still play, each with its place in the queue (what Up next lists and `jump` takes). */
export function upcoming(q: Pick<QueueState, 'entries' | 'pos' | 'failed'>, rows: number): { entry: QueueEntry; index: number }[] {
  const out: { entry: QueueEntry; index: number }[] = [];
  for (let i = q.pos + 1; i < q.entries.length && out.length < rows; i += 1) {
    const entry = q.entries[i]!;
    if (!q.failed.has(entry.id)) out.push({ entry, index: i });
  }
  return out;
}

/** Pause or play the wall's music, and the queue's own seek to the start (the foot and the top player share these). */
export const musicControls = {
  togglePause: (): void => {
    const st = useWatchStore.getState();
    st.setPaused(!st.paused);
  },
  seek: (seconds: number): boolean => {
    if (!Number.isFinite(seconds)) return false;
    const at = Math.max(0, Math.round(seconds));
    const sent = playerLink.send('seekTo', [at, true]);
    if (sent) useWatchStore.getState().setReport({ time: at });
    return sent;
  },
};

// A start asked from a playlist tile's menu runs once, when the opened playlist's first page has arrived. It is dropped when
// the playlist closes, when another one opens (the id no longer matches) and when the first page fails (the view shows its own line).
useYtLibrary.subscribe((s) => {
  const want = s.pendingStart;
  if (!want) return;
  if (!s.opened || s.opened.id !== want.id || s.songs.problem) {
    useYtLibrary.setState({ pendingStart: null });
    return;
  }
  if (!s.songs.loaded || s.songs.loading) return;
  useYtLibrary.setState({ pendingStart: null });
  // Nothing playable on the first page: nothing plays, and the opened view shows its own "None of these videos plays outside YouTube".
  if (s.songs.items.some((v) => queueable(v))) playAll(s.songs.items, want.shuffled, { list: 'songs', playlistId: want.id });
});

// A pin of a listed playlist takes the list's title and cover again when the Playlists list loads (one write, only when they differ).
let seenPlaylists: unknown = null;
useYtLibrary.subscribe((s) => {
  if (s.playlists.items === seenPlaylists) return;
  seenPlaylists = s.playlists.items;
  if (!s.playlists.loaded || !s.playlists.items.length) return;
  usePins.getState().refresh(s.playlists.items.map((p) => ({ kind: 'playlist' as const, id: p.id, name: p.title, art: p.thumb })));
});
