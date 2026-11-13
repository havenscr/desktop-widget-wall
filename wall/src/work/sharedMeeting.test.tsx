import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useNextMeeting } from './useNextMeeting';

afterEach(() => {
  vi.useRealTimers();
  mocks.delete('wall2_meet_next');
});

function Next({ id }: { id: string }) {
  const { meeting } = useNextMeeting();
  return <span data-testid={id}>{meeting?.title ?? '-'}</span>;
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
