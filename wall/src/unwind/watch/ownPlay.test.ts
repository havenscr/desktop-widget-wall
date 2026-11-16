import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOAD_GAP_MS, resetQueue, useYtQueue } from '../ytmusic/queue';
import { OWN_KEY, resetOwnLists, useOwnLists } from './ownLists';
import { jump, next, OWN_NOTE_MS, ownView, playAgain, playOwn, previous, resetOwnPlay, skipLine, useOwnPlay } from './ownPlay';
import { resetWatch, useWatchStore } from './store';
import { SAVED_KEY } from './saved';

vi.setConfig({ testTimeout: 20_000 });

const vid = (n: number) => `Vid${String(n).padStart(8, '0')}`;
const W = () => useWatchStore.getState();
const O = () => useOwnPlay.getState();
const L = () => useOwnLists.getState();

/** A playlist of `n` videos, named and stored; the id back. */
function make(n: number, opts: { shuffle?: boolean; repeat?: boolean } = {}): string {
  const r = L().create('Wind down');
  if (!r.ok) throw new Error('create');
  for (let i = 1; i <= n; i++) L().addVideo(r.id, { id: vid(i), title: `Video ${i}` });
  if (opts.shuffle) L().setShuffle(r.id, true);
  if (opts.repeat) L().setRepeat(r.id, true);
  return r.id;
}

const tick = (ms = LOAD_GAP_MS) => vi.advanceTimersByTime(ms);
const playingId = () => W().playing?.id ?? null;
/** The player says the video on has started, then ended. */
const started = () => W().setReport({ started: true, time: 5, duration: 100 });
const ended = () => W().setReport({ ended: true });
const error = (code: number) => W().setReport({ error: code });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
  localStorage.clear();
  resetWatch();
  resetOwnLists();
  resetQueue();
  resetOwnPlay();
});
afterEach(() => {
  resetOwnPlay();
  resetQueue();
  vi.useRealTimers();
  localStorage.clear();
});

describe('starting', () => {
  it('plays the saved order from the first video, through the one player', () => {
    const id = make(3);
    expect(playOwn(id)).toBe(true);
    expect(playingId()).toBe(vid(1));
    expect(W().source).toBe('own');
    expect(W().playing?.label).toBe('Video 1');
    expect(O()).toMatchObject({ order: [vid(1), vid(2), vid(3)], pos: 0, follow: true, finished: null });
    expect(W().tab).toBe('listen');
  });

  it('starts at a clicked video in the saved order', () => {
    const id = make(4);
    playOwn(id, vid(3));
    expect(playingId()).toBe(vid(3));
    expect(O().order).toEqual([vid(1), vid(2), vid(3), vid(4)]);
    expect(O().pos).toBe(2);
  });

  it('with shuffle plays every video once in a mix, the clicked one first', () => {
    const id = make(8, { shuffle: true });
    playOwn(id, vid(5));
    expect(O().order[0]).toBe(vid(5));
    expect([...O().order].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(vid).sort());
    expect(playingId()).toBe(vid(5));
    // The saved order never changes.
    expect(L().lists[id].items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(vid));
  });

  it('uses "YouTube video" for an unnamed one and refuses an empty playlist', () => {
    const r = L().create('Empty');
    if (!r.ok) throw new Error('create');
    expect(playOwn(r.id)).toBe(false);
    expect(playingId()).toBeNull();
    L().addVideo(r.id, { id: vid(1) });
    playOwn(r.id);
    expect(W().playing?.label).toBe('YouTube video');
  });

  it('skips a video that failed this session', () => {
    const id = make(3);
    useYtQueue.setState({ failed: new Map([[vid(1), 'embed' as const]]) });
    playOwn(id);
    expect(playingId()).toBe(vid(2));
  });
});

