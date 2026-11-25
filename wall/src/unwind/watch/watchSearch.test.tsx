import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { YtVideo } from '../../music/youtube';
import { useSignalStore } from '../../signals/store';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetYoutubeStatus } from '../ytmusic/status';
import { WatchCard } from './WatchCard';
import { useToolsStore } from '../../tools/store';
import { OWN_KEY, resetOwnLists, useOwnLists } from './ownLists';
import { SEARCH_SORT_KEY, SEARCH_VIEW_KEY, closeWatchSearch, isLinkText, loadSort, loadView, pickView, useWatchSearch, wordsProblem } from './searchStore';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';

vi.setConfig({ testTimeout: 20_000 });

const vid = (n: number, extra: Partial<YtVideo> = {}): YtVideo => ({ id: String(n).padStart(11, 'v'), title: `Clip ${n}`, channel: `Channel ${n}`, seconds: 100 * n, thumb: null, playable: 'yes', views: 1000 * (5 - n), ...extra });
const FOUND = [vid(1), vid(2), vid(3), vid(4)];

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
const type = async (text: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Search or paste a link'), { target: { value: text } });
  });
};
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const mainButton = () => document.querySelector('.w-add') as HTMLButtonElement;

const makeSearch = () => vi.fn((_args?: unknown) => ({ items: FOUND, next: null }));
let search: ReturnType<typeof makeSearch>;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' }]));
  resetWatch();
  closeWatchSearch();
  useWatchSearch.setState({ view: loadView(), sort: loadSort() });
  resetYoutubeStatus();
  useToolsStore.setState({ open: false });
  useSignalStore.setState({ call: null });
  search = makeSearch();
  mocks.set('wall2_youtube_search', search);
  mocks.set('wall2_youtube_status', () => ({ setup: true, signedIn: true, reason: null, searchesLeft: 87 }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.clear();
  resetTip();
  localStorage.clear();
  closeWatchSearch();
});

const card = () =>
  render(
    <>
      <WatchCard />
      <HoverTipLayer />
    </>,
  );

describe('telling words from a link', () => {
  it('reads what the saver accepts as a link, with or without a scheme', () => {
    for (const link of ['https://www.youtube.com/watch?v=Ab3dEfGh1jK', 'youtu.be/Ab3dEfGh1jK', 'youtube.com/watch?v=Ab3dEfGh1jK', 'music.youtube.com/watch?v=Ab3dEfGh1jK', 'www.youtube.com/playlist?list=PLmockPlaylist0001', 'twitch.tv/somechannel', 'https://example.com/x', 'youtu.be/short']) expect(isLinkText(link), link).toBe(true);
  });
  it('reads every other text, a dotted word included, as words', () => {
    for (const words of ['synthwave night drive', 'lofi', 'node.js', 'mr.beast', 'drum.live', 'youtube tutorials', 'what.is.love', '']) expect(isLinkText(words), words).toBe(false);
  });
  it('refuses words over 100 characters, and nothing else', () => {
    expect(wordsProblem('a'.repeat(101))).toBe('Searches can be up to 100 characters.');
    expect(wordsProblem('a'.repeat(100))).toBeNull();
    expect(wordsProblem('bad\u0007words')).toBe('Searches cannot hold that character.');
    expect(wordsProblem('')).toBeNull();
  });
});

