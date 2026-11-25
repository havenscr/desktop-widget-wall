import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DND_KEY } from './dnd';
import { FOCUS_DAY_KEY } from './day';
import { FOCUS_KEY } from './model';
import { createFocusStore } from './store';

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
