import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { wallVideoControls, wallVideoView } from '../../home/wallVideo';
import { resetNowPlaying } from '../../music/store';
import { type YoutubeStatus, type YtPage, type YtPlayable, type YtPlaylist, type YtVideo } from '../../music/youtube';
import { Rail } from '../../rail/Rail';
import { usePlaceStore } from '../../state/places';
import { HoverTipLayer, hideTip } from '../../ui/HoverTip';
import { resetLastPlayed } from '../lastPlayed';
import { Player } from '../Player';
import { resetListenSource } from '../spotify/model';
import { resetSpotifyStatus } from '../spotify/status';
import { framePoster, playerLink } from '../watch/PlayerFrame';
import { SAVED_KEY } from '../watch/saved';
import { resetWatch, useWatchStore } from '../watch/store';
import { UnwindView } from '../watch/testView';
import { FOOT_SEEK_GAP_MS, FOOT_SEEK_STEP_S } from './YtFoot';
import { AUTOPLAY_LINE, LOAD_GAP_MS, playAgain, playAll, playFrom, resetQueue, useYtQueue } from './queue';
import { resetYoutubeStatus } from './status';
import { resetLibrary } from './store';
import { YtMusicSide } from './YtMusicSide';

vi.setConfig({ testTimeout: 20_000 });

const WATCH_ID = 'Ab3dEfGh1jK';
const id = (n: number) => `vid${String(n).padStart(8, '0')}`;
const THUMB = (n: number) => `https://i.ytimg.com/vi/${id(n)}/mqdefault.jpg`;
const video = (n: number, playable: YtPlayable = 'yes'): YtVideo => ({ id: id(n), title: `Clip ${n}`, channel: `Channel ${n}`, seconds: 200 + n, thumb: THUMB(n), playable });
const page = <T,>(items: T[], next: string | null = null): YtPage<T> => ({ items, next });
const playlist = (n: number): YtPlaylist => ({ id: `PLtest${n}`, title: `Mix ${n}`, count: 6, thumb: THUMB(n) });
const signedIn: YoutubeStatus = { setup: true, signedIn: true, reason: null, searchesLeft: 100 };
const SONGS = [video(1), video(2, 'embed'), video(3), video(4, 'removed'), video(5), video(6)];
const LIST = { list: 'songs', playlistId: 'PLtest1' } as const;

let sent: [string, readonly (number | boolean)[] | undefined][] = [];
const realSend = playerLink.send;
const w = () => useWatchStore.getState();
const q = () => useYtQueue.getState();
const nowId = () => w().playing?.id ?? null;
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const keys: string[] = [];

function serve(songs: YtVideo[] = SONGS) {
  mocks.set('wall2_youtube_status', () => signedIn);
  mocks.set('wall2_youtube_playlists', () => page([playlist(1), playlist(2)]));
  mocks.set('wall2_youtube_items', () => page(songs));
  mocks.set('wall2_youtube_liked', () => page([video(11), video(12, 'embed'), video(13)]));
  mocks.set('wall2_youtube_search', () => page([video(21), video(22)]));
  for (const name of ['media_previous', 'media_next', 'media_play_pause']) mocks.set(name, () => void keys.push(name));
}

async function openList(tall = true) {
  serve();
  render(
    <>
      <YtMusicSide tall={tall} remote={null} />
      <HoverTipLayer />
    </>,
  );
  await flush(10);
  fireEvent.click(screen.getByText('Mix 1').closest('button')!);
  await flush(10);
  await flush(10);
  expect(screen.getByText('Clip 1')).toBeTruthy();
}
const rowBtn = (title: string) => screen.getByText(title).closest('.yt-row')!.querySelector('button') as HTMLButtonElement | null;
const rowEl = (title: string) => screen.getByText(title).closest('.yt-row') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T22:30:00-08:00'));
  localStorage.clear();
  keys.length = 0;
  sent = [];
  resetWatch();
  resetQueue();
  resetLibrary();
  resetListenSource();
  resetSpotifyStatus();
  resetYoutubeStatus();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  playerLink.send = (func, args) => {
    sent.push([func, args]);
    return true;
  };
  mocks.set('get_now_playing', () => null);
});
afterEach(() => {
  cleanup();
  hideTip(true);
  playerLink.send = realSend;
  framePoster.render = null;
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  resetQueue();
  resetLibrary();
  localStorage.clear();
});

