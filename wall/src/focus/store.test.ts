import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DND_KEY } from './dnd';
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

it('pause and reset cancel the end timer', async () => {
  const t = setup();
  const s = t.useStore.getState();
  s.init();
  s.start();
  s.pause();
  await vi.advanceTimersByTimeAsync(60 * MIN);
  expect(t.useStore.getState().state.status).toBe('paused');
  s.resume();
  s.reset();
  await vi.advanceTimersByTimeAsync(60 * MIN);
  expect(t.useStore.getState().state.status).toBe('idle');
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
