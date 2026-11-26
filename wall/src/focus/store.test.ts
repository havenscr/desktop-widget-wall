import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DND_KEY } from './dnd';
import { FOCUS_DAY_KEY } from './day';
import { FOCUS_KEY } from './model';
import { createFocusStore, UNDO_MS } from './store';

const MIN = 60_000;

function setup(opts: { dnd?: boolean; slowDisable?: boolean } = {}) {
  const calls: string[] = [];
  const mem = new Map<string, string>();
  let releaseDisable: (() => void) | null = null;
  const invoke = vi.fn(async (command: string) => {
    calls.push(command);
    if (command === 'get_do_not_disturb') return opts.dnd ?? false;
    if (command === 'disable_do_not_disturb' && opts.slowDisable) {
      await new Promise<void>((r) => (releaseDisable = r));
    }
    return undefined;
  });
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  const useStore = createFocusStore({ now: () => Date.now(), invoke, storage: () => storage });
  return { useStore, calls, mem, finishDisable: () => releaseDisable?.() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0, 0));
});
afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useRealTimers();
});

it('finishes and releases Do Not Disturb with no screen mounted and the window hidden', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  await vi.advanceTimersByTimeAsync(10);
  expect(t.mem.get(DND_KEY)).toBe('1');
  await vi.advanceTimersByTimeAsync(25 * MIN + 100);
  expect(t.useStore.getState().state.status).toBe('finished');
  expect(t.calls.at(-1)).toBe('disable_do_not_disturb');
  expect(t.mem.has(DND_KEY)).toBe(false);
  t.useStore.getState().dispose();
});

it('pause and reset cancel the end timer, and each gives Do Not Disturb back and clears its marker', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  await vi.advanceTimersByTimeAsync(10);
  // Started: focus turned Do Not Disturb on and marked it.
  expect(t.calls).toContain('enable_do_not_disturb');
  expect(t.mem.get(DND_KEY)).toBe('1');
  const disables = () => t.calls.filter((c) => c === 'disable_do_not_disturb').length;
  expect(disables()).toBe(0);
  s.pause();
  await vi.advanceTimersByTimeAsync(10);
  // Pause: given back at once, marker gone, and the end timer never fires.
  expect(disables()).toBe(1);
  expect(t.mem.has(DND_KEY)).toBe(false);
  await vi.advanceTimersByTimeAsync(60 * MIN);
  expect(t.useStore.getState().state.status).toBe('paused');
  expect(disables()).toBe(1);
  s.resume();
  await vi.advanceTimersByTimeAsync(10);
  expect(t.mem.get(DND_KEY)).toBe('1');
  s.reset();
  await vi.advanceTimersByTimeAsync(10);
  // Reset: given back again, marker gone, and the end timer never fires.
  expect(disables()).toBe(2);
  expect(t.mem.has(DND_KEY)).toBe(false);
  await vi.advanceTimersByTimeAsync(60 * MIN);
  expect(t.useStore.getState().state.status).toBe('idle');
  expect(disables()).toBe(2);
  s.dispose();
});

it('reconciles an overdue timer at once when the page becomes visible', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  await vi.advanceTimersByTimeAsync(10);
  // The clock jumps (sleep, throttled timers) without the end timer firing.
  vi.setSystemTime(Date.now() + 40 * MIN);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(10);
  expect(t.useStore.getState().state.status).toBe('finished');
  expect(t.calls.at(-1)).toBe('disable_do_not_disturb');
  s.dispose();
});

it('re-arms a restored running timer', async () => {
  const t = setup();
  t.mem.set(FOCUS_KEY, JSON.stringify({ status: 'running', minutes: 25, endAt: Date.now() + 10 * MIN }));
  t.useStore.getState().init();
  await vi.advanceTimersByTimeAsync(10 * MIN + 100);
  expect(t.useStore.getState().state.status).toBe('finished');
  t.useStore.getState().dispose();
});

