import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetNowPlaying } from '../../music/store';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { resetQueue } from '../ytmusic/queue';
import { resetOwnDetails } from './ownDetails';
import { OWN_KEY, resetOwnLists } from './ownLists';
import { resetOwnPlay } from './ownPlay';
import { framePoster } from './PlayerFrame';
import { defaultLabel, kindName } from './links';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const SINGLE = 'Ab3dEfGh1jK';
const LIVE = 'Lofi_Live01';
const PL = 'PLmockPlaylist0001';
const w = () => useWatchStore.getState();

function seed(saved: unknown[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: { ownlist00001: { items: [], shuffle: false, repeat: false } } }));
  resetWatch();
  resetOwnLists();
  resetOwnPlay();
  resetQueue();
  resetOwnDetails();
  w().setTab('watch');
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetTip();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => null);
  mocks.set('wall2_youtube_status', () => ({ setup: false, signedIn: false, reason: 'not set up', searchesLeft: null }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
  framePoster.render = null;
});

describe('the empty Watch list', () => {
  it('draws no line of link patterns; the field says in plain words which links work', async () => {
    seed([]);
    render(
      <>
        <UnwindView />
        <HoverTipLayer />
      </>,
    );
    await flush();
    expect(document.querySelector('.w-forms')).toBeNull();
    expect(document.body.textContent).not.toContain('youtu.be/');
    expect(screen.getByText(/Save the videos, playlists, live streams and Twitch channels/)).toBeTruthy();
    const field = screen.getByPlaceholderText('Paste a YouTube or Twitch link');
    // The app's own hover card (never a native title).
    expect(field.getAttribute('title')).toBeNull();
    fireEvent.mouseEnter(field);
    await flush(400);
    expect(document.querySelector('.hover-tip')?.textContent).toContain('A YouTube video, playlist or live stream, or a Twitch channel');
  });
});

describe('every row has its own icon and names its kind', () => {
  it('a single video, a live stream, a YouTube playlist, a wall playlist and a Twitch channel show five different icons, each with a kind tip', async () => {
    seed([
      { kind: 'video', id: SINGLE, label: 'A video' },
      { kind: 'live', id: LIVE, label: 'A stream' },
      { kind: 'playlist', id: PL, label: 'A playlist' },
      { kind: 'own', id: 'ownlist00001', label: 'Mine' },
      { kind: 'twitch', id: 'pixel_harbor', label: 'A channel' },
    ]);
    render(
      <>
        <UnwindView />
        <HoverTipLayer />
      </>,
    );
    await flush();
    const kinds = [...document.querySelectorAll('.w-list .w-kind')];
    expect(kinds).toHaveLength(5);
    const looks = kinds.map((k) => k.innerHTML);
    expect(new Set(looks).size).toBe(5);
    const expected = ['video', 'live', 'playlist', 'own', 'twitch'] as const;
    for (const [i, kind] of expected.entries()) {
      fireEvent.mouseEnter(kinds[i]!);
      await flush(400);
      expect(document.querySelector('.hover-tip')?.textContent).toContain(kindName(kind));
      fireEvent.mouseLeave(kinds[i]!);
      await flush(100);
    }
  });
});

