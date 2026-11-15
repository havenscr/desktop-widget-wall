import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { YtPage, YtPlayable, YtVideo } from '../../music/youtube';
import { playerLink } from '../watch/PlayerFrame';
import { SAVED_KEY } from '../watch/saved';
import { NO_REPORT, resetWatch, useWatchStore } from '../watch/store';
import { commandMessage, readPlayerMessage, YOUTUBE_EMBED_ORIGIN } from '../watch/urls';
import { AHEAD_ROWS, FIVE_LINE, MAX_FAILED, markFailed, LOAD_GAP_MS, NOTE_MS, jump, musicView, next, playAgain, playAll, playFrom, previous, queueActive, resetQueue, upcoming, useYtQueue } from './queue';
import { libraryMounted, libraryVisible, openPlaylist, resetLibrary, useYtLibrary } from './store';

vi.setConfig({ testTimeout: 20_000 });

/** Eleven characters, a valid video id, one per number. */
const id = (n: number) => `vid${String(n).padStart(8, '0')}`;
const vid = (n: number, playable: YtPlayable = 'yes'): YtVideo => ({ id: id(n), title: `Clip ${n}`, channel: `Channel ${n}`, seconds: 200, thumb: null, playable });
const rows = (n: number, grey: Record<number, YtPlayable> = {}) => Array.from({ length: n }, (_, i) => vid(i, grey[i] ?? 'yes'));
const LIST = { list: 'songs', playlistId: 'PLtest1' } as const;

const w = () => useWatchStore.getState();
const q = () => useYtQueue.getState();
const nowId = () => w().playing?.id ?? null;
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const active = () => queueActive(w(), q());
const saveOne = () => {
  localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: 'Ab3dEfGh1jK', label: 'Mine' }]));
  w().load();
};
let sent: [string, readonly (number | boolean)[] | undefined][] = [];
const realSend = playerLink.send;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T22:30:00-08:00'));
  localStorage.clear();
  resetWatch();
  resetQueue();
  resetLibrary();
  sent = [];
  playerLink.send = (func, args) => {
    sent.push([func, args]);
    return true;
  };
});
afterEach(() => {
  playerLink.send = realSend;
  vi.useRealTimers();
  mocks.clear();
  resetQueue();
  resetLibrary();
});

describe('the player error message', () => {
  const frame = {};
  const msg = (data: unknown, origin: unknown = YOUTUBE_EMBED_ORIGIN, source: unknown = frame) => readPlayerMessage(origin, source, frame, typeof data === 'string' ? data : JSON.stringify(data));

  it('gives the code for a whole number from 0 to 999 and nothing else from that message', () => {
    for (const code of [0, 2, 5, 100, 101, 150, 999]) expect(msg({ event: 'onError', info: code })).toEqual({ error: code });
    for (const bad of [1000, -1, 1.5, '101', null, undefined, Number.NaN, [101], { code: 101 }]) expect(msg({ event: 'onError', info: bad })).toBeNull();
    // Extra fields in the same message are not read.
    expect(msg({ event: 'onError', info: 150, title: 'x', playerState: 1 })).toEqual({ error: 150 });
  });

  it('refuses it from another origin or another window', () => {
    expect(msg({ event: 'onError', info: 101 }, 'https://evil.example')).toBeNull();
    expect(msg({ event: 'onError', info: 101 }, YOUTUBE_EMBED_ORIGIN, {})).toBeNull();
    expect(msg({ event: 'onError', info: 101 }, YOUTUBE_EMBED_ORIGIN, null)).toBeNull();
  });

  it('keeps the error in the report (the store compares it) and clears it for the next item', () => {
    w().setReport({ error: 101 });
    expect(w().report.error).toBe(101);
    w().setReport({ error: 101 });
    expect(w().report.error).toBe(101);
    expect(w().playMusic(id(1), 'One')).toBe(true);
    expect(w().report).toEqual(NO_REPORT);
  });

  it('keeps commands to numbers and booleans (no id, no load command)', () => {
    expect(commandMessage('seekTo', [0, true])).toBe('{"event":"command","func":"seekTo","args":[0,true]}');
    expect(JSON.parse(commandMessage('seekTo', [Number.NaN, '12' as unknown as number, true]))).toEqual({ event: 'command', func: 'seekTo', args: [true] });
  });
});