it('does not re-enable Do Not Disturb when paused while the startup disable is pending', async () => {
  const t = setup({ slowDisable: true });
  t.mem.set(DND_KEY, '1'); // a previous run left it on
  t.mem.set(FOCUS_KEY, JSON.stringify({ status: 'running', minutes: 25, endAt: Date.now() + 10 * MIN }));
  const s = t.useStore.getState();
  s.init();
  await vi.advanceTimersByTimeAsync(10);
  expect(t.calls).toEqual(['disable_do_not_disturb']);
  s.pause();
  t.finishDisable();
  await vi.advanceTimersByTimeAsync(50);
  expect(t.calls).toEqual(['disable_do_not_disturb']);
  expect(t.useStore.getState().state.status).toBe('paused');
  s.dispose();
});

it('takes Do Not Disturb again after the startup release when still running', async () => {
  const t = setup();
  t.mem.set(DND_KEY, '1');
  t.mem.set(FOCUS_KEY, JSON.stringify({ status: 'running', minutes: 25, endAt: Date.now() + 10 * MIN }));
  t.useStore.getState().init();
  await vi.advanceTimersByTimeAsync(50);
  expect(t.calls).toEqual(['disable_do_not_disturb', 'get_do_not_disturb', 'enable_do_not_disturb']);
  t.useStore.getState().dispose();
});

it('keeps today\'s sessions: a pause closes one early, a finish closes at its planned end, both saved', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start(); // 10:00, planned 10:25
  await vi.advanceTimersByTimeAsync(10 * MIN);
  t.useStore.getState().pause(); // 10:10
  await vi.advanceTimersByTimeAsync(5 * MIN);
  t.useStore.getState().resume(); // 10:15, 15 min left
  await vi.advanceTimersByTimeAsync(20 * MIN); // finishes at 10:30
  const at = (h: number, m: number) => new Date(2026, 10, 11, h, m).getTime();
  const want = [
    { start: at(10, 0), end: at(10, 10), id: at(10, 0) },
    { start: at(10, 15), end: at(10, 30), id: at(10, 0), done: true },
  ];
  expect(t.useStore.getState().state.status).toBe('finished');
  expect(t.useStore.getState().sessions).toEqual(want);
  expect(JSON.parse(t.mem.get(FOCUS_DAY_KEY)!)).toEqual({ sessions: want });
  t.useStore.getState().dispose();
});

it('restores saved sessions at start and drops earlier days on the next write', () => {
  const t = setup();
  const yesterday = new Date(2026, 10, 10, 15, 0).getTime();
  t.mem.set(FOCUS_DAY_KEY, JSON.stringify({ sessions: [{ start: yesterday, end: yesterday + 25 * MIN }] }));
  const s = t.useStore.getState();
  s.init();
  expect(t.useStore.getState().sessions).toHaveLength(1);
  s.start();
  expect(t.useStore.getState().sessions).toEqual([{ start: Date.now(), end: Date.now() + 25 * MIN, id: Date.now() }]);
  t.useStore.getState().dispose();
});

it('adjustLeft changes the time left of the running session and not its length', () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  s.adjustLeft(-1);
  const st = t.useStore.getState().state;
  expect(st).toMatchObject({ status: 'running', minutes: 25, endAt: Date.now() + 20 * MIN });
  expect(JSON.parse(t.mem.get(FOCUS_KEY)!).endAt).toBe(Date.now() + 20 * MIN);
  s.dispose();
});

it('stop ends the session at once and Undo inside the window restores it, time kept counting', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.startLabeled('Draft');
  const before = t.useStore.getState().state;
  await vi.advanceTimersByTimeAsync(2 * MIN);
  s.stop();
  expect(t.useStore.getState().state).toEqual({ status: 'idle', minutes: 25 });
  expect(t.useStore.getState().undo?.kind).toBe('stop');
  await vi.advanceTimersByTimeAsync(UNDO_MS - 1000);
  s.undoLast();
  expect(t.useStore.getState().state).toEqual(before);
  expect(t.useStore.getState().undo).toBeNull();
  s.dispose();
});

it('the undo offer lapses after the window and Undo then does nothing', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  s.stop();
  await vi.advanceTimersByTimeAsync(UNDO_MS + 1);
  expect(t.useStore.getState().undo).toBeNull();
  s.undoLast();
  expect(t.useStore.getState().state.status).toBe('idle');
  s.dispose();
});