describe('being active', () => {
  it('is the player only for source own and the right id', () => {
    const id = make(2);
    playOwn(id);
    expect(ownView(W(), O(), L().lists)).not.toBeNull();
    W().playMusic(vid(9), 'x');
    expect(ownView(W(), O(), L().lists)).toBeNull();
  });

  it.each(['hidden', 'display', 'call', 'screens-off', 'sleep'] as const)('stop reason %s makes it inactive and nothing restarts', (why) => {
    const id = make(3);
    playOwn(id);
    started();
    ended();
    expect(O().pos).toBe(0);
    W().stop(why);
    tick(5000);
    expect(playingId()).toBeNull();
    expect(O().pos).toBe(0);
  });

  it('a Watch play cancels a load that is waiting', () => {
    const id = make(3);
    playOwn(id);
    started();
    ended();
    W().addRef({ kind: 'video', id: vid(7) }, false);
    W().play({ kind: 'video', id: vid(7) });
    tick(5000);
    expect(playingId()).toBe(vid(7));
    expect(W().source).toBe('watch');
  });

  it('a music pick makes it inactive and a late ended does nothing', () => {
    const id = make(3);
    playOwn(id);
    W().playMusic(vid(8), 'Song');
    W().setReport({ ended: true });
    tick(5000);
    expect(playingId()).toBe(vid(8));
  });
});

describe('advancing', () => {
  it('moves on once when the video ends, a second after the last load', () => {
    const id = make(3);
    playOwn(id);
    started();
    vi.advanceTimersByTime(300);
    ended();
    expect(playingId()).toBe(vid(1));
    tick(LOAD_GAP_MS - 300 - 1);
    expect(playingId()).toBe(vid(1));
    tick(1);
    expect(playingId()).toBe(vid(2));
    expect(W().report.ended).toBe(false);
    expect(O().pos).toBe(1);
  });

  it('acts at once when a second has passed, and once per video even if told again', () => {
    const id = make(3);
    playOwn(id);
    started();
    tick(1500);
    ended();
    expect(playingId()).toBe(vid(2));
    // A late second report of the first video's end does nothing to the new one.
    W().setReport({ ended: false });
    tick(1500);
    expect(playingId()).toBe(vid(2));
  });

  it('after the last video with repeat off stops, with the counts', () => {
    const id = make(2);
    playOwn(id);
    started();
    tick(1500);
    ended();
    started();
    tick(1500);
    ended();
    expect(playingId()).toBeNull();
    expect(O().finished).toEqual({ listId: id, played: 2, total: 2, none: false });
    expect(O().follow).toBe(false);
  });

  it('reports fewer played when one was skipped', () => {
    const id = make(3);
    playOwn(id);
    started();
    tick(1500);
    ended();
    error(150);
    tick(1500);
    started();
    tick(1500);
    ended();
    expect(O().finished).toEqual({ listId: id, played: 2, total: 3, none: false });
  });

  it('with repeat on starts a new round from the first', () => {
    const id = make(2, { repeat: true });
    playOwn(id);
    started();
    tick(1500);
    ended();
    started();
    tick(1500);
    ended();
    tick(LOAD_GAP_MS);
    expect(playingId()).toBe(vid(1));
    expect(O().pos).toBe(0);
    expect(O().finished).toBeNull();
  });

  it('a one video playlist on repeat plays the same video again without a new frame item', () => {
    const id = make(1, { repeat: true });
    playOwn(id);
    started();
    tick(1500);
    const item = W().playing;
    ended();
    expect(W().playing).toBe(item);
    expect(W().paused).toBe(false);
    expect(W().report.ended).toBe(false);
  });

  it('with shuffle each new round is a fresh mix not starting with the video just played', () => {
    const id = make(5, { shuffle: true, repeat: true });
    for (let trial = 0; trial < 20; trial++) {
      resetOwnPlay();
      resetWatch();
      playOwn(id);
      // Fast forward to the last place.
      for (let i = 0; i < 4; i++) {
        started();
        tick(1500);
        ended();
      }
      const last = playingId();
      started();
      tick(1500);
      ended();
      tick(LOAD_GAP_MS);
      expect(O().order).toHaveLength(5);
      expect(playingId()).not.toBe(last);
    }
  });
});

