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

it('puts the build stamp on the last line of the tooltip', async () => {
  const { mocks } = await import('../bridge/tauri');
  mocks.set('wall2_build_info', () => ({ commit: 'abc1234', builtAt: '2026-11-13T09:05Z' }));
  const { container } = render(<Clock now={() => new Date(2026, 10, 11, 10, 24, 10)} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const lines = (container.firstElementChild as HTMLElement).title.split('\n');
  expect(lines[0]).toBe('10:24 AM, Wednesday, November 11');
  expect(lines[lines.length - 1]).toMatch(/^Build abc1234, /);
});
