import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSignalStore } from '../signals/store';
import { STORAGE_KEY } from './takeModel';
import { notePaused, noteResumed, resetTakes, startTakes, TAKE_HEARTBEAT_MS, useTakes } from './takes';

const T = new Date(2026, 10, 11, 10, 20).getTime();
const rec = (recording: boolean) => useSignalStore.setState({ known: true, recording, call: null, browserAv: false });
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T);
  localStorage.clear();
  rec(false);
  resetTakes();
});
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  rec(false);
});

describe('the take store follows the recorder only while it is started', () => {
  it('does nothing with storage until it is started, and nothing after it is stopped', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    rec(true);
    rec(false);
    expect(useTakes.getState().takes.count).toBe(0);
    expect(set).not.toHaveBeenCalled();
    stop = startTakes();
    expect(get).toHaveBeenCalledWith(STORAGE_KEY);
    stop();
    stop = null;
    set.mockClear();
    rec(true);
    vi.advanceTimersByTime(60_000);
    expect(useTakes.getState().takes.count).toBe(0);
    expect(set).not.toHaveBeenCalled();
    get.mockRestore();
    set.mockRestore();
  });

  it('survives a strict mode double mount: one take, not two', () => {
    const a = startTakes();
    a();
    stop = startTakes();
    rec(true);
    expect(useTakes.getState().takes.count).toBe(1);
  });

  it('a steady heartbeat keeps the last-seen time, so a reload during a long take is the same take', () => {
    stop = startTakes();
    rec(true);
    vi.advanceTimersByTime(5 * 60_000);
    const cur = useTakes.getState().takes.current!;
    expect(cur.startedAt).toBe(T);
    expect(Date.now() - cur.seenAt).toBeLessThanOrEqual(TAKE_HEARTBEAT_MS);
    // The stored copy is at most 15 seconds old as well.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(Date.now() - stored.current.seenAt).toBeLessThanOrEqual(15_000 + TAKE_HEARTBEAT_MS);
    // Reload: the wall starts again with the recorder still on.
    stop();
    stop = startTakes();
    const back = useTakes.getState().takes;
    expect(back.count).toBe(1);
    expect(back.current?.startedAt).toBe(T);
  });

  it('a paused take survives a reload', () => {
    stop = startTakes();
    rec(true);
    vi.advanceTimersByTime(2 * 60_000);
    notePaused();
    const pausedAt = Date.now();
    vi.advanceTimersByTime(30_000);
    stop();
    stop = startTakes();
    const back = useTakes.getState().takes;
    expect(back.count).toBe(1);
    expect(back.current?.startedAt).toBe(T);
    expect(back.current?.pausedAt).toBe(pausedAt);
    noteResumed();
    expect(useTakes.getState().takes.current?.pausedAt).toBeNull();
  });
});
