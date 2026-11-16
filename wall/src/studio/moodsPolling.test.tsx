import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HOME_READ_EVERY_MS, resetHome } from './homeStore';
import { useMoodsPolling } from './useMoodsPolling';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
let reads: number;
let studioReads: number;

function Probe({ enabled = true }: { enabled?: boolean }) {
  useMoodsPolling(enabled);
  return null;
}
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  resetHome();
  reads = 0;
  studioReads = 0;
  mocks.set('wall2_office_moods', () => {
    reads++;
    return { stale: false, moods: [{ id: 'brightDesk', label: 'Bright desk', line: null, active: false }], canWrite: true, writeBlock: null };
  });
  mocks.set('wall2_studio', () => {
    studioReads++;
    throw 'absent';
  });
});
afterEach(() => {
  setHidden(false);
  resetHome();
  vi.useRealTimers();
  mocks.clear();
});

it('joins with one read, then reads every 60 seconds, and leaves with the shared poll stopped', async () => {
  const view = render(<Probe />);
  await flush();
  expect(reads).toBe(1);
  await flush(HOME_READ_EVERY_MS);
  expect(reads).toBe(2);
  view.unmount();
  await flush(HOME_READ_EVERY_MS * 3);
  expect(reads).toBe(2);
  // It never touches the studio poll.
  expect(studioReads).toBe(0);
});

it('two users share one poll; it stops with the last one', async () => {
  const a = render(<Probe />);
  const b = render(<Probe />);
  await flush();
  expect(reads).toBe(2);
  await flush(HOME_READ_EVERY_MS);
  expect(reads).toBe(3);
  a.unmount();
  await flush(HOME_READ_EVERY_MS);
  expect(reads).toBe(4);
  b.unmount();
  await flush(HOME_READ_EVERY_MS * 2);
  expect(reads).toBe(4);
});

it('reads nothing while the page is hidden or the display is off, and one read when it is awake again', async () => {
  setHidden(true);
  render(<Probe />);
  await flush(HOME_READ_EVERY_MS * 3);
  expect(reads).toBe(0);
  setHidden(false);
  await flush();
  expect(reads).toBe(1);
  setHidden(true);
  await flush(HOME_READ_EVERY_MS * 3);
  expect(reads).toBe(1);
});

it('a disabled user reads nothing', async () => {
  render(<Probe enabled={false} />);
  await flush(HOME_READ_EVERY_MS * 2);
  expect(reads).toBe(0);
});