describe('playMusic', () => {
  it('refuses an id that is not eleven characters of a video id, a playlist id and a Twitch login', () => {
    for (const bad of ['abcdefghij', 'abcdefghijkl', 'PLmockPlaylist0001', 'pixel_harbor', 'abc defghij', 'abcdefghi!k', '', 'https://x']) {
      expect(w().playMusic(bad, 'x')).toBe(false);
    }
    expect(w().playing).toBeNull();
  });

  it('never writes the saved list or storage, never changes the tab, and marks the source', () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: 'Ab3dEfGh1jK', label: 'Mine' }]));
    resetWatch();
    const before = JSON.stringify(Object.entries(localStorage));
    const saved = w().saved;
    expect(w().tab).toBe('listen');
    expect(w().playMusic(id(1), '  Glass   Harbor ')).toBe(true);
    expect(w().playing).toEqual({ kind: 'video', id: id(1), label: 'Glass Harbor' });
    expect(w().source).toBe('music');
    expect(w().tab).toBe('listen');
    expect(w().saved).toBe(saved);
    expect(JSON.stringify(Object.entries(localStorage))).toBe(before);
    expect(w()).toMatchObject({ paused: false, needsClick: false, clickHint: false, stopped: null });
    // A Watch play puts the source back.
    w().play({ kind: 'video', id: 'Ab3dEfGh1jK' });
    expect(w().source).toBe('watch');
  });

  it('takes the label from the pick, cut to 60 characters, with a plain default', () => {
    w().playMusic(id(1), 'x'.repeat(100));
    expect(w().playing?.label.length).toBe(60);
    w().playMusic(id(2), '   ');
    expect(w().playing?.label).toBe('YouTube video');
  });

  it('remembers the item it replaces for the top player, and starts the same video again without a reload', () => {
    w().playMusic(id(1), 'One');
    w().playMusic(id(2), 'Two');
    expect(w().lastStopped).toEqual({ kind: 'video', id: id(1), label: 'One' });
    const item = w().playing;
    w().setPaused(true);
    w().setReport({ started: true, ended: true, time: 200, duration: 200 });
    expect(w().playMusic(id(2), 'Two')).toBe(true);
    // The very same item object stays (the frame is keyed by it, so it does not remount) and a seek goes to the player.
    expect(w().playing).toBe(item);
    expect(sent).toEqual([['seekTo', [0, true]]]);
    expect(w().paused).toBe(false);
    expect(w().report.ended).toBe(false);
  });
});

describe('the queue holds', () => {
  it('only rows that play, with an exact id, that have not failed', () => {
    const list = [vid(0), vid(1, 'embed'), vid(2, 'region'), vid(3, 'private'), vid(4, 'removed'), { ...vid(5), id: 'short' }, vid(6), vid(7)];
    playAll(list, false, LIST);
    expect(q().entries.map((e) => e.id)).toEqual([id(0), id(6), id(7)]);
    expect(q().entries.map((e) => e.at)).toEqual([0, 6, 7]);
    expect(nowId()).toBe(id(0));
  });

  it('checks the id again right before playing it and skips an entry that no longer passes', async () => {
    playAll(rows(3), false, LIST);
    useYtQueue.setState({ entries: q().entries.map((e, i) => (i === 1 ? { ...e, id: 'bad id' } : e)) });
    await flush(LOAD_GAP_MS);
    next();
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(2));
  });

  it('a row click plays the list in its order starting at that row', () => {
    playFrom(rows(6, { 1: 'embed' }), 3, LIST);
    expect(q().entries.map((e) => e.at)).toEqual([0, 2, 3, 4, 5]);
    expect(q().entries[q().pos]!.at).toBe(3);
    expect(nowId()).toBe(id(3));
    expect(active()).toBe(true);
    // A greyed row is not a start.
    playFrom(rows(6, { 1: 'embed' }), 1, LIST);
    expect(nowId()).toBe(id(3));
  });

  it('Play starts at the first playable row; Shuffle keeps every playable row once', async () => {
    const list = rows(30, { 0: 'embed', 5: 'removed' });
    playAll(list, false, LIST);
    expect(nowId()).toBe(id(1));
    expect(q().shuffled).toBe(false);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.3);
    await flush(LOAD_GAP_MS);
    playAll(list, true, LIST);
    spy.mockRestore();
    await flush(LOAD_GAP_MS);
    expect(q().shuffled).toBe(true);
    const ids = q().entries.map((e) => e.id);
    expect(ids.length).toBe(28);
    expect(new Set(ids).size).toBe(28);
    expect([...ids].sort()).toEqual(list.filter((v) => v.playable === 'yes').map((v) => v.id).sort());
    expect(ids).not.toEqual(list.filter((v) => v.playable === 'yes').map((v) => v.id));
    expect(nowId()).toBe(ids[0]);
  });
});

