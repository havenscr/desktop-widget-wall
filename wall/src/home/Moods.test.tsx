import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { ERROR_MS, LAST_MOOD_KEY, MOODS_CACHE_KEY, MOODS_PAGE, MOODS_REFRESH_MS, pageStart, Moods, inText, moodLabel, moodNote } from './Moods';
import { artKind } from './MoodArt';

// Some tests step fake timers through minutes: a busy machine gets 20 seconds per test.
vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
/** The mood cards: every button but the Condo / Office pick in the heading. */
const cardButtons = () => screen.getAllByRole('button').filter((b) => !b.classList.contains('moods-pick'));
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

it('maps ids to labels, notes and art', () => {
  expect(moodLabel({ id: 'lateNight', label: '' })).toBe('Late Night');
  expect(moodLabel({ id: 'day', label: 'Day' })).toBe('Day');
  expect(moodNote('day')).toBe('bright and cool');
  expect(moodNote('reading')).toBeNull();
  expect(artKind('day')).toBe('day');
  expect(artKind('evening')).toBe('evening');
  expect(artKind('lateNight')).toBe('night');
  expect(artKind('reading')).toBe('lamp');
});

it('lists the moods in order and never applies one without a tap', async () => {
  const apply = vi.fn();
  mocks.set('wall2_moods', () => LIST);
  mocks.set('wall2_apply_mood', apply);
  render(<Moods />);
  await flush(11 * 60_000);
  const names = cardButtons().map((b) => b.querySelector('.mood-name')?.textContent);
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
  await flush(1999);
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

it('shows Not set up with no config, and one compact card for an empty list', async () => {
  mocks.set('wall2_moods', () => Promise.reject(new Error('not-configured')));
  const first = render(<Moods />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
  first.unmount();
  mocks.set('wall2_moods', () => []);
  const second = render(<Moods />);
  await flush();
  expect(second.container.querySelectorAll('.mood-btn')).toHaveLength(0);
  expect(second.container.querySelector('.mood-empty')?.textContent).toBe('No moods set up in the home app yet');
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

it('marks the last mood "On now" and does not use aria-pressed', async () => {
  localStorage.setItem(LAST_MOOD_KEY, 'evening');
  mocks.set('wall2_moods', () => LIST);
  const { container } = render(<Moods />);
  await flush();
  expect(screen.getByRole('button', { name: 'Evening, on now' })).toBeTruthy();
  expect(container.querySelectorAll('.mood-tag')).toHaveLength(1);
  expect(screen.getByText('On now').closest('button')?.getAttribute('data-mood')).toBe('evening');
  expect(screen.getByRole('button', { name: 'Day' })).toBeTruthy();
  for (const b of cardButtons()) expect(b.hasAttribute('aria-pressed')).toBe(false);
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
  expect(cardButtons()).toHaveLength(3);
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

it('shows nothing, not Loading, while the page is hidden at first mount', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const list = vi.fn(() => LIST);
  mocks.set('wall2_moods', list);
  const { container } = render(<Moods />);
  await flush();
  expect(container.innerHTML).toBe('');
  expect(list).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
  expect(list).toHaveBeenCalledTimes(1);
  expect(cardButtons()).toHaveLength(3);
  hidden.mockRestore();
});

it('keeps the last good cards with a quiet amber line when the home app is away', async () => {
  mocks.set('wall2_moods', () => LIST);
  const a = render(<Moods />);
  await flush();
  expect(JSON.parse(localStorage.getItem(MOODS_CACHE_KEY) ?? '[]')).toHaveLength(3);
  a.unmount();
  mocks.set('wall2_moods', () => Promise.reject(new Error('Could not reach the service')));
  const { container } = render(<Moods />);
  await flush();
  expect(cardButtons()).toHaveLength(3);
  expect(container.querySelector('.warn-text')?.textContent).toBe('Home app not reachable');
});

it('with no list ever read, a failure is one quiet line and no cards', async () => {
  mocks.set('wall2_moods', () => Promise.reject(new Error('Could not reach the service')));
  const { container } = render(<Moods />);
  await flush();
  expect(screen.queryAllByRole('button').filter((b) => !b.classList.contains('moods-pick'))).toHaveLength(0);
  expect(container.querySelector('.moods.bare')).toBeTruthy();
  expect(screen.getByText('Home app not reachable')).toBeTruthy();
});

it('says "In N min" for a mood the home app schedules within the hour, and never on the one on now', async () => {
  vi.setSystemTime(new Date('2026-11-12T16:30:00-08:00'));
  const t = Date.now();
  mocks.set('wall2_moods', () => [
    { id: 'day', label: 'Day', nextAtMs: t + 90 * 60_000 },
    { id: 'evening', label: 'Evening', nextAtMs: t + 4 * 60_000 + 1 },
    { id: 'lateNight', label: 'Late Night', nextAtMs: t + 10 * 60_000 },
  ]);
  localStorage.setItem(LAST_MOOD_KEY, 'lateNight');
  render(<Moods />);
  await flush();
  expect(screen.getByText('In 5 min')).toBeTruthy();
  expect(screen.queryAllByText(/^In \d+ min$/)).toHaveLength(1);
  expect(screen.getByText('On now')).toBeTruthy();
  expect(inText(null, t)).toBeNull();
  expect(inText(t - 60_000, t)).toBeNull();
  expect(inText(t + 61 * 60_000, t)).toBeNull();
});

it('four moods fill the row; more show four large and a More card that slides by four, then Back', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, label: `Mood ${i}` }));
  mocks.set('wall2_moods', () => many.slice(0, MOODS_PAGE));
  const four = render(<Moods />);
  await flush();
  const row = four.container.querySelector('.mood-row') as HTMLElement;
  expect(row.className).toBe('mood-row');
  expect(row.style.gridTemplateColumns).toMatch(/^repeat\(4, /);
  expect(four.container.querySelector('.mood-more')).toBeNull();
  four.unmount();
  mocks.set('wall2_moods', () => many);
  const nine = render(<Moods />);
  await flush();
  const names = () => [...nine.container.querySelectorAll('.mood-btn .mood-name')].map((n) => n.textContent);
  expect(names()).toEqual(['Mood 0', 'Mood 1', 'Mood 2', 'Mood 3']);
  expect(screen.getByText('5 more')).toBeTruthy();
  fireEvent.click(nine.container.querySelector('.mood-more') as HTMLElement);
  expect(names()).toEqual(['Mood 4', 'Mood 5', 'Mood 6', 'Mood 7']);
  expect(screen.getByText('1 more')).toBeTruthy();
  // The last page shows the last four, and the More card turns into Back.
  fireEvent.click(nine.container.querySelector('.mood-more') as HTMLElement);
  expect(names()).toEqual(['Mood 5', 'Mood 6', 'Mood 7', 'Mood 8']);
  expect(screen.getByText('Back')).toBeTruthy();
  fireEvent.click(nine.container.querySelector('.mood-more') as HTMLElement);
  expect(names()).toEqual(['Mood 0', 'Mood 1', 'Mood 2', 'Mood 3']);
  // The wheel steps once per gesture.
  fireEvent.wheel(nine.container.querySelector('.mood-row') as HTMLElement, { deltaY: 40 });
  expect(names()).toEqual(['Mood 4', 'Mood 5', 'Mood 6', 'Mood 7']);
  expect(pageStart(2, 9)).toBe(5);
  expect(pageStart(0, 2)).toBe(0);
});

it('the last page keeps a full row of four, as the drawn carousel stops at its end: dots and the More card stay truthful', async () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, label: `Mood ${i}` }));
  mocks.set('wall2_moods', () => five);
  const { container } = render(<Moods />);
  await flush();
  const names = () => [...container.querySelectorAll('.mood-btn .mood-name')].map((n) => n.textContent);
  const dots = () => [...container.querySelectorAll('.mood-dots i')].map((d) => d.className);
  expect(names()).toEqual(['Mood 0', 'Mood 1', 'Mood 2', 'Mood 3']);
  expect(screen.getByText('1 more')).toBeTruthy();
  expect(dots()).toEqual(['on', '']);
  fireEvent.click(container.querySelector('.mood-more') as HTMLElement);
  // The row stops at its end: the last four, so the one new mood comes in on the right
  // and no card slot is left empty. Nothing is left to the right, so the card reads Back.
  expect(names()).toEqual(['Mood 1', 'Mood 2', 'Mood 3', 'Mood 4']);
  expect(screen.queryByText(/ more$/)).toBeNull();
  expect(screen.getByText('Back')).toBeTruthy();
  expect(dots()).toEqual(['', 'on']);
});

