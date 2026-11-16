import { useMemo } from 'react';
import { create } from 'zustand';
import { LOAD_GAP_MS, markFailed, PLAYED_S, useYtQueue, type FailedWhy } from '../ytmusic/queue';
import { MAX_OWN_VIDEOS, useOwnLists, type OwnList, type OwnLists } from './ownLists';
import { validId } from './links';
import { useWatchStore, type PlayerReport, type WatchState } from './store';

/**
 * Playing a playlist made on the wall, in memory only (nothing here is kept across a restart): the model is
 * the YouTube library's queue (`ytmusic/queue.ts`), with its one load timer and `LOAD_GAP_MS` spacing (the last
 * request wins), its `pos:id` keys so one report acts once, and its error codes.
 *
 * - `order` is the ids of the playlist in the order they play (the saved order, or the wall's own mix for shuffle,
 *   which never changes the saved order). `pos` is the place now on; `current` is the id on. When the playing
 *   video is removed from the playlist it keeps playing: `gone` is true and `pos` is where the next one is.
 * - The play-through is ACTIVE only while the Watch store holds a video with source `own` whose id is `current`.
 *   A Watch play, a pin, a music pick or a stop makes it inactive at once and cancels a load that was waiting;
 *   nothing restarts it. Kind `own` itself is never in the frame: each video is checked again right before
 *   `playOwnVideo`.
 * - A video that ends advances once. After the last: repeat on starts a new round (a fresh mix with shuffle),
 *   repeat off stops the player and sets `finished`. An error from the player skips the video (100, 101 and 150
 *   also grey it for the session through the library queue's `markFailed`); a round in which no video played
 *   ends the playlist with `finished.none`, so loads are bounded by 50 a round at one a second.
 * - Edits made while it plays are read at once (`sync`): the order follows the playlist, never restarting a video.
 * - The one note (the skip line) lives `OWN_NOTE_MS`, one timeout, only while it shows.
 */

export const OWN_NOTE_MS = 6000;
/** Development only: the dev mocks lengthen the note so a still can catch it. */
export const ownTiming = { noteMs: OWN_NOTE_MS };
export const NO_PLAY_LINE = 'None of these can play here';

export type SkipWhy = 'embed' | 'removed' | 'other' | 'mixed';

export interface OwnFinished {
  listId: string;
  played: number;
  total: number;
  /** No video of the last round could play. */
  none: boolean;
}

interface PlayState {
  listId: string | null;
  order: string[];
  pos: number;
  current: string | null;
  /** The playing video was removed from the playlist: `pos` is where the next one now is. */
  gone: boolean;
  /** True when `order` is a mix (the list's shuffle switch was on when it was made). */
  shuffled: boolean;
  /** The card shows the playlist being played. */
  follow: boolean;
  skipped: { count: number; why: SkipWhy } | null;
  note: string | null;
  finished: OwnFinished | null;
  /** With repeat and shuffle on, the next round's order, chosen when the last video of a round starts (so the Next line can name its first). */
  nextOrder: string[] | null;
}

const fresh = (): PlayState => ({ listId: null, order: [], pos: 0, current: null, gone: false, shuffled: false, follow: false, skipped: null, note: null, finished: null, nextOrder: null });

export const useOwnPlay = create<PlayState>(() => fresh());

const s = () => useOwnPlay.getState();

// Section: The one note, the one load timer.

let noteTimer: ReturnType<typeof setTimeout> | undefined;

function setNote(line: string | null): void {
  clearTimeout(noteTimer);
  noteTimer = undefined;
  useOwnPlay.setState({ note: line });
  if (line) {
    noteTimer = setTimeout(() => {
      noteTimer = undefined;
      useOwnPlay.setState({ note: null });
    }, ownTiming.noteMs);
  }
}

