import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { LAST_MOOD_KEY } from '../home/Moods';
import { resetNowPlaying } from '../music/store';
import { usePacificTime } from '../ribbon/testZone';
import { Unwind } from '../screens/Unwind';
import { usePlaceStore } from '../state/places';
import { useFocusStore } from '../focus/store';
import { resetLastPlayed } from './lastPlayed';
import { LAST_MOOD_AT_KEY, ROOM_RETRY_MS, RoomCard } from './RoomCard';
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
  const watch = screen.getByRole('tab', { name: 'Watch, coming later' }) as HTMLButtonElement;
  expect(watch.disabled).toBe(true);
  expect(screen.getByRole('tab', { name: 'Listen' }).getAttribute('aria-controls')).toBe('u-panel-listen');
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

it('marks cached Tomorrow data "as of" after a failed refresh and hides it after 30 minutes', async () => {
  vi.setSystemTime(Date.parse('2026-11-11T21:00:00-08:00'));
  const now = () => Date.parse('2026-11-11T21:42:00-08:00');
  let fail = false;
  mocks.set('wall2_meet_day', () => {
    if (fail) throw new Error('graph-failed');
    return { events: [{ key: 'b', title: 'AE sync', start: '2026-11-12T17:00:00Z', end: '2026-11-12T17:30:00Z' }] };
  });
  const r = render(<Tomorrow now={now} />);
  await flush();
  expect(r.container.textContent).toContain('First thing: AE sync at 9:00');
  expect(r.container.textContent).not.toContain('as of');
  fail = true;
  await flush(5 * 60_000 + 10);
  expect(r.container.textContent).toContain('First thing: AE sync at 9:00 as of 9:00 PM');
  await flush(25 * 60_000);
  expect(r.container.textContent).toBe('');
  // A good read brings it back without the note.
  fail = false;
  await flush(5 * 60_000);
  expect(r.container.textContent).toBe('TomorrowFirst thing: AE sync at 9:00');
});

it('shows a first event after noon tomorrow', async () => {
  const now = () => Date.parse('2026-11-11T21:00:00-08:00');
  mocks.set('wall2_meet_day', () => ({ events: [{ key: 'c', title: 'Quarterly review', start: '2026-11-12T21:00:00Z', end: '2026-11-12T22:00:00Z' }] }));
  render(<Tomorrow now={now} />);
  await flush();
  expect(screen.getByText('First thing: Quarterly review at 1:00 PM')).toBeTruthy();
});

const spotify = (volume = 70) => ({ master: { volume: 50, muted: false }, sessions: [{ id: '1:Spotify.exe', name: 'Spotify.exe', volume, muted: false }] });

it('sends the volume at most every 100 ms while dragging, always ending on the last value, clamped 0 to 1', async () => {
  const sets: unknown[] = [];
  mocks.set('get_audio_sessions', () => spotify());
  mocks.set('set_audio_session_volume', (a) => void sets.push(a));
  render(<Volume sourceApp="Spotify" />);
  await flush();
  const slider = screen.getByLabelText('Spotify volume') as HTMLInputElement;
  expect(slider.value).toBe('0.7');
  fireEvent.change(slider, { target: { value: '0.5' } }); // sent at once
  fireEvent.change(slider, { target: { value: '0.45' } });
  fireEvent.change(slider, { target: { value: '0.4' } });
  expect(sets).toEqual([{ sessionName: 'Spotify.exe', level: 50 }]);
  await flush(VOLUME_DEBOUNCE_MS - 10);
  expect(sets.length).toBe(1);
  await flush(20);
  expect(sets).toEqual([
    { sessionName: 'Spotify.exe', level: 50 },
    { sessionName: 'Spotify.exe', level: 40 },
  ]);
  // The browser clamps a range input; the hook clamps again whatever reaches it.
  fireEvent.change(slider, { target: { value: '1.8' } });
  await flush(VOLUME_DEBOUNCE_MS + 10);
  expect(sets[sets.length - 1]).toEqual({ sessionName: 'Spotify.exe', level: 100 });
});

it('sends the pending move on unmount instead of dropping it', async () => {
  const sets: unknown[] = [];
  mocks.set('get_audio_sessions', () => spotify());
  mocks.set('set_audio_session_volume', (a) => void sets.push(a));
  const r = render(<Volume sourceApp="Spotify" />);
  await flush();
  const slider = screen.getByLabelText('Spotify volume');
  fireEvent.change(slider, { target: { value: '0.5' } });
  fireEvent.change(slider, { target: { value: '0.3' } });
  r.unmount();
  expect(sets).toEqual([
    { sessionName: 'Spotify.exe', level: 50 },
    { sessionName: 'Spotify.exe', level: 30 },
  ]);
});

it('drops the unsent move and hides the slider when the session goes away mid-drag', async () => {
  const sets: unknown[] = [];
  let gone = false;
  mocks.set('get_audio_sessions', () => (gone ? { master: { volume: 50, muted: false }, sessions: [] } : spotify()));
  mocks.set('set_audio_session_volume', (a) => void sets.push(a));
  render(<Volume sourceApp="Spotify" />);
  await flush();
  const slider = screen.getByLabelText('Spotify volume');
  fireEvent.change(slider, { target: { value: '0.5' } });
  // The next poll (3 s) is due; a move is still pending when it answers with no session.
  await flush(3000 - 50);
  fireEvent.change(slider, { target: { value: '0.2' } });
  fireEvent.change(slider, { target: { value: '0.1' } });
  gone = true;
  await flush(60);
  expect(screen.queryByLabelText('Spotify volume')).toBeNull();
  await flush(500);
  expect(sets).toEqual([
    { sessionName: 'Spotify.exe', level: 50 },
    { sessionName: 'Spotify.exe', level: 20 },
  ]);
});