describe('moving through it', () => {
  beforeEach(() => {
    playAll(rows(5), false, LIST);
  });

  it('next, previous (the 3 second rule), jump, and no wrap at the end', async () => {
    await flush(LOAD_GAP_MS);
    next();
    expect(nowId()).toBe(id(1));
    await flush(LOAD_GAP_MS);
    // Within 3 seconds: the entry before.
    w().setReport({ time: 2 });
    previous();
    expect(nowId()).toBe(id(0));
    await flush(LOAD_GAP_MS);
    // At the first entry: the same one again (a seek to the start).
    previous();
    expect(nowId()).toBe(id(0));
    expect(sent).toContainEqual(['seekTo', [0, true]]);
    await flush(LOAD_GAP_MS);
    jump(3);
    expect(nowId()).toBe(id(3));
    await flush(LOAD_GAP_MS);
    // More than 3 seconds in: restart, not back.
    w().setReport({ time: 40 });
    sent.length = 0;
    previous();
    expect(nowId()).toBe(id(3));
    expect(sent).toEqual([['seekTo', [0, true]]]);
    await flush(LOAD_GAP_MS);
    next();
    expect(nowId()).toBe(id(4));
    await flush(LOAD_GAP_MS);
    next();
    await flush(LOAD_GAP_MS * 2);
    expect(nowId()).toBe(id(4));
    expect(q().pos).toBe(4);
  });

  it('loads at least a second apart: a click inside waits for the rest of it and the last click wins', async () => {
    expect(nowId()).toBe(id(0));
    next();
    next();
    jump(4);
    // The first load was just now: nothing yet.
    expect(nowId()).toBe(id(0));
    await flush(LOAD_GAP_MS - 10);
    expect(nowId()).toBe(id(0));
    await flush(20);
    expect(nowId()).toBe(id(4));
    // The load that follows waits again.
    jump(1);
    expect(nowId()).toBe(id(4));
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(1));
  });

  it('one late ended report advances once, and the end of the last entry stays ended', async () => {
    await flush(LOAD_GAP_MS);
    w().setReport({ started: true, ended: true });
    // The same report again, and again with a new object: still one step.
    useWatchStore.setState({ report: { ...w().report } });
    useWatchStore.setState({ report: { ...w().report, time: 3 } });
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(1));
    expect(q().pos).toBe(1);
    // The old item's ended report cannot move the new one: it is a new item with a fresh report.
    expect(w().report.ended).toBe(false);
    jump(4);
    await flush(LOAD_GAP_MS);
    w().setReport({ started: true, ended: true });
    await flush(LOAD_GAP_MS * 3);
    expect(nowId()).toBe(id(4));
    expect(w().report.ended).toBe(true);
    expect(sent.filter(([f]) => f === 'seekTo')).toEqual([]);
  });

  it('the once-per-entry guard keeps a later report of the same end from undoing a skip the owner made meanwhile', async () => {
    // The first load was just now, so the advance after the end waits (pending on entry 1).
    w().setReport({ started: true, ended: true });
    next();
    // The report changes again while it is still ended: without the guard this would ask for entry 1 again and drop the owner's skip.
    useWatchStore.setState({ report: { ...w().report, time: 5 } });
    useWatchStore.setState({ report: { ...w().report, time: 6 } });
    await flush(LOAD_GAP_MS + 5);
    expect(nowId()).toBe(id(2));
  });

  it('is active only for music: a Watch video with the same id as the entry now on does not make the queue active', async () => {
    const same = id(0);
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: same, label: 'Same video' }]));
    w().load();
    expect(active()).toBe(true);
    w().play({ kind: 'video', id: same });
    expect(nowId()).toBe(same);
    expect(q().entries[q().pos]!.id).toBe(same);
    expect(w().source).toBe('watch');
    expect(active()).toBe(false);
    expect(musicView(w(), q())).toBeNull();
    // Next and Previous on Watch are then the Watch video's own (a plain video has none), and never move the queue.
    sent.length = 0;
    const pos = q().pos;
    w().setReport({ started: true, time: 40 });
    await flush(LOAD_GAP_MS * 2);
    expect(q().pos).toBe(pos);
    expect(nowId()).toBe(same);
  });

  it('Play again starts the entry now on from the beginning', async () => {
    w().stop();
    expect(active()).toBe(false);
    await flush(LOAD_GAP_MS);
    playAgain();
    expect(nowId()).toBe(id(0));
    expect(active()).toBe(true);
  });

  it('lists what is next without the entries that failed', () => {
    useYtQueue.setState({ failed: new Map([[id(2), 'embed']]) });
    expect(upcoming(q(), 3).map((u) => u.entry.id)).toEqual([id(1), id(3), id(4)]);
    expect(upcoming(q(), 1).map((u) => u.index)).toEqual([1]);
  });
});

