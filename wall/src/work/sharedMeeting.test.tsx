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
  const { meeting, asOf, now: t } = useNextMeeting(now);
  return (
    <span data-testid={id} data-asof={asOf ?? ''} data-now={t}>
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

const meetingBody = () => {
  const start = new Date(Date.now() + 60 * 60_000).toISOString();
  const end = new Date(Date.now() + 90 * 60_000).toISOString();
  return { accounts: [], meetings: [{ key: 'k', accountId: 'a', title: 'Planning', start, end, canJoin: false }] };
};
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it('a screen that mounts reads again when the last read is a minute old, not before', async () => {
  vi.useFakeTimers();
  const read = vi.fn(meetingBody);
  mocks.set('wall2_meet_next', read);
  render(<Next id="a" />);
  await wait(10);
  expect(read).toHaveBeenCalledTimes(1);
  await wait(30_000);
  render(<Next id="b" />);
  await wait(10);
  expect(read).toHaveBeenCalledTimes(1);
  await wait(31_000);
  render(<Next id="c" />);
  await wait(10);
  expect(read).toHaveBeenCalledTimes(2);
});

it('after a failed read the next tick retries, at most once every 30 seconds', async () => {
  vi.useFakeTimers();
  const read = vi.fn(() => {
    throw new Error('offline');
  });
  mocks.set('wall2_meet_next', read);
  render(<Next id="a" />);
  await wait(10);
  expect(read).toHaveBeenCalledTimes(1);
  await wait(10_000);
  expect(read).toHaveBeenCalledTimes(1);
  await wait(21_000);
  expect(read).toHaveBeenCalledTimes(2);
  await wait(10_000);
  expect(read).toHaveBeenCalledTimes(2);
  await wait(21_000);
  expect(read).toHaveBeenCalledTimes(3);
});

it('a mount inside 30 seconds of a failed read does not retry', async () => {
  vi.useFakeTimers();
  const read = vi.fn(() => {
    throw new Error('offline');
  });
  mocks.set('wall2_meet_next', read);
  render(<Next id="a" />);
  await wait(10);
  render(<Next id="b" />);
  await wait(10);
  expect(read).toHaveBeenCalledTimes(1);
});

it('a page shown again gives each user the current time at once', async () => {
  vi.useFakeTimers();
  let ms = 1_000_000;
  const clock = () => ms;
  mocks.set('wall2_meet_next', meetingBody);
  const { getByTestId } = render(<Next id="a" now={clock} />);
  await wait(10);
  hide(true);
  ms += 20_000;
  hide(false);
  expect(getByTestId('a').getAttribute('data-now')).toBe(String(ms));
});
