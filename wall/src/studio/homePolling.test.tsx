import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { studioAnswer } from './homeKit';
import { HOME_READ_EVERY_MS, resetHome } from './homeStore';
import { useHomePolling } from './useHomePolling';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
let reads: number;

function Probe({ enabled = true }: { enabled?: boolean }) {
  useHomePolling(enabled);
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
  mocks.set('wall2_studio', () => {
    reads++;
    return studioAnswer();
  });
});
afterEach(() => {
  setHidden(false);
  resetHome();
  vi.useRealTimers();
  mocks.clear();
});

it('reads once when it shows and every 60 seconds, and stops when it goes', async () => {
  const view = render(<Probe />);
  await flush();
  expect(reads).toBe(1);
  await flush(HOME_READ_EVERY_MS);
  expect(reads).toBe(2);
  view.unmount();
  await flush(HOME_READ_EVERY_MS * 3);
  expect(reads).toBe(2);
});

it('nothing is read while the page is hidden, and one read comes when it is visible again', async () => {
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
