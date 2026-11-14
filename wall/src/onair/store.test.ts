import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, type Show } from './model';
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
    expect(store.getState().note).toBe('marks.txt is full; move it aside');
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
});
