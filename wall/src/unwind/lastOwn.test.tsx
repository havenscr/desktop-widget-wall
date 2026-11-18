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

it('shows a known player by its name and anything else by the neutral words', () => {
  expect(shownSource('Spotify')).toBe('Spotify');
  expect(shownSource('spotify')).toBe('spotify');
  expect(shownSource(RAW)).toBe('an app on this PC');
  expect(shownSource('Some Unknown Thing')).toBe('an app on this PC');
  expect(shownSource('')).toBe('');
  expect(shownSource(null)).toBeNull();
});