describe('the rows play', () => {
  it('a playable row is a button and a greyed row is not, with the same words as before', async () => {
    await openList(false);
    for (const t of ['Clip 1', 'Clip 3', 'Clip 5', 'Clip 6']) {
      const b = rowBtn(t)!;
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('type')).toBe('button');
      expect(b.classList.contains('yt-play')).toBe(true);
    }
    for (const t of ['Clip 2', 'Clip 4']) {
      expect(rowBtn(t)).toBeNull();
      expect(rowEl(t).classList.contains('off')).toBe(true);
      fireEvent.click(rowEl(t));
    }
    expect(within(rowEl('Clip 2')).getByText('Only on YouTube')).toBeTruthy();
    expect(within(rowEl('Clip 4')).getByText('Removed')).toBeTruthy();
    expect(w().playing).toBeNull();
  });

  it('a click plays the list from that row, as sound on the wall (never saved, tab unchanged)', async () => {
    await openList(false);
    fireEvent.click(rowBtn('Clip 3')!);
    expect(nowId()).toBe(id(3));
    expect(w().source).toBe('music');
    expect(w().tab).toBe('listen');
    expect(w().saved).toEqual([]);
    expect(localStorage.getItem(SAVED_KEY)).toBeNull();
    expect(q().entries.map((e) => e.id)).toEqual([id(1), id(3), id(5), id(6)]);
    expect(q().from).toEqual(LIST);
  });

  it('marks exactly one row, cyan, with bars while playing and its number while paused', async () => {
    await openList(false);
    fireEvent.click(rowBtn('Clip 3')!);
    await flush(0);
    const on = document.querySelectorAll('.yt-row.on');
    expect(on.length).toBe(1);
    expect(on[0]).toBe(rowEl('Clip 3'));
    expect(on[0]!.querySelector('button')!.getAttribute('aria-current')).toBe('true');
    expect(document.querySelectorAll('.yt-row [aria-current="true"]').length).toBe(1);
    expect(on[0]!.querySelectorAll('.sp-bars').length).toBe(1);
    expect(document.querySelectorAll('.sp-bars').length).toBe(1);
    act(() => w().setPaused(true));
    expect(document.querySelectorAll('.yt-row.on').length).toBe(1);
    expect(document.querySelectorAll('.sp-bars').length).toBe(0);
    expect(within(rowEl('Clip 3')).getByText('3')).toBeTruthy();
    // Another list playing marks no row here.
    act(() => w().setPaused(false));
    playFrom([video(31), video(32)], 0, { list: 'liked' });
    await flush(LOAD_GAP_MS);
    expect(document.querySelectorAll('.yt-row.on').length).toBe(0);
  });

  it('shows the title, channel, length and what a click does on hover', async () => {
    await openList(false);
    fireEvent.mouseEnter(rowEl('Clip 5'));
    await flush(500);
    const tipText = (document.querySelector('.hover-tip') as HTMLElement).textContent!;
    expect(tipText).toContain('Clip 5');
    expect(tipText).toContain('Channel 5');
    expect(tipText).toContain('3:25');
    expect(tipText).toContain('Click to play it on the wall');
  });

  it('greys a row that fails in play, with the library\'s own words and no button', async () => {
    await openList(false);
    fireEvent.click(rowBtn('Clip 1')!);
    await flush(LOAD_GAP_MS);
    act(() => w().setReport({ error: 150 }));
    await flush(LOAD_GAP_MS);
    expect(rowBtn('Clip 1')).toBeNull();
    expect(within(rowEl('Clip 1')).getByText('Only on YouTube')).toBeTruthy();
    expect(nowId()).toBe(id(3));
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Skipped Clip 1: it plays only on YouTube.');
  });

  it('plays Liked and search rows from that row, in that list', async () => {
    serve();
    render(<YtMusicSide tall={false} remote={null} />);
    await flush(10);
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await flush(10);
    await flush(10);
    expect(screen.getByText('Clip 11')).toBeTruthy();
    expect(rowBtn('Clip 12')).toBeNull();
    fireEvent.click(rowBtn('Clip 13')!);
    expect(nowId()).toBe(id(13));
    expect(q().from).toEqual({ list: 'liked' });
    expect(document.querySelectorAll('.yt-row.on').length).toBe(1);
    // A search.
    await flush(LOAD_GAP_MS);
    const field = screen.getByPlaceholderText('Search YouTube Music');
    fireEvent.change(field, { target: { value: 'night' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush(10);
    await flush(10);
    expect(screen.getByText('Clip 21')).toBeTruthy();
    fireEvent.click(rowBtn('Clip 22')!);
    expect(nowId()).toBe(id(22));
    expect(q().from).toEqual({ list: 'found', query: 'night' });
  });
});

describe('a row the wall cannot play', () => {
  it('is greyed with its reason when it is marked playable but its id has no video id shape, and is not a button', async () => {
    serve([video(1), { ...video(2), id: 'not-an-id' }, video(3)]);
    render(<YtMusicSide tall={false} remote={null} />);
    await flush(10);
    fireEvent.click(screen.getByText('Mix 1').closest('button')!);
    await flush(10);
    await flush(10);
    expect(rowBtn('Clip 1')).not.toBeNull();
    expect(rowBtn('Clip 2')).toBeNull();
    expect(rowEl('Clip 2').classList.contains('off')).toBe(true);
    expect(rowEl('Clip 2').getAttribute('data-playable')).toBe('no');
    expect(within(rowEl('Clip 2')).getByText('Not available')).toBeTruthy();
    fireEvent.click(rowEl('Clip 2'));
    expect(w().playing).toBeNull();
  });
});

describe('sound', () => {
  it('a pick the owner asks for is heard even when a Watch video left the player muted; an automatic advance never changes mute', async () => {
    await openList(false);
    act(() => w().setMuted(true));
    fireEvent.click(rowBtn('Clip 1')!);
    expect(w().muted).toBe(false);
    // Muted again by the owner: a skip or an advance leaves it as it is.
    act(() => w().setMuted(true));
    act(() => w().setReport({ started: true, ended: true }));
    await flush(LOAD_GAP_MS + 5);
    expect(nowId()).toBe(id(3));
    expect(w().muted).toBe(true);
    // Play and Shuffle and Play again are the owner's too.
    cleanup();
    act(() => w().setMuted(true));
    resetQueue();
    resetWatch();
    act(() => w().setMuted(true));
    playAll([video(1), video(3)], true, LIST);
    expect(w().muted).toBe(false);
    act(() => w().stop());
    act(() => w().setMuted(true));
    await flush(LOAD_GAP_MS);
    playAgain();
    expect(w().muted).toBe(false);
  });
});

describe('Play and Shuffle', () => {
  it.each([true, false])('start the queue from the first playable row or in a random order (tall %s)', async (tall) => {
    await openList(tall);
    const play = document.querySelector('.yt-playall') as HTMLElement;
    const shuffle = screen.getByRole('button', { name: 'Shuffle' });
    fireEvent.click(play);
    expect(nowId()).toBe(id(1));
    expect(q().shuffled).toBe(false);
    await flush(LOAD_GAP_MS);
    fireEvent.click(shuffle);
    await flush(LOAD_GAP_MS);
    expect(q().shuffled).toBe(true);
    expect(q().entries.length).toBe(4);
    expect(nowId()).toBe(q().entries[0]!.id);
  });

  it('keep Refresh as an icon button, with the time read in its hover card tall and at rest', async () => {
    await openList(true);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.queryByText(/^Read at /)).toBeNull();
    cleanup();
    resetLibrary();
    await openList(false);
    expect(screen.queryByText(/^Read at /)).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Refresh' }));
    await flush(500);
    expect((document.querySelector('.hover-tip') as HTMLElement).textContent).toMatch(/Last read at \d{1,2}:\d{2} (AM|PM)/);
  });

  it('say so and do nothing when no video plays outside YouTube', async () => {
    serve([video(1, 'embed'), video(2, 'private')]);
    render(
      <>
        <YtMusicSide tall remote={null} />
        <HoverTipLayer />
      </>,
    );
    await flush(10);
    fireEvent.click(screen.getByText('Mix 1').closest('button')!);
    await flush(10);
    await flush(10);
    expect(screen.getByText('Clip 1')).toBeTruthy();
    for (const b of [document.querySelector('.yt-playall') as HTMLElement, screen.getByRole('button', { name: 'Shuffle' })]) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(b);
    }
    expect(w().playing).toBeNull();
    fireEvent.mouseEnter(document.querySelector('.yt-playall') as HTMLElement);
    await flush(500);
    expect((document.querySelector('.hover-tip') as HTMLElement).textContent).toContain('None of these videos plays outside YouTube');
  });
});