export function skipLine(count: number, why: SkipWhy): string {
  if (count <= 1) {
    if (why === 'embed') return 'Skipped one: it plays only on YouTube';
    if (why === 'removed') return 'Skipped one: it is no longer on YouTube';
    return 'Skipped one: YouTube would not play it here';
  }
  if (why === 'embed') return `Skipped ${count}: they play only on YouTube`;
  if (why === 'removed') return `Skipped ${count}: they are no longer on YouTube`;
  return `Skipped ${count}: YouTube would not play them here`;
}

let lastLoadAt = -Infinity;
/** A load waiting out the spacing: the video it is for (by id, so an edit of the order cannot leave it pointing at the wrong place). */
let pending: { id: string; keepNote: boolean } | null = null;

/** Where the waiting load's video is in the order now, or -1 when it has left the playlist. */
const pendingPos = (): number => (pending ? s().order.indexOf(pending.id) : -1);
let loadTimer: ReturnType<typeof setTimeout> | undefined;
/** Which load of which video has had its end or its error acted on (`<load number>:<id>`), so a second report does nothing. */
let advancedFor: string | null = null;
let errorFor: string | null = null;
let loadNo = 0;
/** The videos that played in the round now on. */
let roundPlayed = new Set<string>();
let learnedKey = '';

function cancelPending(): void {
  clearTimeout(loadTimer);
  loadTimer = undefined;
  pending = null;
}

// Section: What can be read.

const lists = (): OwnLists => useOwnLists.getState().lists;
const listNow = (): OwnList | null => {
  const id = s().listId;
  return id ? (lists()[id] ?? null) : null;
};

function mix(ids: readonly string[], first?: string): string[] {
  const rest = ids.filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return first !== undefined && ids.includes(first) ? [first, ...rest] : rest;
}

const failed = () => useYtQueue.getState().failed;

/** The first place at or after `from` whose video has not failed this session, or null. */
function playableFrom(from: number): number | null {
  const { order } = s();
  const bad = failed();
  for (let i = Math.max(0, from); i < order.length; i += 1) if (!bad.has(order[i]!)) return i;
  return null;
}

function playableBefore(from: number): number | null {
  const { order } = s();
  const bad = failed();
  for (let i = Math.min(from, order.length - 1); i >= 0; i -= 1) if (!bad.has(order[i]!)) return i;
  return null;
}

/** Where the next video is looked for: right after `pos`, or at `pos` when the playing video has left the playlist. */
const afterPos = (): number => (s().gone ? s().pos : s().pos + 1);

function titleOf(id: string): string {
  const l = listNow();
  return l?.items.find((i) => i.id === id)?.title ?? '';
}

/** True while the play-through is the wall's player. */
export function isOwnActive(w: Pick<WatchState, 'source' | 'playing'> = useWatchStore.getState(), o: Pick<PlayState, 'listId' | 'current'> = s()): boolean {
  return w.source === 'own' && !!w.playing && !!o.listId && o.current === w.playing.id;
}

// Section: Loading.

function load(pos: number, keepNote = false): void {
  const id = s().order[pos];
  if (id === undefined) return;
  clearTimeout(loadTimer);
  loadTimer = undefined;
  pending = null;
  lastLoadAt = Date.now();
  advancedFor = null;
  errorFor = null;
  loadNo += 1;
  // The play-through is the player's before the Watch store announces the new video.
  useOwnPlay.setState({ pos, current: id, gone: false });
  if (!keepNote) {
    useOwnPlay.setState({ skipped: null });
    setNote(null);
  }
  // The id is checked again right here (`playOwnVideo` refuses anything that is not a video id).
  if (!validId('video', id) || !useWatchStore.getState().playOwnVideo(id, titleOf(id) || 'YouTube video')) {
    markFailed(id, 'removed');
    advance(pos + 1, keepNote);
    return;
  }
  planNext();
}

