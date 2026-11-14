import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { useSkyStore } from '../../horizon/sky';
import { resetNowPlaying } from '../../music/store';
import { UnwindView } from './testView';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { driveInMode } from './DriveInFrame';
import { LOOKS_KEY } from './looks';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { MARQUEE_NAME, MARQUEE_PAUSED, MARQUEE_PLAYING } from './towerFrame';

// The drive-in's marquee tells the truth about the player: NOW SHOWING only once the player reports
// the picture playing, INTERMISSION only for a real pause, the name alone while it loads, while a
// refused autoplay waits for a click, and after it ended.
const V = 'Ab3dEfGh1jK';
const THREE = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const words = () =>
  [...document.querySelectorAll('svg.w-tower text.w-mq')].filter((t) => t.getAttribute('data-on') === '1').map((t) => t.textContent);
const mode = () => document.querySelector('svg.w-tower')?.getAttribute('data-marquee');
const store = () => useWatchStore.getState();

async function start(item: 0 | 1 = 0) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(THREE));
  localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: 'drivein' }));
  resetWatch();
  store().setTab('watch');
  store().play(item === 0 ? { kind: 'video', id: V } : { kind: 'twitch', id: 'pixel_harbor' });
  render(<UnwindView />);
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  useSkyStore.setState({ claims: {} });
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
});

describe('driveInMode', () => {
  const base = { paused: false, started: true, needsClick: false, clickHint: false, ended: false, reports: true };
  it('plays only once the player reports it, pauses only for a real pause, and otherwise waits', () => {
    expect(driveInMode(base)).toBe('playing');
    expect(driveInMode({ ...base, started: false })).toBe('waiting');
    expect(driveInMode({ ...base, started: false, needsClick: true })).toBe('waiting');
    expect(driveInMode({ ...base, paused: true })).toBe('paused');
    expect(driveInMode({ ...base, ended: true })).toBe('waiting');
    expect(driveInMode({ ...base, needsClick: true, paused: true })).toBe('waiting');
    // Twitch never reports: playing unless a click is waited for.
    expect(driveInMode({ ...base, started: false, reports: false })).toBe('playing');
    expect(driveInMode({ ...base, started: false, reports: false, clickHint: true })).toBe('waiting');
  });
});

describe('the marquee on the wall', () => {
  it('shows the name alone while the video loads, NOW SHOWING once it plays, INTERMISSION only when paused', async () => {
    await start();
    expect(mode()).toBe('waiting');
    expect(words()).toEqual([MARQUEE_NAME]);
    await act(async () => store().setReport({ started: true }));
    expect(mode()).toBe('playing');
    expect(words()).toEqual([MARQUEE_PLAYING]);
    await act(async () => store().setPaused(true));
    expect(mode()).toBe('paused');
    expect(words()).toEqual([MARQUEE_PAUSED]);
    await act(async () => store().setPaused(false));
    expect(words()).toEqual([MARQUEE_PLAYING]);
  });

  it('shows the name alone while a refused autoplay waits for a click, and NOW SHOWING after the click starts it', async () => {
    await start();
    await act(async () => store().setNeedsClick(true));
    expect(screen.getByText('Click the video to start')).toBeTruthy();
    expect(words()).toEqual([MARQUEE_NAME]);
    await act(async () => {
      store().setNeedsClick(false);
      store().setReport({ started: true });
    });
    expect(words()).toEqual([MARQUEE_PLAYING]);
  });

  it('shows the name alone once it ended', async () => {
    await start();
    await act(async () => store().setReport({ started: true }));
    await act(async () => store().setReport({ ended: true }));
    expect(words()).toEqual([MARQUEE_NAME]);
  });

  it('is not changed by the notice that the browser could not open: it says nothing about the picture', async () => {
    mocks.set('wall2_watch_open', () => {
      throw new Error('no browser');
    });
    await start();
    // While loading the notice leaves the name alone; while playing it leaves NOW SHOWING.
    await act(async () => (document.querySelector('.w-open') as HTMLElement).click());
    await flush();
    expect(screen.getByText('Could not open the browser')).toBeTruthy();
    expect(words()).toEqual([MARQUEE_NAME]);
    await act(async () => store().setReport({ started: true }));
    expect(screen.getByText('Could not open the browser')).toBeTruthy();
    expect(words()).toEqual([MARQUEE_PLAYING]);
  });

  it('counts a Twitch stream as showing (it never reports) until a click is waited for', async () => {
    await start(1);
    expect(words()).toEqual([MARQUEE_PLAYING]);
    await act(async () => store().setClickHint(true));
    expect(words()).toEqual([MARQUEE_NAME]);
  });
});
