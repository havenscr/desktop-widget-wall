import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { LAST_MOOD_KEY } from '../home/Moods';
import { resetNowPlaying } from '../music/store';
import { usePacificTime } from '../ribbon/testZone';
import { Unwind } from '../screens/Unwind';
import { usePlaceStore } from '../state/places';
import { resetLastPlayed } from './lastPlayed';
import { RoomCard } from './RoomCard';
import { Tabs } from './Tabs';
import { Tomorrow } from './Tomorrow';
import { Volume, VOLUME_DEBOUNCE_MS } from './Volume';

usePacificTime();

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetLastPlayed();
  usePlaceStore.setState({ active: 'unwind', from: 'work', zenDream: false });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
});
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

it('keeps Unwind (and so the horizon camera) on Listen and on the disabled Watch tab', async () => {
  render(<Tabs />);
  await act(async () => {
    screen.getByRole('tab', { name: 'Listen' }).click();
    screen.getByRole('tab', { name: 'Watch, coming later' }).click();
  });
  expect(usePlaceStore.getState().active).toBe('unwind');
  expect(screen.getByText('Coming')).toBeTruthy();
});

it('opens Zen in Dream from the Dream tab', async () => {
  render(<Tabs />);
  await act(async () => screen.getByRole('tab', { name: 'Dream' }).click());
  expect(usePlaceStore.getState().active).toBe('zen');
  expect(usePlaceStore.getState().zenDream).toBe(true);
  expect(usePlaceStore.getState().from).toBe('unwind');
});

it('shows the first event after midnight as Tomorrow, or nothing', async () => {
  const now = () => Date.parse('2026-11-11T21:42:00-08:00');
  mocks.set('wall2_meet_day', () => ({
    events: [
      { key: 'a', title: 'Standup', start: '2026-11-11T17:00:00Z', end: '2026-11-11T17:15:00Z' },
      { key: 'b', title: 'AE sync', start: '2026-11-12T17:00:00Z', end: '2026-11-12T17:30:00Z' },
    ],
  }));
  const r = render(<Tomorrow now={now} />);
  await flush();
  expect(screen.getByText('Tomorrow')).toBeTruthy();
  expect(screen.getByText('First thing: AE sync at 9:00')).toBeTruthy();
  r.unmount();
  mocks.set('wall2_meet_day', () => ({ events: [{ key: 'a', title: 'Standup', start: '2026-11-11T17:00:00Z', end: '2026-11-11T17:15:00Z' }] }));
  const r2 = render(<Tomorrow now={now} />);
  await flush();
  expect(r2.container.textContent).toBe('');
  r2.unmount();
  mocks.set('wall2_meet_day', () => {
    throw new Error('not-configured');
  });
  const r3 = render(<Tomorrow now={now} />);
  await flush();
  expect(r3.container.textContent).toBe('');
});

it('debounces the volume at 100 ms and clamps it from 0 to 1', async () => {
  const sets: unknown[] = [];
  mocks.set('get_audio_sessions', () => ({ master: { volume: 50, muted: false }, sessions: [{ id: '1:Spotify.exe', name: 'Spotify.exe', volume: 70, muted: false }] }));
  mocks.set('set_audio_session_volume', (a) => void sets.push(a));
  render(<Volume sourceApp="Spotify" />);
  await flush();
  const slider = screen.getByLabelText('Spotify volume') as HTMLInputElement;
  expect(slider.value).toBe('0.7');
  fireEvent.change(slider, { target: { value: '0.5' } });
  fireEvent.change(slider, { target: { value: '0.4' } });
  await flush(VOLUME_DEBOUNCE_MS - 10);
  expect(sets).toEqual([]);
  await flush(20);
  expect(sets).toEqual([{ sessionName: 'Spotify.exe', level: 40 }]);
  // The browser clamps a range input; the hook clamps again whatever reaches it.
  fireEvent.change(slider, { target: { value: '1.8' } });
  await flush(VOLUME_DEBOUNCE_MS + 10);
  expect(sets[sets.length - 1]).toEqual({ sessionName: 'Spotify.exe', level: 100 });
});

it('hides the volume slider when the playing app has no audio session', async () => {
  mocks.set('get_audio_sessions', () => ({ master: { volume: 50, muted: false }, sessions: [{ id: '1:chrome.exe', name: 'chrome.exe', volume: 70, muted: false }] }));
  const r = render(<Volume sourceApp="Spotify" />);
  await flush();
  expect(r.container.textContent).toBe('');
  expect(screen.queryByRole('slider')).toBeNull();
});

it('marks the last applied mood on the room chips', async () => {
  localStorage.setItem(LAST_MOOD_KEY, 'evening');
  const applied: unknown[] = [];
  mocks.set('wall2_moods', () => [
    { id: 'evening', label: 'Evening' },
    { id: 'lateNight', label: 'Late Night' },
    { id: 'movie', label: 'Movie' },
  ]);
  mocks.set('wall2_apply_mood', (a) => void applied.push(a));
  render(<RoomCard />);
  await flush();
  expect(screen.getByRole('button', { name: 'Evening' }).getAttribute('aria-pressed')).toBe('true');
  await act(async () => screen.getByRole('button', { name: 'Late Night' }).click());
  await flush();
  expect(applied).toEqual([{ id: 'lateNight' }]);
  expect(screen.getByRole('button', { name: 'Late Night' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Evening' }).getAttribute('aria-pressed')).toBe('false');
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBe('lateNight');
});

it('shrinks the room card to one line when the home app is not set up', async () => {
  mocks.set('wall2_moods', () => {
    throw new Error('not-configured');
  });
  render(<RoomCard />);
  await flush();
  expect(screen.getByText('Home app not set up')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

it('shows the last played track with Play again when nothing plays', async () => {
  const toggle = vi.fn();
  mocks.set('get_now_playing', () => ({ title: 'Tokyo Burnout', artist: 'Tokyo Rose', source_app: 'Spotify', playback_status: 'playing' }));
  mocks.set('media_play_pause', toggle);
  const r = render(<Unwind />);
  await flush();
  expect(screen.getByText('Spotify')).toBeTruthy();
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  await flush(2100);
  expect(screen.getByText('Last played on Spotify')).toBeTruthy();
  expect(screen.getByText('Tokyo Burnout')).toBeTruthy();
  await act(async () => screen.getByRole('button', { name: 'Play again' }).click());
  expect(toggle).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(false);
  r.unmount();
});

it('lays out the status line, Screens off and the tabs', async () => {
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_omni_summary', () => ({ lanes: [{ state: 'working' }, { state: 'working' }, { state: 'review' }], yourMove: { total: 0 } }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Work is put away. 2 agents still running. Nothing needs you.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Screens off' })).toBeTruthy();
  expect(screen.getByRole('tablist', { name: 'Unwind' })).toBeTruthy();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
});
