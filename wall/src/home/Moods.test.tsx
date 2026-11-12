import { act, fireEvent, render, screen } from '@testing-library/react';
import { IconBulb, IconMoon, IconSun, IconSunset } from '@tabler/icons-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { LAST_MOOD_KEY, Moods, moodIcon, moodLabel } from './Moods';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const LIST = [
  { id: 'day', label: 'Day' },
  { id: 'evening', label: 'Evening' },
  { id: 'lateNight', label: 'Late Night' },
];
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

it('maps ids to labels and icons', () => {
  expect(moodLabel({ id: 'lateNight', label: '' })).toBe('Late Night');
  expect(moodLabel({ id: 'day', label: 'Day' })).toBe('Day');
  expect(moodIcon('day')).toBe(IconSun);
  expect(moodIcon('evening')).toBe(IconSunset);
  expect(moodIcon('lateNight')).toBe(IconMoon);
  expect(moodIcon('movie')).toBe(IconBulb);
});

it('lists the moods in order and never applies one without a tap', async () => {
  const apply = vi.fn();
  mocks.set('wall2_moods', () => LIST);
  mocks.set('wall2_apply_mood', apply);
  render(<Moods />);
  await flush(11 * 60_000);
  const names = screen.getAllByRole('button').map((b) => b.textContent);
  expect(names).toEqual(['Day', 'Evening', 'Late Night']);
  expect(apply).not.toHaveBeenCalled();
});

it('shows working, then a check for 2 seconds, and remembers the mood', async () => {
  let release: () => void = () => undefined;
  const apply = vi.fn(() => new Promise<void>((r) => (release = r)));
  mocks.set('wall2_moods', () => LIST);
  mocks.set('wall2_apply_mood', apply);
  const { container } = render(<Moods />);
  await flush();
  fireEvent.click(screen.getByText('Evening'));
  await flush();
  expect(apply).toHaveBeenCalledWith({ id: 'evening' });
  expect(container.querySelector('.mood-btn.working')).toBeTruthy();
  expect((screen.getByText('Day').closest('button') as HTMLButtonElement).disabled).toBe(true);
  release();
  await flush();
  expect(container.querySelector('.mood-btn.done')).toBeTruthy();
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBe('evening');
  await flush(2100);
  expect(container.querySelector('.mood-btn.done')).toBeNull();
  expect(container.querySelector('.mood-btn.last')?.getAttribute('data-mood')).toBe('evening');
});

it('marks the saved last mood on open', async () => {
  localStorage.setItem(LAST_MOOD_KEY, 'day');
  mocks.set('wall2_moods', () => LIST);
  const { container } = render(<Moods />);
  await flush();
  expect(container.querySelector('.mood-btn.last')?.getAttribute('data-mood')).toBe('day');
});

it('shows a failure under the row for 5 seconds and does not remember it', async () => {
  mocks.set('wall2_moods', () => LIST);
  mocks.set('wall2_apply_mood', () => Promise.reject(new Error('Moods are not set up in the home app yet')));
  const { container } = render(<Moods />);
  await flush();
  fireEvent.click(screen.getByText('Day'));
  await flush();
  expect(screen.getByText('Moods are not set up in the home app yet')).toBeTruthy();
  expect(container.querySelector('.mood-btn.working')).toBeNull();
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBeNull();
  await flush(5100);
  expect(screen.queryByText('Moods are not set up in the home app yet')).toBeNull();
});

it('shows Not set up with no config and nothing for an empty list', async () => {
  mocks.set('wall2_moods', () => Promise.reject(new Error('not-configured')));
  const first = render(<Moods />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
  first.unmount();
  mocks.set('wall2_moods', () => []);
  const second = render(<Moods />);
  await flush();
  expect(second.container.innerHTML).toBe('');
});

it('reloads the list every 10 minutes', async () => {
  const list = vi.fn(() => LIST);
  mocks.set('wall2_moods', list);
  render(<Moods />);
  await flush();
  expect(list).toHaveBeenCalledTimes(1);
  await flush(10 * 60_000);
  expect(list).toHaveBeenCalledTimes(2);
});

it('shows Not set up when applying fails because the config is missing', async () => {
  mocks.set('wall2_moods', () => LIST);
  mocks.set('wall2_apply_mood', () => Promise.reject(new Error('not-configured')));
  render(<Moods />);
  await flush();
  fireEvent.click(screen.getByText('Day'));
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
  expect(screen.queryByText('Could not set the mood')).toBeNull();
});