describe('errors', () => {
  it.each([
    [100, 'removed', 'Skipped one: it is no longer on YouTube'],
    [101, 'embed', 'Skipped one: it plays only on YouTube'],
    [150, 'embed', 'Skipped one: it plays only on YouTube'],
  ] as const)('code %i marks the video failed and skips with its line', (code, why, line) => {
    const id = make(3);
    playOwn(id);
    tick(1500);
    error(code);
    expect(useYtQueue.getState().failed.get(vid(1))).toBe(why);
    expect(O().note).toBe(line);
    expect(playingId()).toBe(vid(2));
  });

  it('another code skips without marking, with the plain line', () => {
    const id = make(3);
    playOwn(id);
    tick(1500);
    error(5);
    expect(useYtQueue.getState().failed.has(vid(1))).toBe(false);
    expect(O().note).toBe('Skipped one: YouTube would not play it here');
    expect(playingId()).toBe(vid(2));
  });

  it('several in a row are counted and worded; a played video starts the count again', () => {
    const id = make(6);
    playOwn(id);
    error(101);
    tick(LOAD_GAP_MS);
    error(150);
    tick(LOAD_GAP_MS);
    expect(O().note).toBe('Skipped 2: they play only on YouTube');
    error(5);
    expect(O().note).toBe('Skipped 3: YouTube would not play them here');
    tick(LOAD_GAP_MS);
    W().setReport({ started: true, time: 3, duration: 100 });
    expect(O().skipped).toBeNull();
    expect(skipLine(4, 'removed')).toBe('Skipped 4: they are no longer on YouTube');
  });

  it('the note goes after six seconds', () => {
    const id = make(3);
    playOwn(id);
    error(101);
    expect(O().note).not.toBeNull();
    tick(OWN_NOTE_MS - 1);
    expect(O().note).not.toBeNull();
    tick(1);
    expect(O().note).toBeNull();
  });

  it('a round with no video played ends the playlist with none, with or without repeat', () => {
    for (const repeat of [false, true]) {
      resetOwnPlay();
      resetWatch();
      resetQueue();
      localStorage.clear();
      resetOwnLists();
      const id = make(3, { repeat });
      playOwn(id);
      for (let i = 0; i < 3; i++) {
        error(101);
        tick(LOAD_GAP_MS);
      }
      expect(playingId()).toBeNull();
      expect(O().finished).toMatchObject({ listId: id, played: 0, total: 3, none: true });
    }
  });

  it('each failing video is only loaded once per round, a second apart', () => {
    const id = make(4);
    const loads: string[] = [];
    const un = useWatchStore.subscribe((s, p) => {
      if (s.playing && s.playing !== p.playing) loads.push(s.playing.id);
    });
    playOwn(id);
    for (let i = 0; i < 4; i++) {
      error(150);
      tick(LOAD_GAP_MS);
    }
    un();
    expect(loads).toEqual([vid(1), vid(2), vid(3), vid(4)]);
  });
});