/** Ask for the video at `pos`: at once when a second has passed since the last load, else after the rest of it (the last request wins). */
function request(pos: number, keepNote = false): void {
  const wait = lastLoadAt + LOAD_GAP_MS - Date.now();
  if (wait <= 0 && pending === null) {
    load(pos, keepNote);
    return;
  }
  const id = s().order[pos];
  if (id === undefined) return;
  pending = { id, keepNote };
  if (loadTimer === undefined) {
    loadTimer = setTimeout(() => {
      loadTimer = undefined;
      const p = pending;
      pending = null;
      if (!p) return;
      const at = s().order.indexOf(p.id);
      // The video left the playlist while the load waited: go on to the one that now follows, or end the round.
      if (at >= 0 && !failed().has(p.id)) load(at, p.keepNote);
      else advance(at >= 0 ? at + 1 : afterPos(), p.keepNote);
    }, Math.max(0, wait));
  }
}

/** The next playable video from `from`, else the end of the round. */
function advance(from: number, keepNote: boolean, byOwner = false): void {
  const n = playableFrom(from);
  if (n !== null) request(n, keepNote);
  else endOfRound(byOwner);
}

function endOfRound(byOwner: boolean): void {
  const id = s().listId;
  const list = listNow();
  if (!id || !list) return;
  const played = roundPlayed.size;
  if (list.repeat && (played > 0 || byOwner) && newRound(list)) return;
  finish(id, played, !byOwner && played === 0);
}

/** A new round from the first video (a fresh mix with shuffle whose first differs from the one just played). False when nothing in it can play. */
function newRound(list: OwnList): boolean {
  const ids = list.items.map((i) => i.id);
  if (ids.length === 0) return false;
  const cur = s().current ?? undefined;
  const planned = s().nextOrder;
  // With shuffle the round starts with the order chosen when the last video began (the Next line named its first).
  const order = list.shuffle ? (planned && validPlan(planned, ids, cur) ? planned : mixAvoiding(ids, cur)) : ids;
  useOwnPlay.setState({ order, shuffled: list.shuffle, pos: 0, gone: false, nextOrder: null });
  const n = playableFrom(0);
  roundPlayed = new Set();
  if (n === null) return false;
  request(n, true);
  return true;
}

/** A fresh mix whose first video is not `cur` (when the playlist holds more than one). */
function mixAvoiding(ids: readonly string[], cur: string | undefined): string[] {
  const order = mix(ids);
  if (ids.length > 1 && order[0] === cur) {
    const j = 1 + Math.floor(Math.random() * (order.length - 1));
    [order[0], order[j]] = [order[j]!, order[0]!];
  }
  return order;
}

const validPlan = (plan: readonly string[], ids: readonly string[], cur: string | undefined): boolean =>
  plan.length === ids.length && ids.every((i) => plan.includes(i)) && (ids.length < 2 || plan[0] !== cur);

/**
 * With repeat and shuffle on, at the last video of a round the next round's order is chosen now (its first video differs
 * from the one playing), so the Next line can name it and the round that follows uses exactly that order. Anywhere else
 * nothing is planned.
 */
function planNext(): void {
  const o = s();
  const list = listNow();
  const ids = list ? list.items.map((i) => i.id) : [];
  const last = !!list && list.repeat && list.shuffle && ids.length > 0 && !!o.current && playableFrom(afterPos()) === null;
  if (!last) {
    if (o.nextOrder) useOwnPlay.setState({ nextOrder: null });
    return;
  }
  if (o.nextOrder && validPlan(o.nextOrder, ids, o.current ?? undefined)) return;
  useOwnPlay.setState({ nextOrder: mixAvoiding(ids, o.current ?? undefined) });
}

function finish(listId: string, played: number, none: boolean, stopPlayer = true): void {
  cancelPending();
  const total = s().order.length;
  useOwnPlay.setState({ finished: { listId, played, total, none }, follow: false, skipped: null });
  setNote(null);
  // Nothing of this playlist was ever loaded (every video had failed): what else is playing is not this playlist's to stop.
  if (stopPlayer) useWatchStore.getState().stop();
}

// Section: What the owner does.