describe('the Watch card search', () => {
  it('keeps Save for a link and reads Search for words', async () => {
    card();
    expect(screen.getByPlaceholderText('Search or paste a link')).toBeTruthy();
    expect(mainButton().textContent).toBe('Save');
    await type('https://youtu.be/Ab3dEfGh1jQ');
    expect(mainButton().textContent).toBe('Save');
    await type('synthwave night drive');
    expect(mainButton().textContent).toBe('Search');
    expect(search).not.toHaveBeenCalled();
  });

  it('searches with no category, grows the card, shows the count, the sort and the foot line', async () => {
    card();
    await type('synthwave night drive');
    await click(mainButton());
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ query: 'synthwave night drive', anyCategory: true });
    expect(document.querySelector('.w-card')?.classList.contains('own-tall')).toBe(true);
    expect(screen.getByText('4 videos')).toBeTruthy();
    expect(document.querySelector('.mu-sort')?.textContent).toBe('Sort: Best match');
    expect(screen.getByText('87 searches left today')).toBeTruthy();
    expect(document.querySelector('.ws-grid')).toBeTruthy();
    expect(document.querySelectorAll('.ws-item')).toHaveLength(4);
  });

  it('sorts what was found without searching again, and remembers the sort and the view', async () => {
    card();
    await type('night');
    await click(mainButton());
    await click(document.querySelector('.mu-sort')!);
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual(['Best match', 'Most viewed', 'Longest first', 'Shortest first', 'Channel, A to Z', 'Title, A to Z']);
    await click(options[3]!);
    expect(search).toHaveBeenCalledTimes(1);
    expect([...document.querySelectorAll('.ws-title')].map((e) => e.textContent)).toEqual(['Clip 1', 'Clip 2', 'Clip 3', 'Clip 4']);
    await click(document.querySelector('.mu-sort')!);
    await click([...document.querySelectorAll('[role="option"]')][2]!);
    expect([...document.querySelectorAll('.ws-title')].map((e) => e.textContent)).toEqual(['Clip 4', 'Clip 3', 'Clip 2', 'Clip 1']);
    await click(screen.getByLabelText('Show the results as a list'));
    expect(document.querySelector('.ws-list')).toBeTruthy();
    expect(localStorage.getItem(SEARCH_VIEW_KEY)).toBe('list');
    expect(localStorage.getItem(SEARCH_SORT_KEY)).toBe('longest');
    // A new search opens in the last view and sort.
    await click(screen.getByText('← Watch list'));
    expect(document.querySelector('.ws')).toBeNull();
    await type('other words');
    await click(mainButton());
    expect(search).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.ws-list')).toBeTruthy();
    expect(document.querySelector('.mu-sort')?.textContent).toBe('Sort: Longest');
  });

  it('plays a result on the wall and leaves it playing when the list comes back', async () => {
    card();
    await type('night');
    await click(mainButton());
    await click(document.querySelectorAll('.ws-play')[1]!);
    expect(useWatchStore.getState().playing).toMatchObject({ kind: 'video', id: vid(2).id, label: 'Clip 2' });
    await click(screen.getByText('← Watch list'));
    expect(useWatchStore.getState().playing?.id).toBe(vid(2).id);
    expect(document.querySelector('.w-list')).toBeTruthy();
  });

  it('goes back to the list on Escape and when the box is cleared', async () => {
    card();
    await type('night');
    await click(mainButton());
    expect(document.querySelector('.ws')).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Search or paste a link'), { key: 'Escape' });
    });
    expect(document.querySelector('.ws')).toBeNull();
    await type('night');
    await click(mainButton());
    expect(document.querySelector('.ws')).toBeTruthy();
    await type('');
    expect(document.querySelector('.ws')).toBeNull();
  });

  it('says so when YouTube is not set up, and its button opens Accounts in Tools', async () => {
    mocks.set('wall2_youtube_search', () => {
      throw new Error('not set up');
    });
    card();
    await type('night');
    await click(mainButton());
    expect(document.querySelector('.yt-state')).toBeTruthy();
    expect(useToolsStore.getState().open).toBe(false);
    await click(screen.getByText('Open Tools'));
    expect(useToolsStore.getState().open).toBe(true);
  });

  it('drops an older answer when a new search starts, and the count follows the newest call', async () => {
    const waiting: Array<(page: { items: YtVideo[]; next: null }) => void> = [];
    let done = 0;
    mocks.set('wall2_youtube_search', () => new Promise((resolve) => waiting.push((page) => ((done += 1), resolve(page)))));
    mocks.set('wall2_youtube_status', () => ({ setup: true, signedIn: true, reason: null, searchesLeft: 100 - done }));
    card();
    await type('first words');
    await click(mainButton());
    await type('second words');
    await click(mainButton());
    expect(waiting).toHaveLength(2);
    waiting[1]!({ items: [vid(7)], next: null });
    await flush();
    expect(screen.getByText('1 video')).toBeTruthy();
    expect(screen.getByText('99 searches left today')).toBeTruthy();
    waiting[0]!({ items: [vid(8), vid(9)], next: null });
    await flush();
    expect(screen.getByText('1 video')).toBeTruthy();
    expect(document.querySelector('.ws-title')?.textContent).toBe('Clip 7');
    expect(screen.getByText('98 searches left today')).toBeTruthy();
  });

  it('never saves words as a link: the saved list stays as it was', async () => {
    card();
    const before = localStorage.getItem(SAVED_KEY);
    await type('synthwave night drive');
    await click(mainButton());
    expect(useWatchStore.getState().saved).toHaveLength(1);
    expect(localStorage.getItem(SAVED_KEY)).toBe(before);
    expect(document.querySelector('.w-err')).toBeNull();
  });

  it('shows a short line, and calls nothing, for words over 100 characters', async () => {
    card();
    await type('a'.repeat(101));
    await click(mainButton());
    expect(search).not.toHaveBeenCalled();
    expect(document.querySelector('.w-err')?.textContent).toBe('Searches can be up to 100 characters.');
    expect(document.querySelector('.ws')).toBeNull();
  });

  it('closes the results when a link is saved', async () => {
    card();
    await type('night');
    await click(mainButton());
    expect(document.querySelector('.ws')).toBeTruthy();
    await type('https://youtu.be/Ab3dEfGh1jQ');
    expect(mainButton().textContent).toBe('Save');
    await click(mainButton());
    expect(document.querySelector('.ws')).toBeNull();
    expect(useWatchStore.getState().saved.some((i) => i.id === 'Ab3dEfGh1jQ')).toBe(true);
  });

  it('the plus saves a result to a playlist of the wall', async () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'own', id: 'fridaywind01', label: 'Friday wind down' }]));
    localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: { fridaywind01: { items: [], shuffle: false, repeat: false } } }));
    resetWatch();
    resetOwnLists();
    card();
    await type('night');
    await click(mainButton());
    await click(document.querySelectorAll('.ws-add')[1]!);
    const row = [...document.querySelectorAll('.w-pop-row')].find((r) => r.textContent?.includes('Friday wind down'))!;
    await click(row);
    expect(useOwnLists.getState().lists.fridaywind01?.items.map((i) => i.id)).toEqual([vid(2).id]);
  });
});

describe('the kept view and sort when storage fails', () => {
  it('falls back to grid and Best match when reading throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadView()).toBe('grid');
    expect(loadSort()).toBe('best');
    spy.mockRestore();
  });
  it('still changes the view for the session when writing throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => pickView('list')).not.toThrow();
    expect(useWatchSearch.getState().view).toBe('list');
    spy.mockRestore();
  });
});
