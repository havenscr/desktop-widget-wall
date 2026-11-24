import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from '../music/store';
import { usePacificTime } from '../ribbon/testZone';
import { Unwind } from '../screens/Unwind';
import { usePlaceStore } from '../state/places';
import { LAST_OWN_KEY, loadLastOwn, readLastOwn } from './lastOwn';
import { resetLastPlayed, useLastPlayed } from './lastPlayed';
import { isWallPlayer, shownSource } from './ownSource';
import { useSpotifySeen } from './spotifySource';
import { saveSaved } from './watch/saved';
import { resetWatch, useWatchStore } from './watch/store';

usePacificTime();

const ITEM = { kind: 'video' as const, id: 'abcdefghijk', label: 'Night drive mix' };
const own = (from: 'watch' | 'music' | 'own' = 'watch') => ({ ...ITEM, from });

const { play: realPlay, playMusic: realPlayMusic } = useWatchStore.getState();

beforeEach(() => {
  useWatchStore.setState({ play: realPlay, playMusic: realPlayMusic });
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  resetLastPlayed();
  useSpotifySeen.setState({ seen: null });
  usePlaceStore.setState({ active: 'unwind', from: 'work', zenDream: false });
  mocks.set('get_now_playing', () => ({ playback_status: 'unknown' }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
});
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
const record = (source: string) => ({ title: 'Night drive mix', artist: 'Some Channel', source });

it('names the web view in no case or form', () => {
  for (const n of ['msedgewebview2', 'MSEDGEWEBVIEW2', 'MsEdgeWebView2.exe']) {
    expect(isWallPlayer(n)).toBe(true);
    expect(shownSource(n).toLowerCase()).not.toContain('webview');
  }
  expect(shownSource('Spotify')).toBe('Spotify');
  expect(isWallPlayer('msedge')).toBe(false);
});

it('own video known: says "on the wall" and Play starts that item through the Watch play path', async () => {
  useWatchStore.setState({ saved: [ITEM] });
  resetLastPlayed(record('msedgewebview2'), own('watch'));
  const play = vi.spyOn(useWatchStore.getState(), 'play').mockImplementation(() => {});
  useWatchStore.setState({ play });
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on the wall')).toBeTruthy();
  expect(document.body.textContent?.toLowerCase()).not.toContain('msedgewebview2');
  expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(false);
  await act(async () => screen.getByLabelText('Play').click());
  expect(play).toHaveBeenCalledWith({ kind: 'video', id: 'abcdefghijk' });
  await act(async () => screen.getByRole('button', { name: 'Play again' }).click());
  expect(play).toHaveBeenCalledTimes(2);
  expect((screen.getByLabelText('Previous') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Next') as HTMLButtonElement).disabled).toBe(true);
});

it('a library pick is started again with the music play path', async () => {
  resetLastPlayed(record('MSEDGEWEBVIEW2'), own('music'));
  const playMusic = vi.fn(() => true);
  useWatchStore.setState({ playMusic });
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on the wall')).toBeTruthy();
  await act(async () => screen.getByLabelText('Play').click());
  expect(playMusic).toHaveBeenCalledWith('abcdefghijk', 'Night drive mix');
});

it('own video unknown: same eyebrow, no dead Play, and the line says to pick it in Watch', async () => {
  resetLastPlayed(record('MsEdgeWebView2.exe'), null);
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on the wall')).toBeTruthy();
  expect(screen.getByText('Pick it in Watch to play again')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull();
  expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.textContent?.toLowerCase()).not.toContain('webview');
});

it('a Watch item that is no longer saved counts as unknown', async () => {
  resetLastPlayed(record('msedgewebview2'), own('watch'));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Pick it in Watch to play again')).toBeTruthy();
});

it('an outside app is unchanged', async () => {
  resetLastPlayed({ title: 'Tokyo Burnout', artist: 'Tokyo Rose', source: 'Spotify' }, own('watch'));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on Spotify')).toBeTruthy();
  expect(screen.getByText('Open Spotify to play again')).toBeTruthy();
});

it('a restart: the record is read back from storage and Play works', async () => {
  saveSaved([ITEM]);
  useWatchStore.setState({ saved: [ITEM] });
  useWatchStore.getState().play({ kind: 'video', id: ITEM.id });
  expect(JSON.parse(localStorage.getItem(LAST_OWN_KEY) ?? 'null')).toEqual({ ...ITEM, from: 'watch' });
  // The app restarts: memory is gone, storage stays.
  useWatchStore.getState().stop();
  resetWatch();
  useLastPlayed.setState({ own: loadLastOwn(), last: record('msedgewebview2') });
  expect(useLastPlayed.getState().own).toEqual({ ...ITEM, from: 'watch' });
  render(<Unwind />);
  await flush();
  await act(async () => screen.getByLabelText('Play').click());
  expect(useWatchStore.getState().playing?.id).toBe(ITEM.id);
  expect(useWatchStore.getState().tab).toBe('watch');
});

it('keeps only kind, id, label and path, and refuses bad stored records', () => {
  expect(readLastOwn(JSON.stringify({ ...ITEM, from: 'music', extra: 'x' }))).toEqual({ ...ITEM, from: 'music' });
  expect(readLastOwn('{"kind":"video","id":"short","label":"x","from":"watch"}')).toBeNull();
  expect(readLastOwn('{"kind":"own","id":"abcdefghijkl","label":"x","from":"watch"}')).toBeNull();
  expect(readLastOwn(JSON.stringify({ ...ITEM, from: 'elsewhere' }))).toBeNull();
  expect(readLastOwn('not json')).toBeNull();
  expect(readLastOwn(null)).toBeNull();
});

const RAW = 'com-example-radio7f3a2';
const noRaw = () => {
  const words = [document.body.textContent ?? '', ...[...document.querySelectorAll('[aria-label], [title]')].map((e) => `${e.getAttribute('aria-label')} ${e.getAttribute('title')}`)].join(' ');
  expect(words.toLowerCase()).not.toContain('com-example');
};

it('a raw app id never shows as the eyebrow while it plays', async () => {
  mocks.set('get_now_playing', () => ({ title: 'Harbor Radio', artist: 'Example Host', source_app: RAW.toUpperCase(), source_app_id: RAW.toUpperCase(), playback_status: 'playing' }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('an app on this PC')).toBeTruthy();
  noRaw();
});

it('a raw app id never shows in the at-rest eyebrow or line', async () => {
  resetLastPlayed({ title: 'Harbor Radio', artist: 'Example Host', source: RAW }, null);
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on an app on this PC')).toBeTruthy();
  expect(screen.getByText('Open an app on this PC to play again')).toBeTruthy();
  noRaw();
});

it('a stopped session under a raw id shows the neutral words too', async () => {
  mocks.set('get_now_playing', () => ({ title: 'Harbor Radio', artist: 'Example Host', source_app_id: RAW, playback_status: 'stopped' }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on an app on this PC')).toBeTruthy();
  noRaw();
});

const SPOTIFY_TRACK = { id: 'abc', name: 'Harbor Radio', artists: 'Example Host', album: '', durationMs: 1000, imageUrl: null, thumbUrl: null, playable: true };

it('a web app id shows Spotify while Spotify itself says it plays that song', async () => {
  mocks.set('get_now_playing', () => ({ title: 'Harbor Radio', artist: 'Example Host', source_app_id: RAW, playback_status: 'playing' }));
  mocks.set('wall2_spotify_playback', () => ({ playing: true, device: null, track: SPOTIFY_TRACK, progressMs: 0, shuffle: false }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Spotify', { selector: '.u-k' })).toBeTruthy();
  noRaw();
});

it('the at-rest eyebrow says Spotify for a song Spotify confirmed, and stays neutral when it cannot', async () => {
  useSpotifySeen.setState({ seen: { title: 'Harbor Radio', artist: 'Example Host' } });
  resetLastPlayed({ title: 'Harbor Radio', artist: 'Example Host', source: RAW }, null);
  const shown = render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on Spotify')).toBeTruthy();
  shown.unmount();
  useSpotifySeen.setState({ seen: null });
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on an app on this PC')).toBeTruthy();
});

it('another song or no answer from Spotify keeps the neutral words', async () => {
  mocks.set('get_now_playing', () => ({ title: 'Other Song', artist: 'Example Host', source_app_id: RAW, playback_status: 'playing' }));
  mocks.set('wall2_spotify_playback', () => ({ playing: true, device: null, track: SPOTIFY_TRACK, progressMs: 0, shuffle: false }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('an app on this PC')).toBeTruthy();
});

it('shows a known player by its name and anything else by the neutral words', () => {
  expect(shownSource('Spotify')).toBe('Spotify');
  expect(shownSource('spotify')).toBe('spotify');
  expect(shownSource(RAW)).toBe('an app on this PC');
  expect(shownSource('Some Unknown Thing')).toBe('an app on this PC');
  expect(shownSource('')).toBe('');
  expect(shownSource(null)).toBeNull();
});

const WEBVIEW_STOPPED = () => ({ title: 'Night drive mix - YouTube', artist: 'Some Channel', source_app_id: 'msedgewebview2', playback_status: 'stopped' });

it('after a restart a stopped web view session with a title and empty stores is the wall item: Play starts the saved item', async () => {
  useWatchStore.setState({ saved: [ITEM] });
  resetLastPlayed(null, own('watch'));
  mocks.set('get_now_playing', WEBVIEW_STOPPED);
  const key = vi.fn(() => null);
  mocks.set('media_play_pause', key);
  const play = vi.fn();
  useWatchStore.setState({ play });
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Last played on the wall')).toBeTruthy();
  expect(document.body.textContent?.toLowerCase()).not.toContain('webview');
  await act(async () => screen.getByLabelText('Play').click());
  expect(play).toHaveBeenCalledWith({ kind: 'video', id: 'abcdefghijk' });
  expect(key).not.toHaveBeenCalled();
});

it('the same session with a title that is not the saved item is not the wall item', async () => {
  useWatchStore.setState({ saved: [ITEM] });
  resetLastPlayed(null, own('watch'));
  mocks.set('get_now_playing', () => ({ ...WEBVIEW_STOPPED(), title: 'Some other sound' }));
  const play = vi.fn();
  useWatchStore.setState({ play });
  render(<Unwind />);
  await flush();
  expect(screen.queryByText('Last played on the wall')).toBeNull();
  expect(document.body.textContent?.toLowerCase()).not.toContain('webview');
  expect(play).not.toHaveBeenCalled();
});

it('a sound the web view made that is not the item: the card shows the saved item, and Play starts that one', async () => {
  useWatchStore.setState({ saved: [ITEM] });
  resetLastPlayed({ title: 'Alert chime', artist: '', source: 'msedgewebview2' }, own('watch'));
  const play = vi.fn();
  useWatchStore.setState({ play });
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Night drive mix')).toBeTruthy();
  expect(screen.queryByText('Alert chime')).toBeNull();
  await act(async () => screen.getByLabelText('Play').click());
  expect(play).toHaveBeenCalledWith({ kind: 'video', id: 'abcdefghijk' });
});

it('closed after a newer item began: the card shows the saved newer item, never one title with another id', async () => {
  useWatchStore.setState({ saved: [ITEM] });
  resetLastPlayed({ title: 'Earlier video', artist: 'Old Channel', source: 'msedgewebview2' }, own('watch'));
  const play = vi.fn();
  useWatchStore.setState({ play });
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Night drive mix')).toBeTruthy();
  expect(screen.queryByText('Earlier video')).toBeNull();
  expect(screen.queryByText('Old Channel')).toBeNull();
  await act(async () => screen.getByLabelText('Play').click());
  expect(play).toHaveBeenCalledWith({ kind: 'video', id: 'abcdefghijk' });
});

it('a play path that refuses falls to the unknown state', async () => {
  resetLastPlayed(record('msedgewebview2'), own('music'));
  const playMusic = vi.fn(() => false);
  useWatchStore.setState({ playMusic });
  render(<Unwind />);
  await flush();
  await act(async () => screen.getByLabelText('Play').click());
  expect(playMusic).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Pick it in Watch to play again')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull();
  expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(true);
});

it('previous and next stay off in the wall own state, known or not', async () => {
  useWatchStore.setState({ saved: [ITEM] });
  resetLastPlayed(record('msedgewebview2'), own('watch'));
  const { unmount } = render(<Unwind />);
  await flush();
  expect((screen.getByLabelText('Previous') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Next') as HTMLButtonElement).disabled).toBe(true);
  unmount();
  resetLastPlayed(record('msedgewebview2'), null);
  render(<Unwind />);
  await flush();
  expect((screen.getByLabelText('Previous') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Next') as HTMLButtonElement).disabled).toBe(true);
});