/** Play a playlist from its first video (or from `fromVideo`); false when it has nothing that can play. */
export function playOwn(listId: string, fromVideo?: string): boolean {
  const list = lists()[listId];
  if (!list) return false;
  const ids = list.items.map((i) => i.id).filter((i) => validId('video', i)).slice(0, MAX_OWN_VIDEOS);
  if (ids.length === 0) return false;
  const first = fromVideo !== undefined && ids.includes(fromVideo) ? fromVideo : undefined;
  const order = list.shuffle ? mix(ids, first) : ids;
  const pos = list.shuffle ? 0 : first !== undefined ? ids.indexOf(first) : 0;
  cancelPending();
  roundPlayed = new Set();
  // A play the owner asked for is heard, even after a Watch video was muted.
  useWatchStore.getState().setMuted(false);
  useOwnPlay.setState({ listId, order, pos, current: null, gone: false, shuffled: list.shuffle, follow: true, skipped: null, note: null, finished: null });
  setNote(null);
  const n = playableFrom(pos);
  if (n === null) {
    finish(listId, 0, true, false);
    return false;
  }
  request(n);
  return true;
}

export function next(): void {
  if (!s().listId || (!isOwnActive() && !pending)) return;
  const at = pendingPos();
  const base = pending ? (at >= 0 ? at + 1 : afterPos()) : afterPos();
  advance(base, false, true);
}

/** Back: the start of this video when more than 3 seconds in (or on the first), else the video before. */
export function previous(): void {
  if (!s().listId || (!isOwnActive() && !pending)) return;
  const at = pendingPos();
  const base = pending && at >= 0 ? at : s().pos;
  const time = useWatchStore.getState().report.time ?? 0;
  const before = pending || time <= 3 ? playableBefore(base - 1) : null;
  request(before ?? base);
}

/** Play this video of the playlist now. */
export function jump(videoId: string): void {
  if (!isOwnActive() && !pending) return;
  const { order } = s();
  const at = order.indexOf(videoId);
  if (at < 0 || failed().has(videoId)) return;
  useOwnPlay.setState({ finished: null });
  request(at);
}

/** "Play again": from the start (a fresh mix with shuffle on). */
export function playAgain(): boolean {
  const id = s().finished?.listId ?? s().listId;
  return id ? playOwn(id) : false;
}

export function setFollow(on: boolean): void {
  if (s().follow !== on) useOwnPlay.setState({ follow: on });
}

/** Gone: the play-through and its timers (tests, and a deleted playlist). */
export function resetOwnPlay(): void {
  cancelPending();
  clearTimeout(noteTimer);
  noteTimer = undefined;
  lastLoadAt = -Infinity;
  advancedFor = null;
  errorFor = null;
  loadNo = 0;
  roundPlayed = new Set();
  learnedKey = '';
  reported.clear();
  useOwnPlay.setState(fresh());
}

// Section: Following the player.

function onError(code: number, id: string): void {
  const known: FailedWhy | null = code === 100 ? 'removed' : code === 101 || code === 150 ? 'embed' : null;
  if (known) markFailed(id, known);
  const why: SkipWhy = known ?? 'other';
  const cur = s().skipped;
  const skipped = cur ? { count: cur.count + 1, why: cur.why === why ? why : ('mixed' as const) } : { count: 1, why };
  useOwnPlay.setState({ skipped });
  setNote(skipLine(skipped.count, skipped.why));
  advance(afterPos(), true);
}

/** What the player has reported for each video this session (title, channel, length), at most `MAX_REPORTED`; a list row's add uses it. */
const MAX_REPORTED = 200;
const reported = new Map<string, { title?: string; channel?: string; seconds?: number }>();

/** What was reported for this video this session, or nothing. */
export function reportedFor(id: string): { title?: string; channel?: string; seconds?: number } {
  return reported.get(id) ?? {};
}

function remember(id: string, info: { title?: string; channel?: string; seconds?: number }): void {
  const cur = reported.get(id) ?? {};
  reported.delete(id);
  reported.set(id, { ...cur, ...(info.title ? { title: info.title } : {}), ...(info.channel ? { channel: info.channel } : {}), ...(info.seconds !== undefined ? { seconds: info.seconds } : {}) });
  while (reported.size > MAX_REPORTED) reported.delete(reported.keys().next().value as string);
}