describe('the owner steps', () => {
  it('Next goes to the next playable video, and on the last ends the playlist', () => {
    const id = make(2);
    playOwn(id);
    tick(LOAD_GAP_MS);
    next();
    expect(playingId()).toBe(vid(2));
    tick(LOAD_GAP_MS);
    next();
    expect(playingId()).toBeNull();
    expect(O().finished).toMatchObject({ played: 0, total: 2, none: false });
  });

  it('Next on the last with repeat starts the first', () => {
    const id = make(2, { repeat: true });
    playOwn(id, vid(2));
    tick(LOAD_GAP_MS);
    next();
    expect(playingId()).toBe(vid(1));
  });

  it('Previous restarts after 3 seconds or on the first, else goes back', () => {
    const id = make(3);
    playOwn(id, vid(2));
    tick(LOAD_GAP_MS);
    W().setReport({ time: 2 });
    previous();
    expect(playingId()).toBe(vid(1));
    tick(LOAD_GAP_MS);
    W().setReport({ time: 2 });
    previous();
    expect(playingId()).toBe(vid(1));
    expect(O().pos).toBe(0);
    playOwn(id, vid(3));
    tick(LOAD_GAP_MS);
    W().setReport({ time: 40 });
    previous();
    expect(playingId()).toBe(vid(3));
  });

  it('jump plays the video chosen, not a failed one', () => {
    const id = make(4);
    playOwn(id);
    tick(LOAD_GAP_MS);
    jump(vid(3));
    expect(playingId()).toBe(vid(3));
    useYtQueue.setState({ failed: new Map([[vid(4), 'embed' as const]]) });
    tick(LOAD_GAP_MS);
    jump(vid(4));
    tick(LOAD_GAP_MS);
    expect(playingId()).toBe(vid(3));
  });

  it('Play again after the end starts from the first, with a fresh mix when shuffle is on', () => {
    const id = make(3);
    playOwn(id);
    next();
    tick(LOAD_GAP_MS);
    next();
    tick(LOAD_GAP_MS);
    next();
    expect(O().finished).not.toBeNull();
    tick(LOAD_GAP_MS);
    expect(playAgain()).toBe(true);
    expect(playingId()).toBe(vid(1));
    expect(O().finished).toBeNull();
  });
});

describe('edits and the shuffle switch while it plays', () => {
  it('shuffle on mixes the others with the video on first; off returns to the saved order at its saved place', () => {
    const id = make(6);
    playOwn(id, vid(4));
    L().setShuffle(id, true);
    expect(O().order[0]).toBe(vid(4));
    expect(O().pos).toBe(0);
    expect([...O().order].sort()).toEqual([1, 2, 3, 4, 5, 6].map(vid));
    L().setShuffle(id, false);
    expect(O().order).toEqual([1, 2, 3, 4, 5, 6].map(vid));
    expect(O().pos).toBe(3);
    expect(L().lists[id].items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6].map(vid));
    expect(playingId()).toBe(vid(4));
  });

  it('without shuffle the next entry follows the saved order at advance time', () => {
    const id = make(4);
    playOwn(id);
    L().move(id, 3, 1);
    expect(O().order).toEqual([vid(1), vid(4), vid(2), vid(3)]);
    started();
    tick(1500);
    ended();
    expect(playingId()).toBe(vid(4));
  });

  it('removing the video on keeps it playing, and the one now at its place is next', () => {
    const id = make(4);
    playOwn(id, vid(2));
    L().removeVideo(id, vid(2));
    expect(playingId()).toBe(vid(2));
    expect(O().gone).toBe(true);
    tick(1500);
    ended();
    expect(playingId()).toBe(vid(3));
    expect(O().gone).toBe(false);
  });

  it('with shuffle the mix drops removed ids and appends added ones', () => {
    const id = make(4, { shuffle: true });
    playOwn(id);
    const first = O().order[0]!;
    const other = [1, 2, 3, 4].map(vid).find((v) => v !== first)!;
    L().removeVideo(id, other);
    L().addVideo(id, { id: vid(9) });
    expect(O().order).toHaveLength(4);
    expect(O().order).not.toContain(other);
    expect(O().order[O().order.length - 1]).toBe(vid(9));
    expect(O().order[0]).toBe(first);
  });

  it('deleting the playlist stops it and clears the play-through', () => {
    const id = make(3);
    playOwn(id);
    L().deleteList(id);
    expect(playingId()).toBeNull();
    expect(O().listId).toBeNull();
  });

  it('deleting a finished playlist clears the end block', () => {
    const id = make(1);
    playOwn(id);
    next();
    expect(O().finished).not.toBeNull();
    L().deleteList(id);
    expect(O().finished).toBeNull();
  });
});