it('never moves the previous app: a source change hides the slider until the new read answers', async () => {
  const sets: unknown[] = [];
  let release: ((v: unknown) => void) | null = null;
  mocks.set('get_audio_sessions', () => spotify());
  mocks.set('set_audio_session_volume', (a) => void sets.push(a));
  const r = render(<Volume sourceApp="Spotify" />);
  await flush();
  expect(screen.getByLabelText('Spotify volume')).toBeTruthy();
  // The second read, for Chrome, does not answer yet.
  mocks.set('get_audio_sessions', () => new Promise((res) => (release = res)));
  r.rerender(<Volume sourceApp="Chrome" />);
  await flush();
  expect(screen.queryByRole('slider')).toBeNull();
  expect(sets).toEqual([]);
  await act(async () => {
    release?.({ master: { volume: 50, muted: false }, sessions: [{ id: '2:chrome.exe', name: 'chrome.exe', volume: 40, muted: false }] });
  });
  const chrome = screen.getByLabelText('Chrome volume') as HTMLInputElement;
  expect(chrome.value).toBe('0.4');
  fireEvent.change(chrome, { target: { value: '0.6' } });
  expect(sets).toEqual([{ sessionName: 'chrome.exe', level: 60 }]);
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
  localStorage.setItem(LAST_MOOD_AT_KEY, JSON.stringify({ id: 'evening', at: Date.now() - 60_000 }));
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

it('drops the mood mark three hours after it was applied, and ignores a mark without a time', async () => {
  vi.setSystemTime(Date.parse('2026-11-11T19:00:00-08:00'));
  mocks.set('wall2_moods', () => [
    { id: 'evening', label: 'Evening' },
    { id: 'lateNight', label: 'Late Night' },
  ]);
  mocks.set('wall2_apply_mood', () => undefined);
  // Home's plain mark alone (no time beside it) marks nothing here.
  localStorage.setItem(LAST_MOOD_KEY, 'evening');
  render(<RoomCard />);
  await flush();
  expect(screen.getByRole('button', { name: 'Evening' }).getAttribute('aria-pressed')).toBe('false');
  await act(async () => screen.getByRole('button', { name: 'Late Night' }).click());
  await flush();
  expect(screen.getByRole('button', { name: 'Late Night' }).getAttribute('aria-pressed')).toBe('true');
  expect(JSON.parse(localStorage.getItem(LAST_MOOD_AT_KEY)!).id).toBe('lateNight');
  await flush(3 * 3_600_000 - 60_000);
  expect(screen.getByRole('button', { name: 'Late Night' }).getAttribute('aria-pressed')).toBe('true');
  await flush(120_000);
  expect(screen.getByRole('button', { name: 'Late Night' }).getAttribute('aria-pressed')).toBe('false');
  // The shared key keeps its plain id format for Home.
  expect(localStorage.getItem(LAST_MOOD_KEY)).toBe('lateNight');
});

it('reads the moods again after 30 seconds while the home app is not reachable', async () => {
  let fail = true;
  mocks.set('wall2_moods', () => {
    if (fail) throw new Error('timed out');
    return [{ id: 'evening', label: 'Evening' }];
  });
  render(<RoomCard />);
  await flush();
  expect(screen.getByText('Home app not reachable')).toBeTruthy();
  fail = false;
  await flush(ROOM_RETRY_MS + 10);
  expect(screen.getByRole('button', { name: 'Evening' })).toBeTruthy();
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

it('says "Open Spotify to play again" when the last track has no media session', async () => {
  resetLastPlayed({ title: 'Tokyo Burnout', artist: 'Tokyo Rose', source: 'Spotify' });
  mocks.set('get_now_playing', () => ({ playback_status: 'unknown' }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Tokyo Burnout')).toBeTruthy();
  expect(screen.getByText('Open Spotify to play again')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull();
  expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(true);
});

it('drops the agent sentences when the helper says its data is stale', async () => {
  useFocusStore.setState({ loaded: true });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_omni_summary', () => ({ stale: true, lanes: [{ state: 'working' }], yourMove: { total: 0 } }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Work is put away.')).toBeTruthy();
  expect(screen.queryByText(/agent/)).toBeNull();
});

it('says nothing about work before the focus store has loaded', async () => {
  useFocusStore.setState({ loaded: false });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_omni_summary', () => ({ lanes: [{ state: 'working' }], yourMove: { total: 0 } }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('1 agent still running. Nothing needs you.')).toBeTruthy();
  expect(screen.queryByText(/Work is put away/)).toBeNull();
});

it('lays out the status line, Screens off and the tabs', async () => {
  useFocusStore.setState({ loaded: true });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_omni_summary', () => ({ lanes: [{ state: 'working' }, { state: 'working' }, { state: 'review' }], yourMove: { total: 0 } }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Work is put away. 2 agents still running. Nothing needs you.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Screens off' })).toBeTruthy();
  expect(screen.getByRole('tablist', { name: 'Unwind' })).toBeTruthy();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
});
