import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { YtVideo } from '../../music/youtube';
import { useSignalStore } from '../../signals/store';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetYoutubeStatus } from '../ytmusic/status';
import { WatchCard } from './WatchCard';
import { SEARCH_SORT_KEY, SEARCH_VIEW_KEY, closeWatchSearch, isLinkText, loadSort, loadView, useWatchSearch } from './searchStore';
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
  it('reads a scheme or a dotted name as a link and plain words as a search', () => {
    expect(isLinkText('https://www.youtube.com/watch?v=Ab3dEfGh1jK')).toBe(true);
    expect(isLinkText('youtu.be/Ab3dEfGh1jK')).toBe(true);
    expect(isLinkText('https://example.com/x')).toBe(true);
    expect(isLinkText('synthwave night drive')).toBe(false);
    expect(isLinkText('lofi')).toBe(false);
    expect(isLinkText('')).toBe(false);
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

  it('says so when YouTube is not set up, and offers a way on', async () => {
    mocks.set('wall2_youtube_search', () => {
      throw new Error('not set up');
    });
    card();
    await type('night');
    await click(mainButton());
    expect(document.querySelector('.yt-state')).toBeTruthy();
  });
});
