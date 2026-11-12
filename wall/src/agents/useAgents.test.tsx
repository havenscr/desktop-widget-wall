import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { lane, summary } from './fixtures';
import { KEEP_STALE_MS, POLL_MS, type OmniSummary } from './model';
import { resetAgents, useAgents, useAgentStatusLine, useAgentsWaiting } from './useAgents';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let calls = 0;
let answer: () => unknown;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 24));
  calls = 0;
  answer = () => summary();
  mocks.set('wall2_omni_summary', () => {
    calls += 1;
    return answer();
  });
  resetAgents();
});
afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  resetAgents();
  vi.useRealTimers();
  mocks.clear();
});

it('reads on mount and every 15 seconds, once for any number of users', async () => {
  function Two() {
    useAgents();
    useAgentsWaiting();
    useAgentStatusLine();
    return null;
  }
  render(<Two />);
  render(<Two />);
  await flush();
  expect(calls).toBe(1);
  await flush(POLL_MS);
  expect(calls).toBe(2);
  await flush(POLL_MS);
  expect(calls).toBe(3);
});

it('reads nothing while the page is hidden', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  renderHook(() => useAgents());
  await flush(4 * POLL_MS);
  expect(calls).toBe(0);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
  await flush();
  expect(calls).toBe(1);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
  await flush(4 * POLL_MS);
  expect(calls).toBe(1);
});

it('stops polling once the last user unmounts', async () => {
  const { unmount } = renderHook(() => useAgents());
  await flush();
  unmount();
  await flush(4 * POLL_MS);
  expect(calls).toBe(1);
});

it('is unconfigured without a helper address, and for a bad one', async () => {
  answer = () => {
    throw new Error('not-configured');
  };
  const { result } = renderHook(() => useAgents());
  await flush();
  expect(result.current.status).toBe('unconfigured');
  expect(result.current.summary).toBeNull();
  answer = () => {
    throw new Error('invalid-config');
  };
  await flush(POLL_MS);
  expect(result.current.status).toBe('unconfigured');
});

it('is unreachable when the first reads fail', async () => {
  answer = () => {
    throw new Error('failed');
  };
  const { result } = renderHook(() => useAgents());
  await flush();
  expect(result.current.status).toBe('unreachable');
  expect(result.current.summary).toBeNull();
});

it('treats an answer that is not a summary as a failed read', async () => {
  answer = () => ({ lanes: 'x' });
  const { result } = renderHook(() => useAgents());
  await flush();
  expect(result.current.status).toBe('unreachable');
});

it('keeps the last answer, marked failed, after a failed read, then drops it after 30 minutes', async () => {
  const { result } = renderHook(() => useAgents());
  await flush();
  const freshAt = result.current.freshAt;
  expect(result.current.status).toBe('ready');
  expect(freshAt).not.toBeNull();
  answer = () => {
    throw new Error('failed');
  };
  await flush(POLL_MS);
  expect(result.current.status).toBe('ready');
  expect(result.current.readFailed).toBe(true);
  expect(result.current.summary).not.toBeNull();
  expect(result.current.freshAt).toBe(freshAt);
  await flush(KEEP_STALE_MS);
  expect(result.current.status).toBe('unreachable');
  expect(result.current.summary).toBeNull();
});

it('a stale answer from the helper keeps the time of the last fresh one', async () => {
  const { result } = renderHook(() => useAgents());
  await flush();
  const freshAt = result.current.freshAt;
  answer = () => summary({ stale: true });
  await flush(POLL_MS);
  expect(result.current.summary!.stale).toBe(true);
  expect(result.current.freshAt).toBe(freshAt);
  expect(result.current.okAt).toBeGreaterThan(freshAt!);
});

it('a stale first answer has no fresh time', async () => {
  answer = () => summary({ stale: true });
  const { result } = renderHook(() => useAgents());
  await flush();
  expect(result.current.status).toBe('ready');
  expect(result.current.freshAt).toBeNull();
});

it('gives up on a read that takes over 10 seconds, and starts the next one', async () => {
  let hang = true;
  mocks.set('wall2_omni_summary', () => {
    calls += 1;
    return hang ? new Promise<OmniSummary>(() => undefined) : summary();
  });
  const { result } = renderHook(() => useAgents());
  await flush(10_001);
  expect(result.current.status).toBe('unreachable');
  hang = false;
  await flush(POLL_MS);
  expect(result.current.status).toBe('ready');
});

it('useAgentStatusLine gives one line, or null when not set up', async () => {
  answer = () => summary({ lanes: [lane(), lane({ id: 'a1b2c3d4-0002' })] });
  const { result } = renderHook(() => useAgentStatusLine());
  await flush();
  expect(result.current).toBe('Two agents still working, nothing needs you');
  answer = () => {
    throw new Error('not-configured');
  };
  await flush(POLL_MS);
  expect(result.current).toBeNull();
});

it('useAgentsWaiting is true while something waits for an answer', async () => {
  const { result } = renderHook(() => useAgentsWaiting());
  await flush();
  expect(result.current).toBe(false);
  answer = () => summary({ lanes: [lane({ waiting: true })] });
  await flush(POLL_MS);
  expect(result.current).toBe(true);
  answer = () => summary({ lanes: [lane()], yourMove: { total: 1, first: null } });
  await flush(POLL_MS);
  expect(result.current).toBe(true);
  answer = () => {
    throw new Error('not-configured');
  };
  await flush(POLL_MS);
  expect(result.current).toBe(false);
});
