import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetMeetingFeed, useNextMeeting } from './useNextMeeting';

afterEach(() => {
  resetMeetingFeed();
  vi.useRealTimers();
  mocks.delete('wall2_meet_next');
});

function Next({ id, now }: { id: string; now?: () => number }) {
  const { meeting, asOf } = useNextMeeting(now);
  return (
    <span data-testid={id} data-asof={asOf ?? ''}>
      {meeting?.title ?? '-'}
    </span>
  );
}

function hide(h: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}

it('two users share one read per interval, and both see the meeting', async () => {
  vi.useFakeTimers();
  const start = new Date(Date.now() + 60 * 60_000).toISOString();
  const end = new Date(Date.now() + 90 * 60_000).toISOString();
  const read = vi.fn(() => ({ accounts: [], meetings: [{ key: 'k', accountId: 'a', title: 'Planning', start, end, canJoin: false }] }));
  mocks.set('wall2_meet_next', read);
  const { getByTestId } = render(
    <>
      <Next id="a" />
      <Next id="b" />
    </>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(getByTestId('a').textContent).toBe('Planning');
  expect(getByTestId('b').textContent).toBe('Planning');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5 * 60_000);
  });
  expect(read).toHaveBeenCalledTimes(2);
});

it('hiding the page then showing it keeps the list and its time, with no extra read inside the interval', async () => {
  vi.useFakeTimers();
  const start = new Date(Date.now() + 60 * 60_000).toISOString();
  const end = new Date(Date.now() + 90 * 60_000).toISOString();
  const read = vi.fn(() => ({ accounts: [], meetings: [{ key: 'k', accountId: 'a', title: 'Planning', start, end, canJoin: false }] }));
  mocks.set('wall2_meet_next', read);
  const clock = () => 1_234_567;
  const { getByTestId } = render(<Next id="a" now={clock} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(getByTestId('a').textContent).toBe('Planning');
  // The read is stamped with the injected clock, not the system clock.
  expect(getByTestId('a').getAttribute('data-asof')).toBe('1234567');
  hide(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  mocks.set('wall2_meet_next', () => {
    throw new Error('offline');
  });
  hide(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(getByTestId('a').textContent).toBe('Planning');
  expect(getByTestId('a').getAttribute('data-asof')).toBe('1234567');
  expect(read).toHaveBeenCalledTimes(1);
});