function learnFrom(w: WatchState): void {
  const p = w.playing;
  if (!p || p.kind !== 'video') return;
  const r: PlayerReport = w.report;
  const seconds = r.duration !== null && r.duration > 0 ? r.duration : undefined;
  if (!r.title && !r.channel && seconds === undefined) return;
  const key = `${p.id}|${r.title ?? ''}|${r.channel ?? ''}|${seconds ?? ''}`;
  if (key === learnedKey) return;
  learnedKey = key;
  remember(p.id, { title: r.title ?? undefined, channel: r.channel ?? undefined, seconds });
  useOwnLists.getState().learn(p.id, { title: r.title ?? undefined, channel: r.channel ?? undefined, seconds });
}

useWatchStore.subscribe((w, prev) => {
  learnFrom(w);
  if (w.playing !== prev.playing) {
    // The play-through is no longer the player's (a Watch play, a pin, a music pick, a stop): a load that was waiting never happens.
    if (w.playing === null || w.source !== 'own') {
      cancelPending();
      // Nothing of the skip note outlives the play-through: its text and its timer go with it.
      if (s().note !== null || noteTimer !== undefined) setNote(null);
    }
    // Any play clears the end block.
    if (w.playing && s().finished) useOwnPlay.setState({ finished: null });
  }
  const o = s();
  if (!isOwnActive(w, o)) return;
  const id = o.current!;
  const key = `${loadNo}:${id}`;
  const r = w.report;
  if (r.started || r.ended) roundPlayed.add(id);
  // The skip count starts again only when a video has really played (past 2 seconds).
  if (o.skipped && r.error === null && (r.time ?? 0) > PLAYED_S) useOwnPlay.setState({ skipped: null });
  if (r.error !== null && errorFor !== key) {
    errorFor = key;
    onError(r.error, id);
    return;
  }
  if (r.ended && advancedFor !== key) {
    advancedFor = key;
    advance(afterPos(), false);
  }
});

// Section: Edits while it plays.

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Read the playlist again: a deleted one stops; a shuffle switch remakes the order around the video on; edits are folded in. */
function sync(): void {
  syncOrder();
  planNext();
}

function syncOrder(): void {
  const o = s();
  if (!o.listId) return;
  const watch = useWatchStore.getState();
  const list = lists()[o.listId];
  const entry = watch.saved.some((i) => i.kind === 'own' && i.id === o.listId);
  if (!list || !entry) {
    const was = isOwnActive(watch, o);
    cancelPending();
    setNote(null);
    const keepFinished = o.finished && o.finished.listId !== o.listId ? o.finished : null;
    useOwnPlay.setState({ ...fresh(), finished: keepFinished });
    if (was) watch.stop();
    return;
  }
  if (!isOwnActive(watch, o)) return;
  const ids = list.items.map((i) => i.id);
  const cur = o.current!;
  if (list.shuffle !== o.shuffled) {
    if (list.shuffle) {
      const inList = ids.includes(cur);
      useOwnPlay.setState({ order: inList ? mix(ids, cur) : mix(ids), pos: 0, gone: !inList, shuffled: true });
    } else {
      const at = ids.indexOf(cur);
      useOwnPlay.setState({ order: ids, pos: at >= 0 ? at : Math.min(o.pos, ids.length), gone: at < 0, shuffled: false });
    }
    return;
  }
  // Without shuffle the order is the saved order; with shuffle the mix drops removed ids and appends added ones.
  let order: string[];
  if (list.shuffle) {
    const have = new Set(ids);
    const kept = o.order.filter((i) => have.has(i));
    const known = new Set(kept);
    order = [...kept, ...ids.filter((i) => !known.has(i))];
  } else order = ids;
  if (sameIds(order, o.order)) return;
  const at = order.indexOf(cur);
  if (at >= 0) useOwnPlay.setState({ order, pos: at, gone: false });
  else {
    const have = new Set(order);
    const before = o.order.slice(0, o.pos).filter((i) => have.has(i)).length;
    useOwnPlay.setState({ order, pos: list.shuffle ? before : Math.min(o.pos, order.length), gone: true });
  }
}

