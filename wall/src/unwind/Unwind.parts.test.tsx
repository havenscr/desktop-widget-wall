import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { LAST_MOOD_KEY } from '../home/Moods';
import { resetNowPlaying } from '../music/store';
import { usePacificTime } from '../ribbon/testZone';
import { Unwind } from '../screens/Unwind';
import { usePlaceStore } from '../state/places';
import { useFocusStore } from '../focus/store';
import { resetLastPlayed, useLastPlayed } from './lastPlayed';
import { LAST_MOOD_AT_KEY, ROOM_RETRY_MS, RoomCard } from './RoomCard';
import { Tabs } from './Tabs';
import { Tomorrow } from './Tomorrow';
import { Volume, VOLUME_DEBOUNCE_MS } from './Volume';
import { resetWatch, useWatchStore } from './watch/store';

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

it('keeps Unwind (and so the horizon camera) on Listen and Watch, and switches between them', async () => {
  resetWatch();
  render(<Tabs />);
  const watch = screen.getByRole('tab', { name: 'Watch' }) as HTMLButtonElement;
  expect(watch.disabled).toBe(false);
  expect(screen.queryByText('Coming')).toBeNull();
  expect(screen.getByRole('tab', { name: 'Listen' }).getAttribute('aria-controls')).toBe('u-panel-listen');
  expect(watch.getAttribute('aria-controls')).toBe('u-panel-watch');
  await act(async () => watch.click());
  expect(useWatchStore.getState().tab).toBe('watch');
  expect(watch.getAttribute('aria-selected')).toBe('true');
  await act(async () => screen.getByRole('tab', { name: 'Listen' }).click());
  expect(useWatchStore.getState().tab).toBe('listen');
  expect(usePlaceStore.getState().active).toBe('unwind');
});

it('has no Dream toggle: Listen and Watch only', () => {
  render(<Tabs />);
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Listen', 'Watch']);
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
  // Too old to show: the spot says so instead of leaving a hole.
  expect(r.container.textContent).toBe('TomorrowCalendar not available');
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
  render(<Volume source="Spotify" label="Spotify" />);
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
  const r = render(<Volume source="Spotify" label="Spotify" />);
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
  render(<Volume source="Spotify" label="Spotify" />);
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
  const r = render(<Volume source="Spotify" label="Spotify" />);
  await flush();
  expect(screen.getByLabelText('Spotify volume')).toBeTruthy();
  // The second read, for Chrome, does not answer yet.
  mocks.set('get_audio_sessions', () => new Promise((res) => (release = res)));
  r.rerender(<Volume source="Chrome" label="Chrome" />);
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
  const r = render(<Volume source="Spotify" label="Spotify" />);
  await flush();
  expect(r.container.textContent).toBe('');
  expect(screen.queryByRole('slider')).toBeNull();
});

it('shows the slider for the player the session id names (a packaged Spotify id finds Spotify.exe)', async () => {
  mocks.set('get_audio_sessions', () => spotify());
  render(<Volume source="SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" label="Spotify" />);
  await flush();
  expect((screen.getByLabelText('Spotify volume') as HTMLInputElement).value).toBe('0.7');
});

it('marks a mood applied on Home on the room chips', async () => {
  const { Moods } = await import('../home/Moods');
  mocks.set('wall2_moods', () => [
    { id: 'evening', label: 'Evening' },
    { id: 'lateNight', label: 'Late Night' },
  ]);
  mocks.set('wall2_apply_mood', () => undefined);
  const home = render(<Moods />);
  await flush();
  await act(async () => (home.container.querySelector('[data-mood="lateNight"]') as HTMLButtonElement).click());
  await flush();
  home.unmount();
  render(<RoomCard />);
  await flush();
  expect(screen.getByRole('button', { name: 'Late Night' }).getAttribute('aria-pressed')).toBe('true');
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
  expect(document.querySelector('.u-src')!.textContent).toBe('Spotify');
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
  expect(document.querySelector('.u-line')!.textContent).toBe('Work is put away.');
  expect(document.querySelector('.u-act')).toBeNull();
});

it('says nothing about work before the focus store has loaded', async () => {
  useFocusStore.setState({ loaded: false });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_omni_summary', () => ({ lanes: [{ state: 'working' }], yourMove: { total: 0 } }));
  render(<Unwind />);
  await flush();
  expect(document.querySelector('.u-line')!.textContent).toBe('1 agent still running. No agent needs you.');
  expect(screen.queryByText(/Work is put away/)).toBeNull();
});

