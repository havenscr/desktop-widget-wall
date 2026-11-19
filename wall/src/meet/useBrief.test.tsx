import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIEF_BUILDING, BRIEF_CLIENT } from '../bridge/devMocks/meetBrief';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { BUILDING_GIVE_UP_MS, BUILDING_RETRY_MS, READY_REREAD_MS, useBrief } from './useBrief';

const flush = () => act(async () => {});
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

let calls: string[] = [];
let answer: () => unknown = () => BRIEF_CLIENT;

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  answer = () => BRIEF_CLIENT;
  usePlaceStore.setState({ active: 'meet' });
  mocks.set('wall2_meet_brief', (args) => {
    calls.push(String(args?.key));
    const a = answer();
    if (typeof a === 'string') throw a;
    return a;
  });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  usePlaceStore.setState({ active: 'work' });
});

describe('useBrief', () => {
  it('reads on a key change and keeps nothing from the old key', async () => {
    const { result, rerender } = renderHook(({ k }) => useBrief(k), { initialProps: { k: 'a' as string | null } });
    await flush();
    expect(calls).toEqual(['a']);
    expect(result.current.out).toBe(BRIEF_CLIENT);
    rerender({ k: 'b' });
    expect(result.current.out).toBeNull();
    await flush();
    expect(calls).toEqual(['a', 'b']);
    expect(result.current.out).toBe(BRIEF_CLIENT);
  });

  it('does not read without a key', async () => {
    renderHook(() => useBrief(null));
    await flush();
    expect(calls).toEqual([]);
  });

  it('while building, asks every 20 s and stops after 5 minutes', async () => {
    answer = () => BRIEF_BUILDING;
    const { result } = renderHook(() => useBrief('a'));
    await flush();
    expect(result.current.out?.state).toBe('building');
    await tick(BUILDING_RETRY_MS);
    expect(calls).toHaveLength(2);
    await tick(BUILDING_GIVE_UP_MS + 60_000);
    const n = calls.length;
    expect(n).toBeLessThanOrEqual(1 + BUILDING_GIVE_UP_MS / BUILDING_RETRY_MS);
    await tick(BUILDING_GIVE_UP_MS);
    expect(calls).toHaveLength(n);
  });

  it('a ready brief is read again every 10 minutes', async () => {
    renderHook(() => useBrief('a'));
    await flush();
    await tick(READY_REREAD_MS - 1000);
    expect(calls).toHaveLength(1);
    await tick(2000);
    expect(calls).toHaveLength(2);
  });

  it('reads nothing while Meet is not the place on screen', async () => {
    usePlaceStore.setState({ active: 'work' });
    renderHook(() => useBrief('a'));
    await flush();
    await tick(READY_REREAD_MS * 2);
    expect(calls).toEqual([]);
    act(() => usePlaceStore.setState({ active: 'meet' }));
    await flush();
    expect(calls).toEqual(['a']);
  });

  it('reads nothing while the page is hidden', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    renderHook(() => useBrief('a'));
    await flush();
    await tick(READY_REREAD_MS);
    expect(calls).toEqual([]);
    hidden.mockRestore();
  });

  it('an error word becomes err; failed waits for Retry; an unknown error is failed', async () => {
    answer = () => 'failed';
    const { result } = renderHook(() => useBrief('a'));
    await flush();
    expect(result.current.err).toBe('failed');
    await tick(READY_REREAD_MS * 2);
    expect(calls).toHaveLength(1);
    answer = () => BRIEF_CLIENT;
    act(() => result.current.retry());
    await flush();
    expect(calls).toHaveLength(2);
    expect(result.current.err).toBeNull();
    mocks.set('wall2_meet_brief', () => {
      throw new Error('boom');
    });
    act(() => result.current.retry());
    await flush();
    expect(result.current.err).toBe('failed');
  });

  it('a failed re-read keeps the last good brief of the same key and Retry brings it back', async () => {
    const { result } = renderHook(() => useBrief('a'));
    await flush();
    expect(result.current.out).toBe(BRIEF_CLIENT);
    answer = () => 'failed';
    await tick(READY_REREAD_MS + 1000);
    expect(result.current.err).toBe('failed');
    expect(result.current.out).toBe(BRIEF_CLIENT);
    answer = () => BRIEF_CLIENT;
    act(() => result.current.retry());
    await flush();
    expect(result.current.err).toBeNull();
    expect(result.current.out).toBe(BRIEF_CLIENT);
  });

  it('a refusal other than failed drops the old brief', async () => {
    const { result } = renderHook(() => useBrief('a'));
    await flush();
    answer = () => 'forbidden';
    await tick(READY_REREAD_MS + 1000);
    expect(result.current.out).toBeNull();
    expect(result.current.err).toBe('forbidden');
  });

  it('after the building give-up gaveUp is set, and Retry reads again', async () => {
    answer = () => BRIEF_BUILDING;
    const { result } = renderHook(() => useBrief('a'));
    await flush();
    expect(result.current.gaveUp).toBe(false);
    await tick(BUILDING_GIVE_UP_MS + BUILDING_RETRY_MS);
    expect(result.current.gaveUp).toBe(true);
    const n = calls.length;
    act(() => result.current.retry());
    await flush();
    expect(calls).toHaveLength(n + 1);
    expect(result.current.gaveUp).toBe(false);
  });

  it('writes nothing to storage', async () => {
    renderHook(() => useBrief('a'));
    await flush();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