describe('what the player says about an entry', () => {
  beforeEach(() => {
    playAll(rows(8), false, LIST);
  });
  const fail = async (code: number) => {
    await flush(LOAD_GAP_MS);
    w().setReport({ error: code });
  };

  it('100 greys the row as removed, 101 and 150 as only on YouTube, each with its line, and goes to the next', async () => {
    await fail(100);
    expect(q().failed.get(id(0))).toBe('removed');
    expect(q().note).toBe('Skipped Clip 0: it is no longer on YouTube.');
    await flush(LOAD_GAP_MS);
    // The line stays through the skip's own load.
    expect(nowId()).toBe(id(1));
    expect(q().note).toBe('Skipped Clip 0: it is no longer on YouTube.');
    await fail(101);
    expect(q().failed.get(id(1))).toBe('embed');
    expect(q().note).toBe('Skipped Clip 1: it plays only on YouTube.');
    await flush(LOAD_GAP_MS);
    await fail(150);
    expect(q().failed.get(id(2))).toBe('embed');
    expect(q().note).toBe('Skipped Clip 2: it plays only on YouTube.');
  });

  it('any other code skips without greying the row', async () => {
    await fail(2);
    expect(q().failed.size).toBe(0);
    expect(q().note).toBe('Skipped Clip 0: YouTube would not play it here.');
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(1));
    await fail(5);
    expect(q().failed.size).toBe(0);
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(2));
  });

  it('five in a row stop the queue with one line; a video that plays resets the count', async () => {
    await fail(2);
    await flush(LOAD_GAP_MS);
    await fail(2);
    await flush(LOAD_GAP_MS);
    // A report that it started, with no time played, does not start the count again.
    w().setReport({ started: true });
    expect(q().errorsInRow).toBe(2);
    // One really plays (past 2 seconds): the count starts again.
    w().setReport({ started: true, time: 3 });
    expect(q().errorsInRow).toBe(0);
    for (let n = 0; n < 4; n += 1) {
      await fail(2);
      await flush(LOAD_GAP_MS);
      expect(w().playing).not.toBeNull();
    }
    await fail(2);
    expect(w().playing).toBeNull();
    expect(q().note).toBe(FIVE_LINE);
    await flush(LOAD_GAP_MS * 3);
    expect(w().playing).toBeNull();
    expect(active()).toBe(false);
    // After the stop the count is back at 0: the next play, and one error, do not stop again.
    expect(q().errorsInRow).toBe(0);
    playAgain();
    await flush(LOAD_GAP_MS);
    await fail(2);
    expect(w().playing).not.toBeNull();
  });

  it('a player that alternates started and error still reaches the five-error stop', async () => {
    for (let n = 0; n < 4; n += 1) {
      await fail(2);
      w().setReport({ started: true });
      await flush(LOAD_GAP_MS);
    }
    await fail(2);
    expect(w().playing).toBeNull();
    expect(q().note).toBe(FIVE_LINE);
  });

  it('every play the owner asks for starts the count again', async () => {
    await fail(2);
    await flush(LOAD_GAP_MS);
    expect(q().errorsInRow).toBe(1);
    next();
    expect(q().errorsInRow).toBe(0);
    await flush(LOAD_GAP_MS);
    await fail(2);
    await flush(LOAD_GAP_MS);
    jump(5);
    expect(q().errorsInRow).toBe(0);
    await flush(LOAD_GAP_MS);
    await fail(2);
    previous();
    expect(q().errorsInRow).toBe(0);
    playAll(rows(8), false, LIST);
    expect(q().errorsInRow).toBe(0);
  });

  it('an error on the last entry ends the queue: the player stops, the entries stay, a line says it was the last one, and Play again plays it', async () => {
    jump(7);
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(7));
    w().setReport({ error: 150 });
    expect(w().playing).toBeNull();
    expect(active()).toBe(false);
    expect(q().entries.length).toBe(8);
    expect(q().failed.get(id(7))).toBe('embed');
    expect(q().note).toBe('Clip 7 would not play: it plays only on YouTube. That was the last one.');
    await flush(LOAD_GAP_MS * 3);
    expect(w().playing).toBeNull();
    expect(musicView(w(), q())).toMatchObject({ state: 'stopped' });
    // Any other code uses the plain words.
    useYtQueue.setState({ failed: new Map() });
    playAgain();
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(7));
    w().setReport({ error: 2 });
    expect(q().note).toBe('Clip 7 would not play. That was the last one.');
  });

  it('plays an id again that errored before: the consumed error code is gone', async () => {
    jump(3);
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(3));
    w().setReport({ error: 2 });
    expect(w().report.error).toBe(2);
    // The owner plays that same id again before the skip has loaded: it is not skipped at once.
    expect(w().playMusic(id(3), 'Clip 3')).toBe(true);
    expect(w().report.error).toBeNull();
    expect(sent).toContainEqual(['seekTo', [0, true]]);
  });

  it('shows the line for 8 seconds and clears it at the next play, with one timer only while a line shows', async () => {
    await fail(2);
    const timers = vi.getTimerCount();
    await flush(NOTE_MS - 1);
    expect(q().note).not.toBeNull();
    await flush(2);
    expect(q().note).toBeNull();
    expect(vi.getTimerCount()).toBeLessThan(timers + 1);
    useYtQueue.setState({ note: null });
    await fail(2);
    await flush(LOAD_GAP_MS);
    w().setReport({ started: true });
    next();
    await flush(LOAD_GAP_MS);
    expect(q().note).toBeNull();
  });

  it('ignores an error for a video that is no longer the entry on', async () => {
    await flush(LOAD_GAP_MS);
    saveOne();
    w().play({ kind: 'video', id: 'Ab3dEfGh1jK' });
    w().setReport({ error: 101 });
    expect(q().failed.size).toBe(0);
    expect(q().note).toBeNull();
  });
});