it('Still Working leads with its line and art, and an unsaved one is quiet and sends nothing', async () => {
  expect(moodNote('stillWorking')).toBe('bright and focused');
  expect(artKind('stillWorking')).toBe('bulb');
  const apply = vi.fn();
  mocks.set('wall2_moods', () => [{ id: 'stillWorking', label: 'Still Working', saved: false }, ...LIST]);
  mocks.set('wall2_apply_mood', apply);
  const { container } = render(<Moods />);
  await flush();
  const first = container.querySelector('.mood-btn') as HTMLElement;
  expect(first.getAttribute('data-mood')).toBe('stillWorking');
  expect(first.classList.contains('unsaved')).toBe(true);
  expect(first.querySelector('.mood-sub')?.textContent).toBe('Not set up yet');
  expect(first.getAttribute('aria-label')).toBe('Still Working, not set up yet');
  expect(container.querySelectorAll('.mood-btn.unsaved')).toHaveLength(1);
  expect(container.querySelector('.mood-more')).toBeNull();
  fireEvent.click(first);
  await flush();
  expect(apply).not.toHaveBeenCalled();
  expect(container.querySelector('.mood-btn.working')).toBeNull();
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBeNull();
  // The saved flag survives the cache, so the card stays quiet while the home app is away.
  expect(JSON.parse(localStorage.getItem(MOODS_CACHE_KEY) ?? '[]')[0]).toEqual({ id: 'stillWorking', label: 'Still Working', saved: false });
  fireEvent.click(screen.getByText('Day'));
  await flush();
  expect(apply).toHaveBeenCalledWith({ id: 'day' });
});

