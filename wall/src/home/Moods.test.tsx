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
  await flush(1999 - 0);
  expect(container.querySelector('.mood-btn.done')).toBeTruthy();
  await flush(1);
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
  await flush(4999);
  expect(screen.getByText('Moods are not set up in the home app yet')).toBeTruthy();
  await flush(1);
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

it('names the last mood "last used" and does not use aria-pressed', async () => {
  localStorage.setItem(LAST_MOOD_KEY, 'evening');
  mocks.set('wall2_moods', () => LIST);
  render(<Moods />);
  await flush();
  expect(screen.getByRole('button', { name: 'Evening, last used' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Day' })).toBeTruthy();
  for (const b of screen.getAllByRole('button')) expect(b.hasAttribute('aria-pressed')).toBe(false);
});

it('still works when local storage throws', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  mocks.set('wall2_moods', () => LIST);
  mocks.set('wall2_apply_mood', () => undefined);
  const { container } = render(<Moods />);
  await flush();
  expect(screen.getAllByRole('button')).toHaveLength(3);
  fireEvent.click(screen.getByText('Day'));
  await flush();
  expect(container.querySelector('.mood-btn.done')).toBeTruthy();
  vi.restoreAllMocks();
});

it('leaves no timer running when unmounted during the done or error timer', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.set('wall2_moods', () => LIST);
  mocks.set('wall2_apply_mood', () => undefined);
  const a = render(<Moods />);
  await flush();
  fireEvent.click(screen.getByText('Day'));
  await flush();
  a.unmount();
  const b = (() => {
    mocks.set('wall2_apply_mood', () => Promise.reject(new Error('Could not set the mood')));
    return render(<Moods />);
  })();
  await flush();
  fireEvent.click(screen.getByText('Evening'));
  await flush();
  b.unmount();
  // Only the 10 minute reload interval of a mounted component may remain; both are unmounted.
  expect(vi.getTimerCount()).toBe(0);
  await flush(10_000);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});
