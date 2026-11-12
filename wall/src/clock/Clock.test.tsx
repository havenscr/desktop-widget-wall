import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Clock } from './Clock';

afterEach(() => vi.useRealTimers());

it('renders the injected time and date', () => {
  const fixed = () => new Date(2026, 10, 11, 10, 24, 10);
  render(<Clock now={fixed} />);
  expect(screen.getByText('Wednesday, November 11')).toBeTruthy();
  expect(screen.getByRole('group', { name: '10:24 AM' })).toBeTruthy();
});

it('settles when rendered with no props', async () => {
  let renders = 0;
  render(
    <Profiler id="clock" onRender={() => renders++}>
      <Clock />
    </Profiler>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(renders).toBeLessThan(5);
});

it('changes only after the minute boundary', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 24, 30));
  render(<Clock now={() => new Date()} />);
  expect(screen.getByRole('group', { name: '10:24 AM' })).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(20000);
  });
  expect(screen.getByRole('group', { name: '10:24 AM' })).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(11000);
  });
  expect(screen.getByRole('group', { name: '10:25 AM' })).toBeTruthy();
});