describe('a saved item shows its real name as soon as the wall knows it', () => {
  it('YouTube details name an unnamed video and live stream, and never overwrite a name that was typed', async () => {
    seed([
      { kind: 'video', id: SINGLE, label: defaultLabel({ kind: 'video', id: SINGLE }) },
      { kind: 'live', id: LIVE, label: defaultLabel({ kind: 'live', id: LIVE }) },
      { kind: 'video', id: 'Zz9dEfGh1jK', label: 'My own name' },
    ]);
    mocks.set('wall2_youtube_status', () => ({ setup: true, signedIn: true, reason: null, searchesLeft: 100 }));
    mocks.set('wall2_youtube_videos', (a) => (a as { ids: string[] }).ids.map((id) => ({ id, title: `Real title ${id.slice(0, 4)}`, channel: 'Chan', seconds: 60 })));
    render(<UnwindView />);
    await flush();
    await flush();
    const labels = Object.fromEntries(w().saved.map((i) => [i.id, i.label]));
    expect(labels[SINGLE]).toBe('Real title Ab3d');
    expect(labels[LIVE]).toBe('Real title Lofi');
    expect(labels['Zz9dEfGh1jK']).toBe('My own name');
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!).map((i: { label: string }) => i.label)).toContain('Real title Ab3d');
  });

  it('the same id saved as a video and as a live stream: each unnamed row is filled by its own key', async () => {
    seed([
      { kind: 'video', id: SINGLE, label: defaultLabel({ kind: 'video', id: SINGLE }) },
      { kind: 'live', id: SINGLE, label: defaultLabel({ kind: 'live', id: SINGLE }) },
    ]);
    mocks.set('wall2_youtube_status', () => ({ setup: true, signedIn: true, reason: null, searchesLeft: 100 }));
    mocks.set('wall2_youtube_videos', (a) => (a as { ids: string[] }).ids.map((id) => ({ id, title: 'Shared id title', channel: 'Chan', seconds: 60 })));
    render(<UnwindView />);
    await flush();
    await flush();
    expect(w().saved.map((i) => [i.kind, i.label])).toEqual([['video', 'Shared id title'], ['live', 'Shared id title']]);
  });

  it('with the details unavailable the kind name stays until the player reports the title', async () => {
    seed([{ kind: 'video', id: SINGLE, label: defaultLabel({ kind: 'video', id: SINGLE }) }]);
    render(<UnwindView />);
    await flush();
    expect(w().saved[0]!.label).toBe('YouTube video');
    expect(w().fillLabel(`video:${SINGLE}`, 'Title from the player')).toBe(true);
    expect(w().fillLabel(`video:${SINGLE}`, 'Another title')).toBe(false);
  });
});

describe('a single video can always be saved on its own', () => {
  it('the add menu has a plain Watch list row: it saves the video by itself with its title, shows a check, and takes it out again', async () => {
    seed([{ kind: 'own', id: 'ownlist00001', label: 'Mine' }]);
    render(<UnwindView />);
    await flush();
    act(() => void w().playMusic(SINGLE, 'Library name'));
    act(() => w().setReport({ title: 'Reported title' }));
    await flush();
    await act(async () => screen.getByRole('button', { name: 'Add to a playlist' }).click());
    const pick = () => within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Watch list, on its own' });
    expect(pick().querySelector('.w-pop-check')).toBeNull();
    expect(w().saved.some((i) => i.kind === 'video')).toBe(false);
    // The plain choice saves it by itself, named by the title the menu knows.
    await act(async () => pick().click());
    expect(w().saved.find((i) => i.kind === 'video' && i.id === SINGLE)?.label).toBe('Reported title');
    expect(pick().querySelector('.w-pop-check')).not.toBeNull();
    // A second click takes it out again (it is not the video playing from the list, so playing goes on).
    await act(async () => pick().click());
    expect(w().saved.some((i) => i.kind === 'video' && i.id === SINGLE)).toBe(false);
  });

  it('unticking "Watch list, on its own" only takes it out of the list: the video playing from the list keeps playing', async () => {
    seed([{ kind: 'own', id: 'ownlist00001', label: 'Mine' }, { kind: 'video', id: SINGLE, label: 'Kept name' }]);
    render(<UnwindView />);
    await flush();
    act(() => w().play({ kind: 'video', id: SINGLE, label: 'Kept name' }));
    await flush();
    expect(w().playing?.id).toBe(SINGLE);
    await act(async () => screen.getByRole('button', { name: 'Add to a playlist' }).click());
    await act(async () => within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Watch list, on its own' }).click());
    expect(w().saved.some((i) => i.kind === 'video')).toBe(false);
    expect(w().playing?.id).toBe(SINGLE);
  });
});