describe('the stop rules and the Watch player', () => {
  beforeEach(() => {
    playAll(rows(4), false, LIST);
  });

  it.each(['hidden', 'display', 'screens-off', 'call', 'sleep'] as const)('stops the music for %s and nothing starts it again', async (why) => {
    w().stop(why);
    expect(w().playing).toBeNull();
    expect(w().stopped).not.toBeNull();
    expect(active()).toBe(false);
    await flush(LOAD_GAP_MS * 5);
    expect(w().playing).toBeNull();
    expect(q().entries.length).toBe(4);
  });

  it('a stop while a load waits cancels that load', async () => {
    next();
    w().stop();
    await flush(LOAD_GAP_MS * 2);
    expect(w().playing).toBeNull();
  });

  it('a Watch play makes the queue inactive and takes the player; a pick replaces a Watch video', async () => {
    saveOne();
    expect(active()).toBe(true);
    next();
    w().play({ kind: 'video', id: 'Ab3dEfGh1jK' });
    expect(active()).toBe(false);
    expect(w().source).toBe('watch');
    // The load that was waiting does not take the player back.
    await flush(LOAD_GAP_MS * 2);
    expect(nowId()).toBe('Ab3dEfGh1jK');
    // Picking again replaces the Watch video.
    playFrom(rows(4), 2, LIST);
    await flush(LOAD_GAP_MS * 2);
    expect(nowId()).toBe(id(2));
    expect(w().source).toBe('music');
    expect(active()).toBe(true);
  });
});

