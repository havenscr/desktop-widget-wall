import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useReportStore } from '../tools/reports';
import { SONOS_REFRESH_MS, SONOS_RETRY_MS } from './soundModel';
import { useSonos } from './useSonos';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let reads = 0;
/** The next reads answer in order; the last answer repeats. 'ok' is a summary, anything else is the error text Rust sends. */
function script(...answers: string[]) {
  reads = 0;
  mocks.set('wall2_sonos_summary', () => {
    const a = answers[Math.min(reads, answers.length - 1)];
    reads += 1;
    return a === 'ok' ? {} : Promise.reject(new Error(a));
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T18:30:00-08:00'));
  useReportStore.setState({ sound: undefined });
});
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
  mocks.clear();
});

it('one failed read after a good one changes nothing and reads once more after 5 seconds', async () => {
  script('ok', 'timed-out', 'ok');
  const { result } = renderHook(() => useSonos());
  await flush();
  expect(result.current.status).toBe('ready');
  await flush(SONOS_REFRESH_MS);
  expect(reads).toBe(2);
  expect(result.current.status).toBe('ready');
  expect(result.current.failure).toBeNull();
  expect(result.current.stale).toBe(false);
  expect(useReportStore.getState().sound?.last).toBe('ok');
  await flush(SONOS_RETRY_MS - 1);
  expect(reads).toBe(2);
  await flush(1);
  expect(reads).toBe(3);
  expect(result.current.status).toBe('ready');
  expect(result.current.stale).toBe(false);
});

it.each([
  ['timed-out', 'Sonos did not answer in time.'],
  ['no-answer', 'Sonos cannot be reached.'],
  ['bad-answer', 'Sonos sent an answer the wall could not read.'],
])('a second failure (%s) marks the read failed and tells the Tools drawer why', async (word, sentence) => {
  script('ok', word);
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS + SONOS_RETRY_MS);
  expect(reads).toBe(3);
  expect(result.current.status).toBe('error');
  expect(result.current.failure).toBe(word);
  expect(result.current.stale).toBe(true);
  expect(result.current.summary).not.toBeNull();
  expect(useReportStore.getState().sound).toMatchObject({ last: 'failed', reason: sentence });
});

it('text that is not one of the three words reads as "cannot be reached"', async () => {
  script('ok', 'Could not reach Sonos');
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS + SONOS_RETRY_MS);
  expect(result.current.failure).toBe('no-answer');
});

it('a good read after a failure clears it, and a failed second try does not wait for the next one', async () => {
  script('ok', 'timed-out', 'timed-out', 'ok');
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS + SONOS_RETRY_MS);
  expect(result.current.status).toBe('error');
  // While failed, the regular read goes on every 30 seconds.
  await flush(SONOS_REFRESH_MS);
  expect(reads).toBe(4);
  expect(result.current.status).toBe('ready');
  expect(result.current.failure).toBeNull();
  expect(result.current.stale).toBe(false);
  expect(useReportStore.getState().sound?.last).toBe('ok');
});

it('a failed first read shows nothing for 5 seconds, then says so', async () => {
  script('no-answer');
  const { result } = renderHook(() => useSonos());
  await flush(SONOS_RETRY_MS - 1);
  expect(result.current.status).toBe('loading');
  await flush(1);
  expect(result.current.status).toBe('error');
  expect(result.current.failure).toBe('no-answer');
  expect(reads).toBe(2);
});

it('not set up never retries', async () => {
  script('not-configured');
  const { result } = renderHook(() => useSonos());
  await flush(SONOS_RETRY_MS * 2);
  expect(result.current.status).toBe('unconfigured');
  expect(reads).toBe(1);
});

it('no extra read while the page is hidden, and the second try is dropped with it', async () => {
  script('ok', 'timed-out', 'ok');
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS);
  expect(reads).toBe(2);
  act(() => setHidden(true));
  await flush(SONOS_RETRY_MS * 3);
  expect(reads).toBe(2);
  expect(result.current.stale).toBe(false);
});

it('no extra read after unmount', async () => {
  script('ok', 'timed-out', 'ok');
  const { unmount } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS);
  expect(reads).toBe(2);
  unmount();
  await flush(SONOS_RETRY_MS * 3);
  expect(reads).toBe(2);
});

it('reads never stack: a read that has not answered is not joined by the retry or the timer', async () => {
  let calls = 0;
  mocks.set('wall2_sonos_summary', () => {
    calls += 1;
    return new Promise(() => undefined);
  });
  renderHook(() => useSonos());
  await flush(SONOS_REFRESH_MS * 3);
  expect(calls).toBe(1);
});