it('lays out the status line, Hide screen and the tabs', async () => {
  useFocusStore.setState({ loaded: true });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_omni_summary', () => ({ lanes: [{ state: 'working' }, { state: 'working' }, { state: 'review' }], yourMove: { total: 0 } }));
  render(<Unwind />);
  await flush();
  expect(document.querySelector('.u-line')!.textContent).toBe('Work is put away. 2 agents still running. No agent needs you.');
  // Hide screen is an icon alone in the lower right corner, not beside the line.
  expect(document.querySelector('.u-corner [aria-label="Hide screen"]')).not.toBeNull();
  expect(document.querySelector('.u-foot .screens-off')).toBeNull();
  expect(screen.getByRole('tablist', { name: 'Unwind' })).toBeTruthy();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
});

it('makes the action parts of the status line chips: running switches to Work, needs you opens the waiting chat', async () => {
  useFocusStore.setState({ loaded: true });
  const opened: unknown[] = [];
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_open_session', (a) => void opened.push(a));
  mocks.set('wall2_omni_summary', () => ({
    lanes: [{ id: 'a1b2c3d4-0001', state: 'working' }, { id: 'a1b2c3d4-0002', state: 'blocked', waiting: true }, { id: 'a1b2c3d4-0003', state: 'working' }],
    yourMove: { total: 2, first: { sessionId: 'a1b2c3d4-0002' } },
    linksAvailable: true,
  }));
  render(<Unwind />);
  await flush();
  expect(document.querySelector('.u-line')!.textContent).toBe('Work is put away. 2 agents still running. 2 things need you.');
  const needs = screen.getByRole('button', { name: '2 things need you.' });
  expect(needs.className).toContain('amber');
  expect(needs.getAttribute('title')).toBe('Open the chat that is waiting for you');
  fireEvent.click(needs);
  await flush();
  expect(opened).toEqual([{ id: 'a1b2c3d4-0002' }]);
  const running = screen.getByRole('button', { name: '2 agents still running.' });
  expect(running.getAttribute('title')).toBe('Show the agents on Work');
  fireEvent.click(running);
  expect(usePlaceStore.getState().active).toBe('work');
  // "Work is put away." stays plain text.
  expect(screen.queryByRole('button', { name: 'Work is put away.' })).toBeNull();
});

it('shows the needs-you part as a chip that switches to Work when links are not available, and no chips when the data is stale', async () => {
  useFocusStore.setState({ loaded: true });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  let stale = false;
  mocks.set('wall2_omni_summary', () => ({ stale, lanes: [{ id: 'a1b2c3d4-0002', state: 'blocked', waiting: true }], yourMove: { total: 1, first: { sessionId: 'a1b2c3d4-0002' } }, linksAvailable: false }));
  const r = render(<Unwind />);
  await flush();
  expect(document.querySelector('.u-line')!.textContent).toBe('Work is put away. One thing needs you.');
  const chip = screen.getByRole('button', { name: 'One thing needs you.' });
  expect(chip.getAttribute('title')).toBe('Show the agents on Work');
  fireEvent.click(chip);
  expect(usePlaceStore.getState().active).toBe('work');
  r.unmount();
  stale = true;
  render(<Unwind />);
  await flush();
  expect(document.querySelector('.u-line')!.textContent).toBe('Work is put away.');
  expect(document.querySelector('.u-act')).toBeNull();
});

it('a read that fails after a good one drops every agent sentence, so nothing says no agent needs the owner', async () => {
  vi.useFakeTimers();
  try {
    useFocusStore.setState({ loaded: true });
    mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
    let fail = false;
    mocks.set('wall2_omni_summary', () => (fail ? Promise.reject(new Error('down')) : { lanes: [], yourMove: { total: 0 } }));
    render(<Unwind />);
    await flush();
    expect(document.querySelector('.u-line')!.textContent).toBe('Work is put away. No agent needs you.');
    fail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(document.querySelector('.u-line')!.textContent).toBe('Work is put away.');
  } finally {
    vi.useRealTimers();
  }
});

it('a waiting lane makes the line say a thing needs the owner, never No agent needs you', async () => {
  useFocusStore.setState({ loaded: true });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_omni_summary', () => ({ lanes: [{ id: 'a1b2c3d4-0009', state: 'working', waiting: true }], yourMove: { total: 0 } }));
  render(<Unwind />);
  await flush();
  expect(document.querySelector('.u-line')!.textContent).toBe('Work is put away. One thing needs you.');
});