it('a saved Still Working applies like the others', async () => {
  const apply = vi.fn();
  mocks.set('wall2_moods', () => [{ id: 'stillWorking', label: 'Still Working', saved: true }, ...LIST]);
  mocks.set('wall2_apply_mood', apply);
  const { container } = render(<Moods />);
  await flush();
  const first = container.querySelector('.mood-btn') as HTMLElement;
  expect(first.classList.contains('unsaved')).toBe(false);
  expect(first.querySelector('.mood-sub')?.textContent).toBe('bright and focused');
  fireEvent.click(first);
  await flush();
  expect(apply).toHaveBeenCalledWith({ id: 'stillWorking' });
});

it('a saved Still Working that the home app refuses shows the failure and is not marked as set', async () => {
  const SW = { id: 'stillWorking', label: 'Still Working', saved: true };
  mocks.set('wall2_moods', () => [SW, ...LIST]);
  mocks.set('wall2_apply_mood', () => Promise.reject(new Error('Moods are not set up in the home app yet')));
  const { container } = render(<Moods />);
  await flush();
  fireEvent.click(screen.getByText('Still Working'));
  await flush();
  expect(screen.getByText('Moods are not set up in the home app yet')).toBeTruthy();
  expect(container.querySelector('.mood-btn.working, .mood-btn.done, .mood-btn.last')).toBeNull();
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBeNull();
  await flush(ERROR_MS);
  expect(screen.queryByText('Moods are not set up in the home app yet')).toBeNull();
  mocks.set('wall2_apply_mood', () => Promise.reject(new Error('Could not set the mood')));
  fireEvent.click(screen.getByText('Still Working'));
  await flush();
  expect(screen.getByText('Could not set the mood')).toBeTruthy();
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBeNull();
});

it('a superseded apply is not marked done or "On now", and a normal answer still is', async () => {
  localStorage.setItem(LAST_MOOD_KEY, 'day');
  mocks.set('wall2_moods', () => [{ id: 'stillWorking', label: 'Still Working', saved: true }, ...LIST]);
  mocks.set('wall2_apply_mood', () => ({ superseded: true }));
  const { container } = render(<Moods />);
  await flush();
  fireEvent.click(screen.getByText('Still Working'));
  await flush();
  expect(container.querySelector('.mood-btn.working, .mood-btn.done')).toBeNull();
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBe('day');
  expect(container.querySelector('.mood-btn.last')?.getAttribute('data-mood')).toBe('day');
  mocks.set('wall2_apply_mood', () => ({ superseded: false }));
  fireEvent.click(screen.getByText('Still Working'));
  await flush();
  expect(container.querySelector('.mood-btn.done')).toBeTruthy();
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBe('stillWorking');
});

it('a cached unsaved Still Working turns into a saved one after the next refresh', async () => {
  mocks.set('wall2_moods', () => [{ id: 'stillWorking', label: 'Still Working', saved: false }, ...LIST]);
  const a = render(<Moods />);
  await flush();
  a.unmount();
  // The home app is away: the cached card is still quiet.
  mocks.set('wall2_moods', () => Promise.reject(new Error('Could not reach the service')));
  const { container } = render(<Moods />);
  await flush();
  expect(container.querySelector('.mood-btn.unsaved')).toBeTruthy();
  // It is saved in the home app; the next read draws it as a normal card that applies.
  const apply = vi.fn();
  mocks.set('wall2_moods', () => [{ id: 'stillWorking', label: 'Still Working', saved: true }, ...LIST]);
  mocks.set('wall2_apply_mood', apply);
  await flush(MOODS_REFRESH_MS);
  const first = container.querySelector('.mood-btn') as HTMLElement;
  expect(first.classList.contains('unsaved')).toBe(false);
  expect(first.querySelector('.mood-sub')?.textContent).toBe('bright and focused');
  expect(JSON.parse(localStorage.getItem(MOODS_CACHE_KEY) ?? '[]')[0]).toEqual({ id: 'stillWorking', label: 'Still Working' });
  fireEvent.click(first);
  await flush();
  expect(apply).toHaveBeenCalledWith({ id: 'stillWorking' });
});

it('"In N min" counts down while the wall stays open', async () => {
  vi.setSystemTime(new Date('2026-11-12T16:30:00-08:00'));
  const at = Date.now() + 5 * 60_000;
  mocks.set('wall2_moods', () => [{ id: 'evening', label: 'Evening', nextAtMs: at }]);
  render(<Moods />);
  await flush();
  expect(screen.getByText('In 5 min')).toBeTruthy();
  await flush(2 * 60_000);
  expect(screen.getByText('In 3 min')).toBeTruthy();
  await flush(4 * 60_000);
  expect(screen.queryByText(/^In \d+ min$/)).toBeNull();
});