it('while the read is not live the card stays locked exactly as before: stale after two minutes without a good read', async () => {
  script('ok');
  const { result } = renderHook(() => useSonos());
  await flush();
  expect(result.current.stale).toBe(false);
  mocks.set('wall2_sonos_summary', () => new Promise(() => undefined));
  await flush(3 * 60_000);
  expect(result.current.stale).toBe(true);
});

it('a dimmed card recovers as soon as the second try works: dimmed, fail, good at 5 seconds', async () => {
  script('ok', 'timed-out', 'timed-out', 'timed-out', 'ok');
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS + SONOS_RETRY_MS);
  expect(result.current.status).toBe('error');
  await flush(SONOS_REFRESH_MS - SONOS_RETRY_MS);
  // The 60 second read failed; its second try is waiting. The card keeps its line and kind.
  expect(reads).toBe(4);
  expect(result.current.status).toBe('error');
  expect(result.current.failure).toBe('timed-out');
  await flush(SONOS_RETRY_MS - 1);
  expect(result.current.status).toBe('error');
  await flush(1);
  expect(reads).toBe(5);
  expect(result.current.status).toBe('ready');
  expect(result.current.failure).toBeNull();
  expect(result.current.stale).toBe(false);
  expect(useReportStore.getState().sound?.last).toBe('ok');
});

it('a dimmed card keeps its kind until the second try fails, and then shows that try\'s kind', async () => {
  script('ok', 'timed-out', 'timed-out', 'bad-answer', 'bad-answer');
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS + SONOS_RETRY_MS);
  expect(result.current.failure).toBe('timed-out');
  await flush(SONOS_REFRESH_MS - SONOS_RETRY_MS);
  expect(reads).toBe(4);
  expect(result.current.failure).toBe('timed-out');
  expect(useReportStore.getState().sound?.reason).toBe('Sonos did not answer in time.');
  await flush(SONOS_RETRY_MS);
  expect(reads).toBe(5);
  expect(result.current.failure).toBe('bad-answer');
  expect(useReportStore.getState().sound?.reason).toBe('Sonos sent an answer the wall could not read.');
});

it('two different kinds in a row: the second one is shown', async () => {
  script('ok', 'bad-answer', 'timed-out');
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS + SONOS_RETRY_MS);
  expect(result.current.failure).toBe('timed-out');
});

it('timers never stack: three while a second try waits, none after the page is hidden or the card closed', async () => {
  script('ok', 'timed-out');
  const { result, unmount } = renderHook(() => useSonos());
  await flush();
  const base = vi.getTimerCount();
  expect(base).toBe(2);
  await flush(SONOS_REFRESH_MS);
  expect(result.current.status).toBe('ready');
  expect(vi.getTimerCount()).toBe(base + 1);
  // Manual reads while the second try waits arm nothing more.
  await act(async () => {
    await result.current.refresh();
    await result.current.refresh();
  });
  expect(vi.getTimerCount()).toBe(base + 1);
  act(() => setHidden(true));
  expect(vi.getTimerCount()).toBe(0);
  act(() => setHidden(false));
  await flush();
  expect(vi.getTimerCount()).toBe(base + 1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('after a failure and a second failure no timer is left but the two cadence timers', async () => {
  script('ok', 'timed-out');
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS + SONOS_RETRY_MS);
  expect(result.current.status).toBe('error');
  expect(vi.getTimerCount()).toBe(2);
});

it('a second try that comes due while another read is running goes right after it', async () => {
  let reads2 = 0;
  let release: (() => void) | null = null;
  mocks.set('wall2_sonos_summary', () => {
    reads2 += 1;
    if (reads2 === 1) return {};
    if (reads2 === 2) return Promise.reject(new Error('timed-out'));
    if (reads2 === 3) return new Promise((_, reject) => { release = () => reject(new Error('timed-out')); });
    return Promise.reject(new Error('timed-out'));
  });
  const { result } = renderHook(() => useSonos());
  await flush();
  await flush(SONOS_REFRESH_MS);
  expect(reads2).toBe(2);
  // A manual read starts just before the second try is due and runs past it.
  await flush(SONOS_RETRY_MS - 1000);
  act(() => void result.current.refresh());
  await flush(1000);
  expect(reads2).toBe(3);
  expect(result.current.status).toBe('ready');
  await act(async () => release?.());
  await flush();
  // The slow read failed; the second try ran right after it and failed too.
  expect(reads2).toBe(4);
  expect(result.current.status).toBe('error');
  expect(vi.getTimerCount()).toBe(2);
});
