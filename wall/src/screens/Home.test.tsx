import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePacificTime } from '../ribbon/testZone';
import { Home } from './Home';

usePacificTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T16:30:00-08:00'));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

it('lays Home on the concept zones: sun block, mood cards, chores and network, and no Rooms placeholder', async () => {
  mocks.set('wall2_moods', () => [
    { id: 'day', label: 'Day' },
    { id: 'evening', label: 'Evening' },
  ]);
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
  mocks.set('wall2_home_security', () => Promise.reject(new Error('Could not reach the service')));
  const { container } = render(<Home />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const home = container.querySelector('section.home.zones');
  expect(home).toBeTruthy();
  expect([...home!.children].map((c) => c.className)).toEqual(['home-wing', 'moods', 'home-right']);
  expect(screen.getByText(/^Sunset in \d+ min$/)).toBeTruthy();
  expect(container.querySelectorAll('.mood-btn')).toHaveLength(2);
  expect(screen.getByLabelText('Around the house')).toBeTruthy();
  // Unreachable is a quiet amber line inside the network card, nowhere else.
  const net = screen.getByLabelText('Network and security');
  expect(net.textContent).toContain('Home app not reachable');
  expect(container.querySelector('.home-wing')?.textContent).not.toContain('not reachable');
  expect(screen.queryByText(/Rooms/)).toBeNull();
});