describe('the wall\'s music as one value', () => {
  it('says playing, paused, ended or stopped, with a place and what remains', () => {
    playAll(rows(3), false, LIST);
    const read = () => musicView(w(), q())!;
    expect(read()).toMatchObject({ state: 'playing', place: 1, count: 3, hasPrevious: false, hasNext: true, title: 'Clip 0' });
    w().setReport({ title: 'Clip 0 (official)', channel: 'Mira Vale', time: 66, duration: 214 });
    expect(read()).toMatchObject({ title: 'Clip 0 (official)', channel: 'Mira Vale', time: 66, duration: 214 });
    w().setPaused(true);
    expect(read().state).toBe('paused');
    w().setPaused(false);
    w().setNeedsClick(true);
    expect(read()).toMatchObject({ state: 'paused', needsClick: true });
    w().setNeedsClick(false);
    w().setReport({ ended: true });
    expect(read().state).toBe('ended');
    w().stop();
    expect(read()).toMatchObject({ state: 'stopped', time: null });
    saveOne();
    w().play({ kind: 'video', id: 'Ab3dEfGh1jK' });
    expect(musicView(w(), q())).toBeNull();
  });
});

describe('growing, only through the library store', () => {
  const page = (from: number, count: number, next: string | null): YtPage<YtVideo> => ({ items: Array.from({ length: count }, (_, i) => vid(from + i)), next });
  let tokens: unknown[] = [];
  const seed = (items: YtVideo[], nextToken: string | null, pages = 1) => {
    const unmount = libraryMounted();
    libraryVisible(true);
    useYtLibrary.setState({ opened: { id: 'PLtest1', title: 'Mix', count: 400, thumb: null }, songs: { items, next: nextToken, pages, loading: false, loaded: true, problem: null, failed: null, failedFresh: false, readAt: Date.now() } });
    return unmount;
  };
  const serve = (total: number) => {
    mocks.set('wall2_youtube_items', (a) => {
      tokens.push(a?.pageToken);
      const start = typeof a?.pageToken === 'string' ? Number(a.pageToken.replace('p', '')) : 0;
      const end = Math.min(total, start + 50);
      return page(start, end - start, end < total ? `p${end}` : null);
    });
  };
  beforeEach(() => {
    tokens = [];
  });

  it('asks the store for its next page, with the token the store holds, when within 10 entries of its end, and takes the rows when they land', async () => {
    serve(150);
    const unmount = seed(rows(50), 'p50');
    playFrom(rows(50), 45, LIST);
    await flush(0);
    await flush(0);
    expect(tokens[0]).toBe('p50');
    expect(useYtLibrary.getState().songs.items.length).toBeGreaterThan(50);
    expect(q().entries.length).toBeGreaterThan(50);
    // Every token the bridge saw was one the store handed out.
    for (const t of tokens) expect(['p50', 'p100']).toContain(t);
    unmount();
  });

  it('reads ahead up to 200 rows right after a click, page by page, and no further', async () => {
    serve(400);
    const unmount = seed(rows(50), 'p50');
    playFrom(rows(50), 0, LIST);
    for (let i = 0; i < 10; i += 1) await flush(0);
    expect(q().entries.length).toBe(AHEAD_ROWS);
    expect(tokens).toEqual(['p50', 'p100', 'p150']);
    // Far from the end and past 200: nothing more is read.
    for (let i = 0; i < 5; i += 1) await flush(1000);
    expect(tokens.length).toBe(3);
    unmount();
  });

  it('bounds the read-ahead by rows read, not by entries accepted: a list of mostly unplayable rows stops at 200 rows past the pick', async () => {
    const mostly = (n: number) => Array.from({ length: n }, (_, i) => vid(i, i % 50 === 0 ? 'yes' : 'removed'));
    mocks.set('wall2_youtube_items', (a) => {
      tokens.push(a?.pageToken);
      const start = typeof a?.pageToken === 'string' ? Number(a.pageToken.replace('p', '')) : 0;
      const end = Math.min(2000, start + 50);
      return { items: mostly(2000).slice(start, end), next: end < 2000 ? `p${end}` : null };
    });
    const unmount = seed(mostly(50), 'p50');
    playFrom(mostly(50), 0, LIST);
    for (let i = 0; i < 12; i += 1) await flush(0);
    // 200 rows read in all (50 at the start and three pages), however few of them could play.
    expect(useYtLibrary.getState().songs.items.length).toBe(200);
    expect(tokens).toEqual(['p50', 'p100', 'p150']);
    expect(q().entries.length).toBe(4);
    for (let i = 0; i < 5; i += 1) await flush(1000);
    expect(tokens.length).toBe(3);
    unmount();
  });

  it('a shuffled queue takes the new page shuffled, after what it holds', async () => {
    serve(100);
    const unmount = seed(rows(50), 'p50');
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    playAll(rows(50), true, LIST);
    const first = q().entries.map((e) => e.id);
    for (let i = 0; i < 6; i += 1) await flush(0);
    spy.mockRestore();
    const all = q().entries.map((e) => e.id);
    expect(all.slice(0, 50)).toEqual(first);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(100);
    unmount();
  });

  it('stops where its rows end once the list has left the store, and makes no call', async () => {
    serve(150);
    const unmount = seed(rows(50), 'p50');
    playFrom(rows(50), 44, LIST);
    useYtLibrary.setState({ opened: null });
    await flush(0);
    tokens.length = 0;
    jump(46);
    await flush(LOAD_GAP_MS);
    await flush(0);
    expect(tokens).toEqual([]);
    expect(q().entries.length).toBe(50);
    unmount();
  });

  it('makes no call while the library is not shown', async () => {
    serve(150);
    useYtLibrary.setState({ opened: { id: 'PLtest1', title: 'Mix', count: 400, thumb: null }, songs: { items: rows(50), next: 'p50', pages: 1, loading: false, loaded: true, problem: null, failed: null, failedFresh: false, readAt: Date.now() } });
    playFrom(rows(50), 45, LIST);
    await flush(0);
    expect(tokens).toEqual([]);
  });

  it('does not take rows of another playlist that was opened', async () => {
    serve(150);
    const unmount = seed(rows(50), 'p50');
    playFrom(rows(50), 0, LIST);
    useYtLibrary.setState({ opened: { id: 'PLother', title: 'Other', count: 3, thumb: null }, songs: { ...useYtLibrary.getState().songs, items: [vid(900), vid(901), vid(902)], next: null } });
    await flush(0);
    expect(q().entries.some((e) => e.id === id(900))).toBe(false);
    unmount();
  });
});