describe('learning', () => {
  it('fills the names of a playlist video from the report of any single video in the frame', () => {
    const id = make(1);
    L().addVideo(id, { id: vid(9) });
    W().addRef({ kind: 'video', id: vid(9) }, false);
    W().play({ kind: 'video', id: vid(9) });
    W().setReport({ title: 'Reported name', channel: 'Reported channel', duration: 200 });
    expect(L().lists[id].items[1]).toEqual({ id: vid(9), title: 'Reported name', channel: 'Reported channel', seconds: 200 });
    expect(JSON.parse(localStorage.getItem(OWN_KEY)!).lists[id].items[1].seconds).toBe(200);
    expect(localStorage.getItem(SAVED_KEY)).toContain(id);
  });
});

describe('a load waiting out the spacing', () => {
  it('goes on to the one that now follows when its video was removed while it waited', () => {
    const id = make(4);
    playOwn(id);
    started();
    vi.advanceTimersByTime(300);
    ended();
    expect(playingId()).toBe(vid(1));
    L().removeVideo(id, vid(2));
    tick(LOAD_GAP_MS);
    expect(playingId()).toBe(vid(3));
    expect(O().pos).toBe(1);
  });

  it('ends the playlist when every video after it was removed, never stalls', () => {
    const id = make(3);
    playOwn(id);
    started();
    vi.advanceTimersByTime(300);
    ended();
    L().removeVideo(id, vid(2));
    L().removeVideo(id, vid(3));
    tick(LOAD_GAP_MS);
    expect(playingId()).toBeNull();
    expect(O().finished).toMatchObject({ listId: id, total: 1 });
  });

  it('still plays its own video when an earlier one was removed (the target is found by id)', () => {
    const id = make(4);
    playOwn(id, vid(2));
    started();
    vi.advanceTimersByTime(300);
    ended();
    L().removeVideo(id, vid(1));
    tick(LOAD_GAP_MS);
    expect(playingId()).toBe(vid(3));
  });
});

describe('starting a playlist none of whose videos can play', () => {
  it('shows the none end state and leaves an unrelated playing video alone', () => {
    const id = make(2);
    W().addRef({ kind: 'video', id: vid(7) }, false);
    W().play({ kind: 'video', id: vid(7) });
    useYtQueue.setState({ failed: new Map([[vid(1), 'embed' as const], [vid(2), 'removed' as const]]) });
    expect(playOwn(id)).toBe(false);
    expect(playingId()).toBe(vid(7));
    expect(W().source).toBe('watch');
    expect(O().finished).toEqual({ listId: id, played: 0, total: 2, none: true });
  });
});

describe('repeat and shuffle at the seam of two rounds', () => {
  it('chooses the next round when the last video starts, names its first, and the round that starts uses it', () => {
    const id = make(5, { shuffle: true, repeat: true });
    for (let trial = 0; trial < 12; trial++) {
      resetOwnPlay();
      resetWatch();
      playOwn(id);
      for (let i = 0; i < 4; i++) {
        started();
        tick(1500);
        ended();
        // Only the last video of the round plans the next round.
        if (i < 3) expect(O().nextOrder).toBeNull();
      }
      const last = playingId()!;
      const plan = O().nextOrder!;
      expect(plan).toHaveLength(5);
      expect(plan[0]).not.toBe(last);
      const view = ownView(W(), O(), L().lists)!;
      expect(view.last).toBe(true);
      expect(view.next?.id).toBe(plan[0]);
      started();
      tick(1500);
      ended();
      expect(O().order).toEqual(plan);
      expect(playingId()).toBe(plan[0]);
      expect(O().nextOrder).toBeNull();
    }
  });

  it('plans nothing without shuffle or without repeat', () => {
    const id = make(2, { shuffle: true });
    playOwn(id, O().order[1] ?? vid(2));
    expect(O().nextOrder).toBeNull();
  });
});

describe('the skip note and the end of the play-through', () => {
  it('goes, with its timer, when the play-through stops', () => {
    const id = make(3);
    playOwn(id);
    tick(1500);
    error(150);
    expect(O().note).not.toBeNull();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    W().stop('hidden');
    expect(O().note).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
