import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useSignalStore } from '../signals/store';
import { usePlaceStore } from '../state/places';
import { isOnAirLive, useOnAirLiveStore } from './liveState';
import { useOnAirLive, useOnAirLiveReport } from './useOnAirLiveReport';

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
    useOnAirLiveStore.setState({ live: false });
  });
  afterEach(() => mocks.clear());

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

  it('ignores a missing command', async () => {
    mocks.clear();
    renderHook(() => useOnAirLiveReport());
    await act(async () => {});
    expect(useOnAirLiveStore.getState().live).toBe(false);
  });
});
