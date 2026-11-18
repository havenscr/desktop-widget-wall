import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useSignalStore } from '../signals/store';
import { usePlaceStore } from '../state/places';
import { isOnAirLive } from './liveState';
import { RETRY_MS, useOnAirLive, useOnAirLiveReport } from './useOnAirLiveReport';

const base = { active: 'work' as const, known: true, recording: false, call: null, browserAv: false, now: 0 };

describe('isOnAirLive', () => {
  it('is live for the place, a recorder or a browser broadcast, not for none or a plain call', () => {
    expect(isOnAirLive(base)).toBe(false);
    expect(isOnAirLive({ ...base, active: 'onair' })).toBe(true);
    expect(isOnAirLive({ ...base, recording: true })).toBe(true);
    expect(isOnAirLive({ ...base, browserAv: true })).toBe(true);
    expect(isOnAirLive({ ...base, call: { kind: 'teams', camera: false } as never })).toBe(false);
  });
});

describe('useOnAirLiveReport', () => {
  const send = vi.fn();
  beforeEach(() => {
    send.mockReset();
    mocks.set('wall2_meet_set_on_air', send);
    usePlaceStore.setState({ active: 'work' });
    useSignalStore.setState({ known: true, recording: false, call: null, browserAv: false });
  });
  afterEach(() => {
    mocks.clear();
    vi.useRealTimers();
  });

  it('reports at start, then only on changes, with the right value', async () => {
    const { result } = renderHook(() => ({ report: useOnAirLiveReport(), live: useOnAirLive() }));
    await act(async () => {});
    expect(send.mock.calls).toEqual([[{ live: false }]]);
    await act(async () => usePlaceStore.setState({ active: 'onair' }));
    expect(send).toHaveBeenLastCalledWith({ live: true });
    expect(result.current.live).toBe(true);
    await act(async () => usePlaceStore.setState({ active: 'meet' }));
    expect(send).toHaveBeenLastCalledWith({ live: false });
    await act(async () => useSignalStore.setState({ recording: true }));
    expect(send).toHaveBeenLastCalledWith({ live: true });
    await act(async () => useSignalStore.setState({ browserAv: true }));
    expect(send).toHaveBeenCalledTimes(4);
    await act(async () => useSignalStore.setState({ recording: false, browserAv: false }));
    expect(send).toHaveBeenLastCalledWith({ live: false });
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('reads live at render, with no effect in between', () => {
    usePlaceStore.setState({ active: 'onair' });
    const { result } = renderHook(() => useOnAirLive());
    expect(result.current).toBe(true);
  });

  it('a failed report while live is sent again, with the value current then', async () => {
    vi.useFakeTimers();
    usePlaceStore.setState({ active: 'onair' });
    send.mockImplementationOnce(() => Promise.reject('failed'));
    renderHook(() => useOnAirLiveReport());
    await act(async () => {});
    expect(send.mock.calls).toEqual([[{ live: true }]]);
    await act(async () => vi.advanceTimersByTimeAsync(RETRY_MS));
    expect(send.mock.calls).toEqual([[{ live: true }], [{ live: true }]]);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying quietly when the command is missing, and stops on unmount', async () => {
    vi.useFakeTimers();
    mocks.clear();
    const { unmount } = renderHook(() => useOnAirLiveReport());
    await act(async () => vi.advanceTimersByTimeAsync(RETRY_MS * 4));
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
  });
});