useOwnLists.subscribe((st, prev) => {
  if (st.lists !== prev.lists) sync();
});

// Section: What the rest of the wall reads.

export interface OwnView {
  listId: string;
  /** The playlist's name. */
  name: string;
  videoId: string;
  /** The reported title, else the stored one, else "YouTube video". */
  title: string;
  channel: string;
  /** Place in the order (1 based) and its length. */
  place: number;
  count: number;
  /** The video after this one (the first, with repeat on at the last), or null when none follows. */
  next: { id: string; title: string } | null;
  last: boolean;
  repeat: boolean;
  shuffle: boolean;
  follow: boolean;
  note: string | null;
  paused: boolean;
  ended: boolean;
  time: number | null;
  duration: number | null;
}

type Watching = Pick<WatchState, 'source' | 'playing' | 'paused' | 'report' | 'saved'>;

/** A pure read of the play-through; null while it is not the player's. */
export function ownView(w: Watching, o: PlayState, all: OwnLists): OwnView | null {
  if (!isOwnActive(w, o)) return null;
  const listId = o.listId!;
  const list = all[listId];
  const entry = w.saved.find((i) => i.kind === 'own' && i.id === listId);
  if (!list || !entry) return null;
  const id = o.current!;
  const stored = list.items.find((i) => i.id === id);
  const bad = useYtQueue.getState().failed;
  let nextId: string | null = null;
  for (let i = o.gone ? o.pos : o.pos + 1; i < o.order.length; i += 1) {
    if (!bad.has(o.order[i]!)) {
      nextId = o.order[i]!;
      break;
    }
  }
  const last = nextId === null;
  // With repeat on at the last video, the next round starts at the first.
  if (last && list.repeat && !list.shuffle) nextId = list.items.find((i) => !bad.has(i.id))?.id ?? null;
  // With shuffle on, the next round's order was chosen when this last video began.
  if (last && list.repeat && list.shuffle) nextId = o.nextOrder?.find((i) => !bad.has(i)) ?? null;
  const nextItem = nextId ? list.items.find((i) => i.id === nextId) : undefined;
  return {
    listId,
    name: entry.label,
    videoId: id,
    title: w.report.title || stored?.title || 'YouTube video',
    channel: w.report.channel || stored?.channel || '',
    place: Math.max(1, Math.min(o.pos + 1, o.order.length)),
    count: o.order.length,
    next: nextId ? { id: nextId, title: nextItem?.title || 'YouTube video' } : null,
    last,
    repeat: list.repeat,
    shuffle: list.shuffle,
    follow: o.follow,
    note: o.note,
    paused: w.paused,
    ended: w.report.ended,
    time: w.report.time,
    duration: w.report.duration,
  };
}

/** The play-through, subscribed field by field so only a real change redraws. */
export function useOwnView(): OwnView | null {
  const source = useWatchStore((x) => x.source);
  const playing = useWatchStore((x) => x.playing);
  const paused = useWatchStore((x) => x.paused);
  const report = useWatchStore((x) => x.report);
  const saved = useWatchStore((x) => x.saved);
  const o = useOwnPlay();
  const all = useOwnLists((x) => x.lists);
  const failedNow = useYtQueue((x) => x.failed);
  return useMemo(() => ownView({ source, playing, paused, report, saved }, o, all), [source, playing, paused, report, saved, o, all, failedNow]);
}

export function useOwnActive(): boolean {
  return useOwnView() !== null;
}

/** The skip note and the end block read while nothing else is on: the idle block's own view. */
export function useOwnFinished(): OwnFinished | null {
  return useOwnPlay((x) => x.finished);
}
