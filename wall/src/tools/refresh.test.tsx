import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useSonos } from '../home/useSonos';
import { refreshSecurity, useSecurityFeed } from '../home/useSecurity';
import { useMachines } from '../machines/useMachines';
import { acquireNowPlaying, refreshNowPlaying, resetNowPlaying } from '../music/store';
import { useTasks } from '../tasks/useTasks';
import { refreshWeather, resetWeatherStore } from '../weather/useWeather';
import { loadKeys, reloadKeys, resetKeysFeed, useKeysFeedStore } from '../work/keysFeed';
import { SETTLE_CEILING_MS, refreshMeetingFeed, resetMeetingFeed } from '../work/useNextMeeting';
import { resetReports, retryFor, useReportStore } from './reports';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  resetReports();
  resetMeetingFeed();
  resetKeysFeed();
  resetWeatherStore();
  resetNowPlaying();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.clear();
});

it('refreshMeetingFeed makes one read now, and not a second while one is running', async () => {
  let release: (v: unknown) => void = () => undefined;
  const next = vi.fn(() => new Promise((r) => (release = r)));
  mocks.set('wall2_meet_next', next);
  refreshMeetingFeed();
  refreshMeetingFeed();
  expect(next).toHaveBeenCalledTimes(1);
  const settled = refreshMeetingFeed();
  release({ accounts: [], meetings: [] });
  await flush();
  await expect(settled).resolves.toBeUndefined();
  refreshMeetingFeed();
  expect(next).toHaveBeenCalledTimes(2);
});

it('refreshSecurity reads the home app once and lands in the shared feed', async () => {
  const read = vi.fn(() => ({ reachable: true, stale: false, alerts: 0, lastScan: null, firewalla: null, portalUrl: null, topAlerts: [] }));
  mocks.set('wall2_home_security', read);
  refreshSecurity();
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(useSecurityFeed.getState().status).toBe('ready');
  expect(useSecurityFeed.getState().readAt).not.toBeNull();
});

it('refreshWeather fetches once now', async () => {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
  vi.stubGlobal('fetch', fetchMock);
  refreshWeather();
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('refreshNowPlaying polls once more while the loop runs, and does nothing without a consumer', async () => {
  const poll = vi.fn(() => null);
  mocks.set('get_now_playing', poll);
  await expect(refreshNowPlaying()).resolves.toBe(false);
  expect(poll).not.toHaveBeenCalled();
  const release = acquireNowPlaying();
  await flush(100);
  const before = poll.mock.calls.length;
  const done = refreshNowPlaying();
  await flush(100);
  await expect(done).resolves.toBe(true);
  expect(poll.mock.calls.length).toBe(before + 1);
  release();
});

it('reloadKeys asks wall2_keys_summary again at once and keeps the last good read shown meanwhile', async () => {
  const read = vi.fn(() => ({ source: 'file', sets: [], filePins: [], defaultPins: [], front: 'idle', autoId: null, exe: null }));
  mocks.set('wall2_keys_summary', read);
  loadKeys();
  await flush();
  expect(useKeysFeedStore.getState().read.status).toBe('ready');
  reloadKeys();
  expect(useKeysFeedStore.getState().read.status).toBe('ready');
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(useKeysFeedStore.getState().read.status).toBe('ready');
});

it('the task list reports each read, and registers its own refresh while mounted', async () => {
  const answer: unknown[] = [];
  let fail = false;
  mocks.set('wall2_tasks_next', () => (fail ? Promise.reject(new Error('failed')) : answer));
  const { unmount } = renderHook(() => useTasks());
  await flush();
  expect(useReportStore.getState().tasks?.last).toBe('ok');
  const okAt = useReportStore.getState().tasks?.okAt;
  fail = true;
  retryFor('tasks')!();
  await flush();
  expect(useReportStore.getState().tasks).toMatchObject({ last: 'failed', okAt });
  unmount();
  expect(retryFor('tasks')).toBeUndefined();
});

it('Sound reports each read and a not set up answer', async () => {
  let answer: () => unknown = () => ({});
  mocks.set('wall2_sonos_summary', () => answer());
  const { unmount } = renderHook(() => useSonos());
  await flush();
  expect(useReportStore.getState().sound?.last).toBe('ok');
  answer = () => Promise.reject(new Error('not-configured'));
  retryFor('sound')!();
  await flush();
  expect(useReportStore.getState().sound?.last).toBe('unconfigured');
  unmount();
  expect(retryFor('sound')).toBeUndefined();
});

it('the machine numbers report ok, stale and failed, and register their read', async () => {
  let answer: () => unknown = () => ({ pc: { cpuPct: 1, gpuPct: 1, ramPct: 1 }, box: { cpuPct: 1, gpuPct: null, ramPct: 1, tempC: 1 }, boxStale: false });
  mocks.set('wall2_machines', () => answer());
  const { unmount } = renderHook(() => useMachines());
  await flush();
  expect(useReportStore.getState().box?.last).toBe('ok');
  answer = () => ({ pc: {}, box: null, boxStale: false });
  await flush(2_000);
  expect(useReportStore.getState().box).toMatchObject({ last: 'stale', reason: 'The box sent no numbers' });
  answer = () => Promise.reject(new Error('failed'));
  await flush(2_000);
  expect(useReportStore.getState().box?.last).toBe('failed');
  expect(retryFor('box')).toBeTypeOf('function');
  unmount();
  expect(retryFor('box')).toBeUndefined();
});

it('refreshMeetingFeed lets go at the ceiling when the read hangs', async () => {
  mocks.set('wall2_meet_next', () => new Promise(() => undefined));
  let settled = false;
  void refreshMeetingFeed().then(() => (settled = true));
  await flush(SETTLE_CEILING_MS - 100);
  expect(settled).toBe(false);
  await flush(200);
  expect(settled).toBe(true);
});