describe('the foot player', () => {
  const foot = () => document.querySelector('.yt-foot') as HTMLElement;
  const slider = () => within(foot()).getByRole('slider');

  it('is there tall and not at rest, and says nothing plays when nothing does', async () => {
    await openList(true);
    expect(foot()).not.toBeNull();
    expect(within(foot()).getByText('Nothing playing on the wall')).toBeTruthy();
    expect(within(foot()).getByText('Pick a video to play it here')).toBeTruthy();
    for (const name of ['Previous', 'Play', 'Next']) expect(within(foot()).getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    cleanup();
    resetLibrary();
    await openList(false);
    expect(foot()).toBeNull();
  });

  it('shows the music with the queue\'s previous and next, and its time from the report', async () => {
    await openList(true);
    fireEvent.click(rowBtn('Clip 3')!);
    act(() => w().setReport({ started: true, time: 66, duration: 214, title: 'Clip 3', channel: 'Channel 3' }));
    expect(within(foot()).getByText('Clip 3')).toBeTruthy();
    expect(within(foot()).getByText('Channel 3')).toBeTruthy();
    expect(within(foot()).getByText('1:06')).toBeTruthy();
    expect(within(foot()).getByText('3:34')).toBeTruthy();
    expect(foot().querySelector('img')!.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(slider().getAttribute('aria-valuenow')).toBe('66');
    await flush(LOAD_GAP_MS);
    fireEvent.click(within(foot()).getByRole('button', { name: 'Next' }));
    expect(nowId()).toBe(id(5));
    await flush(LOAD_GAP_MS);
    fireEvent.click(within(foot()).getByRole('button', { name: 'Previous' }));
    expect(nowId()).toBe(id(3));
    fireEvent.click(within(foot()).getByRole('button', { name: 'Pause' }));
    expect(w().paused).toBe(true);
    expect(within(foot()).getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(keys).toEqual([]);
  });

  it('seeks with numbers only, by drag, and a held key sends at most one seek every 300 ms and the last on release', async () => {
    await openList(true);
    fireEvent.click(rowBtn('Clip 1')!);
    act(() => w().setReport({ started: true, time: 60, duration: 200 }));
    sent.length = 0;
    const bar = slider();
    bar.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 6, height: 6, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(bar, { button: 0, clientX: 50, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 100, pointerId: 1 });
    expect(sent).toEqual([]);
    fireEvent.pointerUp(bar, { clientX: 100, pointerId: 1 });
    expect(sent).toEqual([['seekTo', [100, true]]]);
    for (const [, args] of sent) for (const a of args ?? []) expect(['number', 'boolean']).toContain(typeof a);
    // Arrow keys.
    sent.length = 0;
    act(() => w().setReport({ time: 100 }));
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(sent).toEqual([['seekTo', [100 + FOOT_SEEK_STEP_S, true]]]);
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(sent.length).toBe(1);
    await flush(FOOT_SEEK_GAP_MS + 1);
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual(['seekTo', [100 + FOOT_SEEK_STEP_S * 3, true]]);
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    fireEvent.keyUp(bar, { key: 'ArrowRight' });
    expect(sent.length).toBe(3);
    expect(sent[2]).toEqual(['seekTo', [100 + FOOT_SEEK_STEP_S * 4, true]]);
  });

  it('drops a keyboard seek that is still waiting when another video takes the frame (it never lands on the next video)', async () => {
    await openList(true);
    fireEvent.click(rowBtn('Clip 1')!);
    act(() => w().setReport({ started: true, time: 60, duration: 200 }));
    await flush(LOAD_GAP_MS);
    sent.length = 0;
    const bar = slider();
    // A first key goes out at once; the second waits inside the 300 ms window.
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(sent.length).toBe(1);
    // Next, inside that window: the pending seek must not fire on the new entry.
    fireEvent.click(within(foot()).getByRole('button', { name: 'Next' }));
    await flush(FOOT_SEEK_GAP_MS + 50);
    await flush(LOAD_GAP_MS);
    expect(nowId()).toBe(id(3));
    expect(sent.filter(([f]) => f === 'seekTo')).toEqual([['seekTo', [65, true]]]);
    // The key's release does not send the dropped position either.
    fireEvent.keyUp(bar, { key: 'ArrowRight' });
    expect(sent.filter(([f]) => f === 'seekTo').length).toBe(1);
  });

  it('says autoplay was refused with one button that goes to Watch', async () => {
    await openList(true);
    fireEvent.click(rowBtn('Clip 1')!);
    act(() => w().setNeedsClick(true));
    expect(within(foot()).getByText(AUTOPLAY_LINE)).toBeTruthy();
    expect(within(foot()).queryByRole('slider')).toBeNull();
    usePlaceStore.setState({ active: 'work' });
    fireEvent.click(within(foot()).getByRole('button', { name: 'Start it on Watch' }));
    expect(usePlaceStore.getState().active).toBe('unwind');
    expect(w().tab).toBe('watch');
    // The same item stays: Watch's own click-to-start takes over.
    expect(nowId()).toBe(id(1));
  });

  it('says it at rest in the note line, in the card', async () => {
    await openList(false);
    fireEvent.click(rowBtn('Clip 1')!);
    act(() => w().setNeedsClick(true));
    const note = document.querySelector('.yt-note')!;
    expect(note.textContent).toContain(AUTOPLAY_LINE);
    fireEvent.click(within(note as HTMLElement).getByRole('button', { name: 'Start it on Watch' }));
    expect(w().tab).toBe('watch');
  });

  it('shows a Watch video with its title, play and pause, and previous and next only for a playlist', async () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: WATCH_ID, label: 'Night drive mix' }, { kind: 'playlist', id: 'PLmockPlaylist0001', label: 'Weekend list' }, { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' }]));
    w().load();
    await openList(true);
    act(() => w().play({ kind: 'video', id: WATCH_ID }));
    act(() => w().setReport({ started: true, time: 754, duration: 2710, title: 'Night drive mix (full)', channel: 'Night Garden' }));
    expect(within(foot()).getByText('Night drive mix (full)')).toBeTruthy();
    expect(within(foot()).getByText('Night Garden')).toBeTruthy();
    expect(within(foot()).getByRole('button', { name: 'Previous' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(foot()).getByRole('button', { name: 'Next' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(foot()).getByRole('button', { name: 'Pause' }));
    expect(w().paused).toBe(true);
    act(() => w().play({ kind: 'playlist', id: 'PLmockPlaylist0001' }));
    act(() => w().setReport({ started: true, count: 24, index: 3 }));
    sent.length = 0;
    fireEvent.click(within(foot()).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(foot()).getByRole('button', { name: 'Previous' }));
    expect(sent).toEqual([['nextVideo', undefined], ['previousVideo', undefined]]);
    // Twitch: every button is off, with its own tip.
    act(() => w().play({ kind: 'twitch', id: 'pixel_harbor' }));
    for (const name of ['Previous', 'Play', 'Next']) expect(within(foot()).getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.mouseEnter(within(foot()).getByRole('button', { name: 'Play' }));
    await flush(500);
    expect((document.querySelector('.hover-tip') as HTMLElement).textContent).toContain('Twitch takes only Stop, on Watch');
  });
});

describe('the top player on Listen', () => {
  it('draws the wall\'s own music, and its buttons drive the queue, not the media keys', async () => {
    serve();
    playAll([video(1), video(3), video(5)], false, LIST);
    act(() => w().setReport({ started: true, time: 66, duration: 214, title: 'Clip 1', channel: 'Channel 1' }));
    render(<Player />);
    await flush(10);
    expect(screen.getByText('YouTube, on the wall')).toBeTruthy();
    expect(screen.getByText('Clip 1')).toBeTruthy();
    expect(screen.getByText('Channel 1')).toBeTruthy();
    expect(screen.getByText('1:06')).toBeTruthy();
    expect(document.querySelector('.u-art img')!.getAttribute('src')).toBe(THUMB(1));
    await flush(LOAD_GAP_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(nowId()).toBe(id(3));
    await flush(LOAD_GAP_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(w().paused).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(w().paused).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await flush(LOAD_GAP_MS);
    expect(keys).toEqual([]);
  });

  it('draws the video icon only while the pick is in Watch\'s frame, and the click shows that video in Watch', async () => {
    serve();
    playAll([video(1), video(3)], false, LIST);
    act(() => w().setReport({ started: true, time: 5, duration: 214, title: 'Clip 1', channel: 'Channel 1' }));
    act(() => w().setTab('listen'));
    render(<Player />);
    await flush(10);
    const icon = screen.getByRole('button', { name: 'Watch the video' });
    expect(icon.closest('.u-art')).not.toBeNull();
    fireEvent.click(icon);
    expect(w().tab).toBe('watch');
    expect(w().playing?.id).toBe(id(1));
    // Stopped, the frame is gone: Watch would be empty, so there is no icon.
    act(() => w().stop());
    await flush(10);
    expect(screen.getByText('Last played on the wall')).toBeTruthy();
    expect(document.querySelector('.u-video')).toBeNull();
  });

  it('says it was the last played, with Play again, when it has stopped and the queue is kept', async () => {
    serve();
    playAll([video(1), video(3)], false, LIST);
    act(() => w().stop());
    render(<Player />);
    await flush(10);
    expect(screen.getByText('Last played on the wall')).toBeTruthy();
    await flush(LOAD_GAP_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(nowId()).toBe(id(1));
    expect(screen.getByText('YouTube, on the wall')).toBeTruthy();
  });

  it('is unchanged for a Watch video (no wall music view)', async () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: WATCH_ID, label: 'Night drive mix' }]));
    w().load();
    act(() => w().play({ kind: 'video', id: WATCH_ID }));
    render(<Player />);
    await flush(10);
    expect(screen.queryByText('YouTube, on the wall')).toBeNull();
    expect(document.querySelector('[data-wall-music]')).toBeNull();
  });

  it('keeps today\'s rule when another app plays at the same time', async () => {
    serve();
    mocks.set('get_now_playing', () => ({ title: 'Other song', artist: 'Band', playback_status: 'playing', source_app: 'Spotify', session_key: 'k1', duration_seconds: 100, position_seconds: 1 }));
    playAll([video(1), video(3)], false, LIST);
    act(() => w().setReport({ started: true, time: 5, duration: 214 }));
    render(<Player />);
    await flush(2000);
    expect(screen.queryByText('YouTube, on the wall')).toBeNull();
  });
});

describe('Home, the rail, Up next and Watch', () => {
  it('Home\'s view says YouTube Music with the place in the queue, and previous and next go through the queue', async () => {
    playFrom(Array.from({ length: 41 }, (_, i) => video(i)), 1, LIST);
    act(() => w().setReport({ started: true, time: 66, duration: 214, title: 'Clip 1', channel: 'Channel 1' }));
    const v = wallVideoView({ playing: w().playing, paused: w().paused, needsClick: w().needsClick, report: w().report, source: w().source }, { entries: q().entries, pos: q().pos })!;
    expect(v).toMatchObject({ title: 'Clip 1', sub: 'YouTube Music, 2 of 41', shortSub: 'YouTube Music, 2 of 41', youtube: true, list: { index: 1, count: 41 } });
    // Without the queue it is just a video, as before.
    expect(wallVideoView({ playing: w().playing, paused: false, needsClick: false, report: w().report })).toMatchObject({ sub: 'YouTube video', list: null });
    await flush(LOAD_GAP_MS);
    expect(wallVideoControls.next()).toBe(true);
    expect(nowId()).toBe(id(2));
    await flush(LOAD_GAP_MS);
    expect(wallVideoControls.previous()).toBe(true);
    expect(nowId()).toBe(id(1));
    expect(sent.filter(([f]) => f === 'nextVideo' || f === 'previousVideo')).toEqual([]);
  });

  it('the rail marks Unwind away from it and a click goes to Listen (a Watch video still goes to Watch)', () => {
    playAll([video(1), video(3)], false, LIST);
    act(() => w().setReport({ started: true, time: 1, duration: 100 }));
    usePlaceStore.setState({ active: 'work' });
    render(<Rail />);
    const unwind = screen.getByRole('button', { name: 'Unwind' });
    expect(unwind.querySelector('.rb-play')).not.toBeNull();
    fireEvent.click(unwind);
    expect(usePlaceStore.getState().active).toBe('unwind');
    expect(w().tab).toBe('listen');
    // On Unwind itself the mark is gone for the music (it is heard, never seen)...
    expect(screen.getByRole('button', { name: 'Unwind' }).querySelector('.rb-play')).toBeNull();
    // ...and on Listen with a Watch video the mark still shows only away from Watch.
    cleanup();
    resetWatch();
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: WATCH_ID, label: 'Night drive mix' }]));
    w().load();
    act(() => w().play({ kind: 'video', id: WATCH_ID }));
    act(() => w().setTab('listen'));
    render(<Rail />);
    expect(screen.getByRole('button', { name: 'Unwind' }).querySelector('.rb-play')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unwind' }));
    expect(w().tab).toBe('watch');
  });

  it('on Unwind, Up next lists the next entries and a click plays that one; Spotify\'s Up next is not drawn then', async () => {
    framePoster.render = () => null;
    playAll([1, 2, 3, 4, 5].map((n) => video(n)), false, LIST);
    act(() => w().setReport({ started: true, time: 1, duration: 100 }));
    render(<UnwindView />);
    await flush(20);
    const next = document.querySelector('.u-next') as HTMLElement;
    expect(next).not.toBeNull();
    // The left wing shows one row, as the Spotify side's does.
    const rows = within(next).getAllByRole('button');
    expect(rows.length).toBe(1);
    expect(within(next).getByText('Clip 2')).toBeTruthy();
    expect(within(next).getByText('Channel 2')).toBeTruthy();
    await flush(LOAD_GAP_MS);
    fireEvent.click(rows[0]!);
    expect(nowId()).toBe(id(2));
    // The top player and the frame (parked: a music pick never shows the stage).
    expect(screen.getByText('YouTube, on the wall')).toBeTruthy();
    expect(document.querySelector('.w-layer')?.getAttribute('data-shown')).toBe('false');
    act(() => w().stop());
    await flush(10);
    expect(document.querySelector('.u-next')).toBeNull();
  });

  it('on the Watch tab a music pick shows as the single video it is, and Previous and Next are the queue\'s', async () => {
    framePoster.render = () => null;
    playAll([1, 2, 3].map((n) => video(n)), false, LIST);
    act(() => w().setReport({ started: true, time: 1, duration: 100, title: 'Clip 1', channel: 'Channel 1' }));
    act(() => w().setTab('watch'));
    render(<UnwindView />);
    await flush(20);
    expect(screen.getAllByText('Clip 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Channel 1')).toBeTruthy();
    const nextBtn = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    const prevBtn = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
    expect(prevBtn.disabled).toBe(false);
    await flush(LOAD_GAP_MS);
    fireEvent.click(nextBtn);
    expect(nowId()).toBe(id(2));
    expect(sent.filter(([f]) => f === 'nextVideo')).toEqual([]);
  });

  it('a Watch video with the same id as the queue\'s entry keeps its own Previous and Next (a plain video has none)', async () => {
    framePoster.render = () => null;
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: id(1), label: 'Same video' }]));
    w().load();
    playAll([video(1), video(3)], false, LIST);
    act(() => w().play({ kind: 'video', id: id(1) }));
    act(() => w().setTab('watch'));
    render(<UnwindView />);
    await flush(20);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    expect(wallVideoControls.next()).toBe(true);
    expect(sent).toContainEqual(['nextVideo', undefined]);
    await flush(LOAD_GAP_MS * 2);
    expect(w().source).toBe('watch');
    expect(nowId()).toBe(id(1));
  });

  it('puts the frame address on the no-cookie embed host for the id, and keeps the frame when the same pick is played again', async () => {
    playAll([video(1), video(3)], false, LIST);
    render(<UnwindView />);
    await flush(20);
    const frame = document.querySelector('iframe')!;
    // The mounted frame installs its own link; the test puts its recorder back in front of it.
    playerLink.send = (func, args) => {
      sent.push([func, args]);
      return true;
    };
    expect(frame.getAttribute('src')!.startsWith(`https://www.youtube-nocookie.com/embed/${id(1)}?`)).toBe(true);
    expect(frame.closest('.w-layer')?.getAttribute('data-shown')).toBe('false');
    await flush(LOAD_GAP_MS);
    act(() => w().playMusic(id(1), 'Clip 1'));
    expect(document.querySelector('iframe')).toBe(frame);
    expect(sent).toContainEqual(['seekTo', [0, true]]);
  });

  it('names the wall\'s music in the volume slider\'s hover card', async () => {
    framePoster.render = () => null;
    playAll([video(1), video(3)], false, LIST);
    act(() => w().setReport({ started: true, time: 1, duration: 100 }));
    render(
      <>
        <UnwindView />
        <HoverTipLayer />
      </>,
    );
    await flush(20);
    fireEvent.mouseEnter(document.querySelector('.u-qvol') as HTMLElement);
    await flush(600);
    expect((document.querySelector('.hover-tip') as HTMLElement).textContent).toContain('YouTube, on the wall');
  });
});