describe('the failed list', () => {
  it('holds at most 500 videos, dropping the oldest, and an id that fails again counts as the newest', () => {
    for (let n = 0; n < MAX_FAILED + 100; n += 1) markFailed(id(n), n % 2 ? 'embed' : 'removed');
    const failed = q().failed;
    expect(failed.size).toBe(MAX_FAILED);
    expect(failed.has(id(0))).toBe(false);
    expect(failed.has(id(99))).toBe(false);
    expect(failed.has(id(100))).toBe(true);
    expect(failed.has(id(MAX_FAILED + 99))).toBe(true);
    markFailed(id(100), 'embed');
    for (let n = 0; n < 10; n += 1) markFailed(id(2000 + n), 'embed');
    expect(q().failed.has(id(100))).toBe(true);
    expect(q().failed.has(id(101))).toBe(false);
    expect(q().failed.size).toBe(MAX_FAILED);
  });
});

describe('the library', () => {
  it('forgets the videos that failed when it is reset', () => {
    useYtQueue.setState({ failed: new Map([[id(1), 'embed']]) });
    resetLibrary();
    expect(q().failed.size).toBe(0);
  });

  it('opens a playlist only through the store (the queue never reads on its own)', () => {
    const calls: unknown[] = [];
    mocks.set('wall2_youtube_items', (a) => {
      calls.push(a);
      return { items: [], next: null };
    });
    const unmount = libraryMounted();
    playAll(rows(3), false, LIST);
    expect(calls).toEqual([]);
    openPlaylist({ id: 'PLtest1', title: 'Mix', count: 3, thumb: null });
    unmount();
  });
});
