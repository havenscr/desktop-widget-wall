import { afterEach, describe, expect, it, vi } from 'vitest';
import { atLimit, MAX_SHOW_MS, STORAGE_KEY, type Show } from './model';
import { createOnAirStore } from './store';

const SHOW: Show = {
  state: 'ok',
  title: 'Friday stream',
  parts: [
    { name: 'Welcome', minutes: 5, notes: ['Hello'] },
    { name: 'Demo', minutes: 20, notes: [] },
    { name: 'Questions', minutes: 10, notes: [] },
  ],
  skipped: 0,
  reason: null,
  readAt: 1,
};

function setup(answers: Record<string, (args?: Record<string, unknown>) => unknown> = {}) {
  let now = Date.parse('2026-11-13T10:00:00-08:00');
  const data = new Map<string, string>();
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const store = createOnAirStore({
    now: () => now,
    storage: () => storage,
    invoke: async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      const a = answers[command];
      if (!a) throw new Error(`no answer for ${command}`);
      return a(args) as T;
    },
  });
  return { store, data, calls, step: (ms: number) => (now += ms), now: () => now };
}

describe('the On Air store', () => {
  it('starts, stops (keeping the time), carries on, and resets only while stopped', () => {
    const { store, step } = setup();
    const s = () => store.getState();
    s().start();
    step(60_000);
    s().reset();
    expect(s().saved.running).toBe(true);
    s().stop();
    expect(s().saved.accumulatedMs).toBe(60_000);
    step(30_000);
    s().start();
    step(10_000);
    s().stop();
    expect(s().saved.accumulatedMs).toBe(70_000);
    s().reset();
    expect(s().saved).toMatchObject({ running: false, accumulatedMs: 0, firstStartAt: null, partIndex: 0 });
  });

  it('keeps the timer in local storage and a fresh store goes on from the stored start', () => {
    const { store, data, step, now } = setup();
    store.getState().start();
    step(5000);
    const again = createOnAirStore({ now, invoke: async () => undefined as never, storage: () => ({ getItem: (k) => data.get(k) ?? null, setItem: () => {} }) });
    again.getState().hydrate();
    expect(again.getState().saved.running).toBe(true);
    expect(again.getState().saved.startedAt).toBe(now() - 5000);
    expect(JSON.parse(data.get(STORAGE_KEY) ?? '{}').running).toBe(true);
  });

  it('restores a stored running timer from more than 24 hours ago as stopped at 24 hours', () => {
    const { data, now } = setup();
    const old = now() - 25 * 3_600_000;
    data.set(STORAGE_KEY, JSON.stringify({ running: true, startedAt: old, accumulatedMs: 0, firstStartAt: old, stoppedAt: null, partIndex: 0, partSinceMs: 0 }));
    const again = createOnAirStore({ now, invoke: async () => undefined as never, storage: () => ({ getItem: (k) => data.get(k) ?? null, setItem: () => {} }) });
    again.getState().hydrate();
    expect(again.getState().saved).toMatchObject({ running: false, accumulatedMs: MAX_SHOW_MS });
    expect(atLimit(again.getState().saved)).toBe(true);
  });

  it('works with storage that throws', () => {
    const store = createOnAirStore({
      now: () => 1000,
      invoke: async () => undefined as never,
      storage: () => ({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    });
    store.getState().hydrate();
    store.getState().start();
    expect(store.getState().saved.running).toBe(true);
  });

  it('reads the run of show at most every five seconds', async () => {
    const { store, calls, step } = setup({ wall2_onair_show: () => SHOW });
    expect(await store.getState().loadShow()).toBe(true);
    expect(store.getState().show?.parts).toHaveLength(3);
    step(4000);
    expect(await store.getState().loadShow()).toBe(false);
    step(1000);
    expect(await store.getState().loadShow()).toBe(true);
    expect(calls.filter((c) => c.command === 'wall2_onair_show')).toHaveLength(2);
  });

  it('keeps the last good read and says why a later one failed', async () => {
    let fail = false;
    const { store, step } = setup({
      wall2_onair_show: () => {
        if (fail) throw 'not-configured';
        return SHOW;
      },
    });
    await store.getState().loadShow();
    fail = true;
    step(6000);
    await store.getState().loadShow();
    expect(store.getState().show?.title).toBe('Friday stream');
    expect(store.getState().showError).toBe('No config folder on this PC');
  });

  it('moves between parts and marks when each part began', async () => {
    const { store, step } = setup({ wall2_onair_show: () => SHOW });
    await store.getState().loadShow();
    store.getState().start();
    step(90_000);
    store.getState().goPart(1);
    expect(store.getState().saved).toMatchObject({ partIndex: 1, partSinceMs: 90_000 });
    store.getState().goPart(9);
    expect(store.getState().saved.partIndex).toBe(2);
    store.getState().goPart(-3);
    expect(store.getState().saved.partIndex).toBe(0);
  });

  it('sends a mark with the show time and the current part, and counts two clicks within a second once', async () => {
    const { store, calls, step } = setup({ wall2_onair_show: () => SHOW, wall2_onair_mark: () => ({ today: 1, last: ['00:42'] }) });
    await store.getState().loadShow();
    store.getState().start();
    step(42_000);
    store.getState().goPart(1);
    await store.getState().mark();
    step(500);
    await store.getState().mark();
    const marks = calls.filter((c) => c.command === 'wall2_onair_mark');
    expect(marks).toEqual([{ command: 'wall2_onair_mark', args: { showMs: 42_000, part: 'Demo' } }]);
    expect(store.getState().marks).toEqual({ today: 1, last: ['00:42'] });
    step(600);
    await store.getState().mark();
    expect(calls.filter((c) => c.command === 'wall2_onair_mark')).toHaveLength(2);
  });

  it('says in one line why a mark was refused', async () => {
    const { store } = setup({
      wall2_onair_mark: () => {
        throw 'refused';
      },
    });
    await store.getState().mark();
    expect(store.getState().marksNote).toBe('marks.txt is full; move it aside');
    expect(store.getState().showNote).toBeNull();
  });

  it('opens only the two fixed files by name', async () => {
    const { store, calls } = setup({ wall2_onair_open: () => undefined, wall2_onair_show: () => SHOW });
    await store.getState().open('show');
    await store.getState().open('marks');
    expect(calls).toEqual([
      { command: 'wall2_onair_open', args: { which: 'show' } },
      { command: 'wall2_onair_open', args: { which: 'marks' } },
    ]);
  });

  describe('the current part follows the file', () => {
    const parts = (n: number) => ({ ...SHOW, parts: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, minutes: 5, notes: [] })) });

    it('holds and keeps the part when the file shrinks, restarts its time, and does not jump back when it grows', async () => {
      let n = 40;
      const { store, step } = setup({ wall2_onair_show: () => parts(n) });
      const s = () => store.getState();
      await s().loadShow();
      s().start();
      step(60_000);
      s().goPart(29);
      step(120_000);
      expect(s().saved).toMatchObject({ partIndex: 29, partSinceMs: 60_000 });
      n = 3;
      step(6000);
      await s().loadShow();
      expect(s().saved).toMatchObject({ partIndex: 2, partSinceMs: 186_000 });
      step(30_000);
      // The page shows the last part; a click on that row changes nothing and keeps its time.
      const before = s().saved;
      s().goPart(2);
      expect(s().saved).toEqual(before);
      n = 40;
      step(6000);
      await s().loadShow();
      expect(s().saved.partIndex).toBe(2);
      expect(s().saved.partSinceMs).toBe(186_000);
    });

    it('does not move the part for a read that holds no parts (a missing or refused file)', async () => {
      let answer: Show = parts(30);
      const { store, step } = setup({ wall2_onair_show: () => answer });
      await store.getState().loadShow();
      store.getState().goPart(20);
      answer = { ...SHOW, state: 'missing', parts: [] };
      step(6000);
      await store.getState().loadShow();
      expect(store.getState().saved.partIndex).toBe(20);
      store.getState().goPart(0);
      expect(store.getState().saved.partIndex).toBe(20);
    });
  });

  it('stops itself at 24 hours, stays stopped until Reset, and does not start again before that', () => {
    const { store, step } = setup();
    const s = () => store.getState();
    s().start();
    step(MAX_SHOW_MS - 1000);
    s().settle();
    expect(s().saved.running).toBe(true);
    step(2000);
    s().settle();
    expect(s().saved).toMatchObject({ running: false, accumulatedMs: MAX_SHOW_MS });
    expect(atLimit(s().saved)).toBe(true);
    s().start();
    expect(s().saved.running).toBe(false);
    s().reset();
    s().start();
    expect(s().saved.running).toBe(true);
  });

  it('keeps one note for each file: a failed open of the run of show never replaces the marks line, and a marks refusal clears when marks are read', async () => {
    let refuse = true;
    const { store } = setup({
      wall2_onair_open: (a) => {
        if (a?.which === 'show') throw 'failed';
      },
      wall2_onair_mark: () => {
        throw 'refused';
      },
      wall2_onair_marks_today: () => {
        if (refuse) throw 'failed';
        return { today: 2, last: ['01:00', '02:00'] };
      },
    });
    const s = () => store.getState();
    await s().open('show');
    expect(s().showNote).toBe('Could not open run-of-show.txt');
    expect(s().marksNote).toBeNull();
    await s().mark();
    expect(s().marksNote).toBe('marks.txt is full; move it aside');
    expect(s().showNote).toBe('Could not open run-of-show.txt');
    await s().loadMarks();
    expect(s().marksNote).toBe('Could not write marks.txt');
    refuse = false;
    await s().loadMarks();
    expect(s().marksNote).toBeNull();
    expect(s().marks).toEqual({ today: 2, last: ['01:00', '02:00'] });
    expect(s().showNote).toBe('Could not open run-of-show.txt');
  });

  describe('the delayed read after Open file', () => {
    afterEach(() => vi.useRealTimers());

    it('reads the starter once the floor allows, and not at all when the place was closed first', async () => {
      vi.useFakeTimers();
      let reads = 0;
      const { store, step } = setup({
        wall2_onair_open: () => undefined,
        wall2_onair_show: () => (reads++, { ...SHOW, state: 'missing', parts: [] }),
      });
      await store.getState().loadShow();
      await store.getState().open('show');
      store.getState().cancelPending();
      step(6000);
      await vi.advanceTimersByTimeAsync(6000);
      expect(reads).toBe(1);
      await store.getState().open('show');
      step(6000);
      await vi.advanceTimersByTimeAsync(6000);
      expect(reads).toBe(2);
    });
  });

  it('remembers the local date of the marks it counted', async () => {
    const { store, step } = setup({ wall2_onair_marks_today: () => ({ today: 1, last: ['00:05'] }) });
    await store.getState().loadMarks();
    const first = store.getState().marksDate;
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    step(24 * 3_600_000);
    await store.getState().loadMarks();
    expect(store.getState().marksDate).not.toBe(first);
  });
});
