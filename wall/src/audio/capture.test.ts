import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const calls: Array<[string, unknown]> = [];
let handler: ((e: { payload: unknown }) => void) | null = null;
let failStart = 0;
let device: string | null = 'dev-1';
let holdStart: Promise<void> | null = null;

vi.mock('../bridge/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    if (cmd === 'get_default_loopback_device') return device;
    if (cmd === 'start_audio_capture' && holdStart) await holdStart;
    if (cmd === 'start_audio_capture' && failStart > 0) {
      failStart--;
      throw new Error('no device');
    }
    return undefined;
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: unknown }) => void) => {
    handler = cb;
    return () => {
      handler = null;
    };
  }),
}));

import { DEVICE_CHECK_MS, RETRY_WAIT, startAudio, WATCHDOG_MS } from './capture';
import { resetAudio, useAudioStore } from './store';

const names = () => calls.map((c) => c[0]);
const pushes = () => calls.filter((c) => c[0] === 'set_audio_push').map((c) => (c[1] as { enabled: boolean }).enabled);
const setHidden = (v: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  handler = null;
  failStart = 0;
  device = 'dev-1';
  holdStart = null;
  resetAudio();
});
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

it('starts capture once on the default device and turns the push on', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(1);
  expect(calls.find((c) => c[0] === 'start_audio_capture')![1]).toEqual({ deviceId: 'dev-1' });
  expect(pushes()).toEqual([true]);
  stop();
});

it('turns the push off while hidden and on again when visible', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  setHidden(true);
  await vi.advanceTimersByTimeAsync(10);
  setHidden(false);
  await vi.advanceTimersByTimeAsync(10);
  expect(pushes()).toEqual([true, false, true]);
  stop();
});

it('shows playing from events and drops to silent by the clock', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  handler?.({ payload: { bass: 0.7, mid: 0.3, high: 0.1, bands: [1], waveform: [0.2] } });
  await vi.advanceTimersByTimeAsync(100);
  expect(useAudioStore.getState().playing).toBe(true);
  await vi.advanceTimersByTimeAsync(600);
  expect(useAudioStore.getState().playing).toBe(false);
  stop();
});

it('retries once after 30 seconds when the first start fails', async () => {
  failStart = 1;
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(RETRY_WAIT - 100);
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(200);
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(2);
  stop();
});

it('does not retry a second time', async () => {
  failStart = 5;
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(RETRY_WAIT * 4);
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(2);
  stop();
});

it('restarts capture once if no event arrives for 5 seconds while visible', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2 + 100);
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 6);
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(2);
  stop();
});

it('stop clears every timer and the listener', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  expect(handler).toBeNull();
});

it('gives the watchdog a fresh 5 seconds when the page becomes visible again', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  setHidden(true);
  await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3 + 100); // hidden: no events, no restart
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(1);
  setHidden(false);
  // The next watchdog check lands before the first event could: it must not restart yet.
  await vi.advanceTimersByTimeAsync(4900); // crosses the tick at 20 s, 4.9 s after becoming visible
  expect(names().filter((n) => n === 'start_audio_capture')).toHaveLength(1);
  stop();
});

it('?audio=demo is honoured in a development build and ignored in a production build', async () => {
  const { wantsDemo } = await import('./capture');
  vi.stubEnv('DEV', true);
  expect(wantsDemo('?audio=demo')).toBe(true);
  vi.stubEnv('DEV', false);
  expect(wantsDemo('?audio=demo')).toBe(false);
  vi.unstubAllEnvs();
});

const starts = () => calls.filter((c) => c[0] === 'start_audio_capture').map((c) => (c[1] as { deviceId: string }).deviceId);
const touch = () => handler?.({ payload: { bass: 0.5, mid: 0.2, high: 0.1, bands: [1], waveform: [0.1] } });

it('follows the Windows default output: the same device never restarts capture', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  for (let i = 0; i < 4; i++) {
    touch();
    await vi.advanceTimersByTimeAsync(DEVICE_CHECK_MS);
  }
  expect(starts()).toEqual(['dev-1']);
  stop();
});

it('a changed default output restarts capture once on the new device and listens again', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  device = 'headphones';
  touch();
  await vi.advanceTimersByTimeAsync(DEVICE_CHECK_MS + 10);
  expect(starts()).toEqual(['dev-1', 'headphones']);
  expect(handler).not.toBeNull();
  touch();
  await vi.advanceTimersByTimeAsync(100);
  expect(useAudioStore.getState().playing).toBe(true);
  // The new device is the running one now: no further restarts.
  for (let i = 0; i < 9; i++) {
    await vi.advanceTimersByTimeAsync(1000);
    touch();
  }
  expect(starts()).toEqual(['dev-1', 'headphones']);
  stop();
});

it('does not ask while the page is hidden, and asks at once when it is visible again', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  setHidden(true);
  const asked = () => names().filter((n) => n === 'get_default_loopback_device').length;
  const before = asked();
  device = 'headphones';
  await vi.advanceTimersByTimeAsync(DEVICE_CHECK_MS * 3);
  expect(asked()).toBe(before);
  expect(starts()).toEqual(['dev-1']);
  setHidden(false);
  await vi.advanceTimersByTimeAsync(10);
  expect(starts()).toEqual(['dev-1', 'headphones']);
  stop();
});

it('a null answer restarts nothing', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  device = null;
  await vi.advanceTimersByTimeAsync(DEVICE_CHECK_MS * 3);
  expect(starts()).toEqual(['dev-1']);
  stop();
});

it('a restart in flight is not doubled, and a failed restart is tried again on the next tick', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  device = 'headphones';
  let release: () => void = () => undefined;
  holdStart = new Promise<void>((r) => (release = r));
  touch();
  await vi.advanceTimersByTimeAsync(DEVICE_CHECK_MS * 3 + 10);
  expect(starts()).toEqual(['dev-1', 'headphones']);
  failStart = 1;
  release();
  holdStart = null;
  await vi.advanceTimersByTimeAsync(10);
  // The held start failed: the next tick tries again, and that one works.
  touch();
  await vi.advanceTimersByTimeAsync(DEVICE_CHECK_MS + 10);
  expect(starts()).toEqual(['dev-1', 'headphones', 'headphones']);
  stop();
});

it('stop cancels the device timer', async () => {
  const stop = startAudio();
  await vi.advanceTimersByTimeAsync(10);
  stop();
  device = 'headphones';
  await vi.advanceTimersByTimeAsync(DEVICE_CHECK_MS * 3);
  expect(starts()).toEqual(['dev-1']);
  expect(vi.getTimerCount()).toBe(0);
});