it('falls back to the placeholder when the remembered cover on the idle view fails to decode', async () => {
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  render(<Unwind />);
  await flush();
  await act(async () => {
    useLastPlayed.setState({ last: { title: 'Glass Harbor', artist: 'Band', source: 'Spotify' }, art: 'data:image/png;base64,QUJD' });
  });
  const img = document.querySelector('.u-art img')!;
  expect(img.getAttribute('src')).toBe('data:image/png;base64,QUJD');
  await act(async () => {
    fireEvent.error(img);
  });
  expect(document.querySelector('.u-art img')).toBeNull();
  expect(document.querySelector('.u-art svg')).not.toBeNull();
});

it('Tomorrow says Calendar not available when no account can be read', async () => {
  const now = () => Date.parse('2026-11-11T21:42:00-08:00');
  mocks.set('wall2_meet_day', () => ({ events: [], accounts: [{ state: 'signed-out' }] }));
  const r = render(<Tomorrow now={now} />);
  await flush();
  expect(r.container.textContent).toBe('TomorrowCalendar not available');
});

it('the date line ends with weather unavailable (dim) when the weather cannot be fetched', async () => {
  vi.doMock('../weather/useWeather', () => ({ useWeather: () => ({ reading: null, failed: true, now: 0 }) }));
  vi.resetModules();
  const { DateLine: Fresh } = await import('./DateLine');
  const r = render(<Fresh now={() => new Date('2026-11-11T21:42:00-08:00')} />);
  expect(r.container.textContent).toMatch(/night, weather unavailable$/);
  expect(r.container.querySelector('.u-asof')).not.toBeNull();
  vi.doUnmock('../weather/useWeather');
});

it('the lights chips mark the one on now, give each a hover, and fold past six into More', async () => {
  localStorage.setItem(LAST_MOOD_KEY, 'm8');
  localStorage.setItem(LAST_MOOD_AT_KEY, JSON.stringify({ id: 'm8', at: Date.now() - 60_000 }));
  mocks.set(
    'wall2_moods',
    () => Array.from({ length: 9 }, (_, i) => ({ id: `m${i + 1}`, label: `Mood ${i + 1}`, ...(i === 0 ? { description: 'warm and low' } : {}) })),
  );
  render(<RoomCard />);
  await flush();
  // Five moods and More fill the six cells; the one that is on takes the place of the last ordinary one, never an extra cell.
  expect(document.querySelectorAll('.u-chip:not(.u-more)')).toHaveLength(5);
  expect(document.querySelectorAll('.u-chip')).toHaveLength(6);
  expect([...document.querySelectorAll('.u-chip:not(.u-more)')].map((c) => c.getAttribute('data-mood'))).toEqual(['m1', 'm2', 'm3', 'm4', 'm8']);
  expect(screen.getByRole('button', { name: 'Mood 8' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Mood 8' }).title).toContain('on now');
  expect(screen.getByRole('button', { name: 'Mood 1' }).title).toBe('Mood 1: warm and low');
  expect(screen.getByRole('button', { name: 'Mood 2' }).title).toBe('Mood 2');
  expect(screen.queryByRole('button', { name: 'Mood 9' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mood 5' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(document.querySelectorAll('.u-chip:not(.u-more)')).toHaveLength(9);
  expect(screen.getByRole('button', { name: 'Fewer' })).toBeTruthy();
});

it('marks nothing when the home feed has no mood that is on now', async () => {
  mocks.set('wall2_moods', () => [{ id: 'a', label: 'A' }]);
  render(<RoomCard />);
  await flush();
  expect(document.querySelector('.u-chip.on')).toBeNull();
  expect(document.querySelector('.u-more')).toBeNull();
});

it('the volume slider shows its number on hover and while dragging', async () => {
  mocks.set('get_audio_sessions', () => spotify(42));
  render(<Volume source="Spotify" label="Spotify" />);
  await flush();
  const wrap = document.querySelector('.u-vol') as HTMLElement;
  expect(wrap.title).toBe('Volume 42%');
  expect(document.querySelector('.u-vol-n')!.textContent).toBe('42');
  expect(wrap.className).not.toContain('drag');
  fireEvent.pointerDown(screen.getByLabelText('Spotify volume'));
  expect(wrap.className).toContain('drag');
  fireEvent.pointerUp(window);
  expect(wrap.className).not.toContain('drag');
});
