import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { LOAD_GAP_MS, resetQueue, useYtQueue } from '../ytmusic/queue';
import { OWN_KEY, resetOwnLists } from './ownLists';
import { playOwn, resetOwnPlay, useOwnPlay } from './ownPlay';
import { framePoster } from './PlayerFrame';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';
import { YOUTUBE_EMBED_ORIGIN } from './urls';

// Integrated: the real player frame hears the real messages; only the frame's window is a stand-in (no request leaves the test).
vi.setConfig({ testTimeout: 20_000 });

const FRIDAY = 'fridaywind01';
const V = (n: number) => `mockvideo${String(n).padStart(2, '0')}`;
const pauseMsg = JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] });
const w = () => useWatchStore.getState();

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
function send(win: Window | null, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin: YOUTUBE_EMBED_ORIGIN, data: JSON.stringify(data), source: win }));
  });
}
/** The frame now in the page: loaded, its window's posts recorded. */
function frame() {
  const el = document.querySelector('iframe')!;
  const win = el.contentWindow!;
  const post = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  act(() => void fireEvent.load(el));
  return { el, win, post };
}
const playingMsg = { event: 'infoDelivery', info: { playerState: 1, currentTime: 190, duration: 200 } };
const endMsg = { event: 'infoDelivery', info: { playerState: 0, currentTime: 199, duration: 200 } };

function seed(videos: number, repeat = false) {
  const items = Array.from({ length: videos }, (_, i) => ({ id: V(i + 1), title: `Video ${i + 1}`, channel: 'Channel', seconds: 200 }));
  localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'own', id: FRIDAY, label: 'Friday wind down' }]));
  localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: { [FRIDAY]: { items, shuffle: false, repeat } } }));
  resetWatch();
  resetOwnLists();
  resetOwnPlay();
  resetQueue();
  w().setTab('watch');
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => null);
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  resetOwnPlay();
  resetQueue();
  localStorage.clear();
  framePoster.render = null;
});

describe('an own playlist through the real player frame', () => {
  it('plays its first video in the one frame, and the frame never gets the playlist\'s own id', async () => {
    seed(3);
    render(<UnwindView />);
    act(() => void playOwn(FRIDAY));
    await flush();
    const src = document.querySelector('iframe')!.getAttribute('src')!;
    expect(src).toContain(`/embed/${V(1)}?`);
    expect(src).not.toContain(FRIDAY);
    expect(w().source).toBe('own');
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('draws the video icon on Listen for the current video, matched on its title and not the playlist name', async () => {
    seed(2);
    mocks.set('get_now_playing', () => ({ title: 'Rooftop synth session', artist: 'Channel', playback_status: 'playing', source_app: 'msedgewebview2', source_app_id: 'msedgewebview2.exe', position_seconds: 5, duration_seconds: 200 }));
    render(<UnwindView />);
    act(() => void playOwn(FRIDAY));
    act(() => w().setReport({ ...w().report, title: 'Rooftop synth session' }));
    act(() => w().setTab('listen'));
    await flush(2000);
    expect(screen.getByRole('button', { name: 'Watch the video' }).closest('.u-art')).not.toBeNull();
  });

  it('the real end message advances to the next video, playing, with nothing of the old frame in its report', async () => {
    seed(3);
    render(<UnwindView />);
    act(() => void playOwn(FRIDAY));
    await flush();
    const first = frame();
    send(first.win, playingMsg);
    await flush(LOAD_GAP_MS + 500);
    send(first.win, endMsg);
    // The next load follows the end at once (a second has passed since the last).
    expect(w().playing?.id).toBe(V(2));
    expect(w().paused).toBe(false);
    expect(w().report.time ?? 0).not.toBe(199);
    expect(w().report.duration ?? 0).not.toBe(200);
    expect(w().report.ended).toBe(false);
    await flush(0);
    const el2 = document.querySelector('iframe')!;
    expect(el2).not.toBe(first.el);
    expect(el2.getAttribute('src')).toContain(`/embed/${V(2)}?`);
    const second = frame();
    send(second.win, { event: 'onReady' });
    send(second.win, { event: 'infoDelivery', info: { playerState: 1, currentTime: 1, duration: 180 } });
    // Nothing asks the new frame to pause.
    expect(second.post.mock.calls.some((c) => c[0] === pauseMsg)).toBe(false);
    expect(w().paused).toBe(false);
    expect(useOwnPlay.getState().pos).toBe(1);
  });

  it('an error 150 skips the video with its note and greys it', async () => {
    seed(3);
    render(<UnwindView />);
    act(() => void playOwn(FRIDAY));
    await flush();
    const first = frame();
    await flush(LOAD_GAP_MS + 100);
    send(first.win, { event: 'onError', info: 150 });
    expect(useYtQueue.getState().failed.get(V(1))).toBe('embed');
    expect(w().playing?.id).toBe(V(2));
    expect(useOwnPlay.getState().note).toBe('Skipped one: it plays only on YouTube');
    await flush(0);
    expect(document.querySelector('.own-skip')!.textContent).toBe('Skipped one: it plays only on YouTube');
  });

  it('the last video ending with repeat off removes the frame and shows the end block', async () => {
    seed(2);
    render(<UnwindView />);
    act(() => void playOwn(FRIDAY, V(2)));
    await flush();
    const f = frame();
    send(f.win, playingMsg);
    await flush(LOAD_GAP_MS + 500);
    send(f.win, endMsg);
    await flush(0);
    expect(w().playing).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText('Your playlist · ended')).toBeTruthy();
    expect(useOwnPlay.getState().finished).toMatchObject({ listId: FRIDAY, total: 2 });
  });

  it('with repeat on the first video plays again after the last', async () => {
    seed(2, true);
    render(<UnwindView />);
    act(() => void playOwn(FRIDAY, V(2)));
    await flush();
    const f = frame();
    send(f.win, playingMsg);
    await flush(LOAD_GAP_MS + 500);
    send(f.win, endMsg);
    await flush(0);
    expect(w().playing?.id).toBe(V(1));
    expect(document.querySelector('iframe')!.getAttribute('src')).toContain(`/embed/${V(1)}?`);
    expect(useOwnPlay.getState().finished).toBeNull();
  });

  it('a one video playlist on repeat restarts in the same frame and the owner\'s pause still reaches the player once', async () => {
    seed(1, true);
    render(<UnwindView />);
    act(() => void playOwn(FRIDAY));
    await flush();
    const f = frame();
    send(f.win, playingMsg);
    await flush(LOAD_GAP_MS + 500);
    send(f.win, endMsg);
    expect(document.querySelector('iframe')).toBe(f.el);
    expect(w().paused).toBe(false);
    await flush(0);
    f.post.mockClear();
    await act(async () => screen.getByRole('button', { name: 'Pause' }).click());
    expect(w().paused).toBe(true);
    expect(f.post.mock.calls.filter((c) => c[0] === pauseMsg)).toHaveLength(1);
  });
});
