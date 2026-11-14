import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlaceStore } from '../state/places';
import { playerLink } from '../unwind/watch/PlayerFrame';
import { SAVED_KEY } from '../unwind/watch/saved';
import { NO_REPORT, resetWatch, useWatchStore } from '../unwind/watch/store';
import { WatchStageLayer } from '../unwind/watch/StageLayer';
import { timeOf, wallVideoControls, wallVideoView } from './wallVideo';

const V = 'Ab3dEfGh1jK';
const LIST = 'PLmockPlaylist0001';
const item = (kind: 'video' | 'live' | 'playlist' | 'twitch', label = 'Night drive mix') => ({ kind, id: kind === 'playlist' ? LIST : kind === 'twitch' ? 'pixel_harbor' : V, label });
const snap = (over: Partial<Parameters<typeof wallVideoView>[0]> = {}) => ({ playing: item('video'), paused: false, needsClick: false, report: NO_REPORT, ...over });

it('is nothing when nothing plays or the video has ended', () => {
  expect(wallVideoView(snap({ playing: null }))).toBeNull();
  expect(wallVideoView(snap({ report: { ...NO_REPORT, ended: true } }))).toBeNull();
});

it('names a video, a live stream, a playlist and a Twitch stream in plain words', () => {
  expect(wallVideoView(snap())).toMatchObject({ title: 'Night drive mix', sub: 'YouTube video', shortSub: 'Video', youtube: true, list: null, time: null });
  expect(wallVideoView(snap({ playing: item('live', 'Radio') }))).toMatchObject({ sub: 'YouTube live stream', shortSub: 'Live stream' });
  expect(wallVideoView(snap({ playing: item('twitch', 'pixel_harbor') }))).toMatchObject({ sub: 'Twitch stream', youtube: false, time: null });
  const pl = wallVideoView(snap({ playing: item('playlist'), report: { ...NO_REPORT, count: 24, index: 3 } }))!;
  expect(pl).toMatchObject({ sub: 'YouTube playlist, 4 of 24', shortSub: 'Playlist, 4 of 24', list: { index: 3, count: 24 } });
  // A playlist the player reports with one item (or none yet) has no list controls and no place.
  expect(wallVideoView(snap({ playing: item('playlist'), report: { ...NO_REPORT, count: 1, index: 0 } }))).toMatchObject({ sub: 'YouTube playlist', list: null });
  expect(wallVideoView(snap({ playing: item('playlist') }))).toMatchObject({ sub: 'YouTube playlist', list: null });
  // A single video never has a list, whatever the player says.
  expect(wallVideoView(snap({ report: { ...NO_REPORT, count: 24, index: 3 } }))?.list).toBeNull();
});

it('carries the time only when the player reports a length', () => {
  const t = (time: number | null, duration: number | null) => wallVideoView(snap({ report: { ...NO_REPORT, started: true, time, duration } }))?.time;
  expect(t(754, 2710)).toEqual({ pos: 754, dur: 2710 });
  expect(t(5000, 2710)).toEqual({ pos: 2710, dur: 2710 });
  expect(t(5, 0)).toBeNull();
  expect(t(null, 2710)).toBeNull();
  expect(t(754, null)).toBeNull();
  expect(timeOf(754, 2710)).toBe('12:34 of 45:10');
});

it('carries paused and the click wait as the store has them', () => {
  expect(wallVideoView(snap({ paused: true, needsClick: true }))).toMatchObject({ paused: true, needsClick: true });
});

// The proof the brief asks for: while Home is the place, the Watch frame is still mounted (the same element, never
// reloaded), and it still takes the wall's messages, so Home's controls reach it without a second player.
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SAVED_KEY, JSON.stringify([item('video'), item('playlist', 'Slow synth evenings')]));
  resetWatch();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
});
afterEach(() => {
  cleanup();
  playerLink.send = () => false;
  vi.restoreAllMocks();
});

it('keeps the Watch frame mounted and answering while Home shows', async () => {
  const st = useWatchStore.getState();
  st.setTab('watch');
  st.play({ kind: 'playlist', id: LIST });
  const { container } = render(<WatchStageLayer />);
  await act(async () => {});
  const frame = document.querySelector('iframe') as HTMLIFrameElement;
  expect(frame).not.toBeNull();
  const posted: string[] = [];
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((msg: unknown) => {
    posted.push(String(msg));
  }) as typeof window.postMessage);
  await act(async () => {
    frame.dispatchEvent(new Event('load'));
  });
  expect(container.querySelector('.w-layer')?.getAttribute('data-shown')).toBe('true');

  // Go to Home: the stage is parked (out of sight), the frame is the same element and still loaded.
  await act(async () => {
    usePlaceStore.getState().setActive('home');
  });
  expect(container.querySelector('.w-layer')?.getAttribute('data-shown')).toBe('false');
  expect(document.querySelector('iframe')).toBe(frame);
  posted.length = 0;

  // The wall's own controls, as Home calls them, reach it.
  expect(wallVideoControls.next()).toBe(true);
  expect(wallVideoControls.previous()).toBe(true);
  expect(posted.some((m) => m.includes('nextVideo'))).toBe(true);
  expect(posted.some((m) => m.includes('previousVideo'))).toBe(true);
  posted.length = 0;
  await act(async () => {
    wallVideoControls.togglePause();
  });
  expect(useWatchStore.getState().paused).toBe(true);
  expect(posted.some((m) => m.includes('pauseVideo'))).toBe(true);
  posted.length = 0;
  await act(async () => {
    wallVideoControls.togglePause();
  });
  expect(posted.some((m) => m.includes('playVideo'))).toBe(true);

  // Going on to Work and back to Home never replaces the frame.
  for (const place of ['work', 'home', 'meet', 'home'] as const) {
    await act(async () => {
      usePlaceStore.getState().setActive(place);
    });
    expect(document.querySelector('iframe')).toBe(frame);
  }
  expect(wallVideoControls.next()).toBe(true);

  // Open Watch brings the stage back into sight, still the same frame.
  await act(async () => {
    wallVideoControls.openWatch();
  });
  expect(usePlaceStore.getState().active).toBe('unwind');
  expect(container.querySelector('.w-layer')?.getAttribute('data-shown')).toBe('true');
  expect(document.querySelector('iframe')).toBe(frame);

  // Stop removes the frame, and the controls then say the frame did not take the message.
  await act(async () => {
    wallVideoControls.stop();
  });
  expect(document.querySelector('iframe')).toBeNull();
  expect(wallVideoControls.next()).toBe(false);
});

it('says the frame did not take a message when none is loaded (the controls then stop)', () => {
  playerLink.send = () => false;
  expect(wallVideoControls.next()).toBe(false);
  expect(wallVideoControls.previous()).toBe(false);
});