it('Undo of a stopped paused session restores the paused time; starting anew clears the offer', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.startLabeled('Draft');
  await vi.advanceTimersByTimeAsync(5 * MIN);
  s.pause();
  const paused = t.useStore.getState().state;
  s.stop();
  await vi.advanceTimersByTimeAsync(2000);
  s.undoLast();
  expect(t.useStore.getState().state).toEqual(paused);
  s.stop();
  s.startLabeled('Other');
  expect(t.useStore.getState().undo).toBeNull();
  s.dispose();
});

it('restart starts the same length from full keeping the label, and Undo after it brings back the old session', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.startLabeled('Draft');
  await vi.advanceTimersByTimeAsync(10 * MIN);
  const before = t.useStore.getState().state;
  s.restart();
  expect(t.useStore.getState().state).toMatchObject({ status: 'running', minutes: 25, endAt: Date.now() + 25 * MIN, label: 'Draft' });
  expect(t.useStore.getState().undo?.kind).toBe('restart');
  await vi.advanceTimersByTimeAsync(1000);
  s.undoLast();
  expect(t.useStore.getState().state).toEqual(before);
  expect(t.useStore.getState().sessions.at(-1)?.end).toBe((before as { endAt: number }).endAt);
  s.dispose();
});

it('Undo of a stop on a session that ran out meanwhile restores it finished, as if it ended on its own', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  await vi.advanceTimersByTimeAsync(25 * MIN - 2000);
  const sessions = t.useStore.getState().sessions;
  s.stop();
  await vi.advanceTimersByTimeAsync(3000);
  s.undoLast();
  expect(t.useStore.getState().state).toEqual({ status: 'finished', minutes: 25 });
  expect(t.useStore.getState().sessions).toEqual(sessions.map((x) => ({ ...x, done: true })));
  expect(JSON.parse(t.mem.get(FOCUS_DAY_KEY)!).sessions).toEqual(t.useStore.getState().sessions);
  s.dispose();
});

it('Undo of a restart on a session that ran out meanwhile restores finished and releases Do Not Disturb', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  await vi.advanceTimersByTimeAsync(25 * MIN - 2000);
  const sessions = t.useStore.getState().sessions;
  s.restart();
  await vi.advanceTimersByTimeAsync(3000);
  s.undoLast();
  expect(t.useStore.getState().state).toEqual({ status: 'finished', minutes: 25 });
  expect(t.useStore.getState().sessions).toEqual(sessions.map((x) => ({ ...x, done: true })));
  await vi.advanceTimersByTimeAsync(10);
  expect(t.calls.at(-1)).toBe('disable_do_not_disturb');
  expect(t.mem.has(DND_KEY)).toBe(false);
  s.dispose();
});

it('Undo returns the day ribbon to its exact earlier records (no gap, no new climb, no restart fragment)', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.startLabeled('Draft');
  await vi.advanceTimersByTimeAsync(5 * MIN);
  s.adjustLeft(-1);
  await vi.advanceTimersByTimeAsync(MIN);
  const before = structuredClone(t.useStore.getState().sessions);
  s.stop();
  await vi.advanceTimersByTimeAsync(2000);
  s.undoLast();
  expect(t.useStore.getState().sessions).toEqual(before);
  expect(JSON.parse(t.mem.get(FOCUS_DAY_KEY)!).sessions).toEqual(before);
  s.restart();
  await vi.advanceTimersByTimeAsync(2000);
  s.undoLast();
  expect(t.useStore.getState().sessions).toEqual(before);
  s.pause();
  const paused = structuredClone(t.useStore.getState().sessions);
  s.restart();
  s.undoLast();
  expect(t.useStore.getState().sessions).toEqual(paused);
  s.dispose();
});

it('adjustLeft cannot revive a session already past its end', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  vi.setSystemTime(Date.now() + 26 * MIN);
  s.adjustLeft(1);
  expect(t.useStore.getState().state.status).toBe('finished');
  s.dispose();
});

it('a task hold still starts from idle after a Stop, and the stop releases Do Not Disturb', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  await vi.advanceTimersByTimeAsync(10);
  s.stop();
  await vi.advanceTimersByTimeAsync(10);
  expect(t.calls.at(-1)).toBe('disable_do_not_disturb');
  s.startLabeled('Task');
  expect(t.useStore.getState().state).toMatchObject({ status: 'running', label: 'Task' });
  s.dispose();
});
