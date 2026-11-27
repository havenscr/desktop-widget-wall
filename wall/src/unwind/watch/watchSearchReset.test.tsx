import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { YtVideo } from '../../music/youtube';
import { useSignalStore } from '../../signals/store';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetYoutubeStatus } from '../ytmusic/status';
import { WatchCard } from './WatchCard';
import { useToolsStore } from '../../tools/store';
import { loadSort, loadView, pickView, resetWatchSearch, useWatchSearch } from './searchStore';
import { SAVED_KEY } from './saved';
import { resetWatch } from './store';

vi.setConfig({ testTimeout: 20_000 });

const vid = (n: number): YtVideo => ({ id: String(n).padStart(11, 'v'), title: `Clip ${n}`, channel: `Channel ${n}`, seconds: 100 * n, thumb: null, playable: 'yes', views: 1000 * (5 - n) });
const FOUND = [vid(1), vid(2), vid(3)];

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
const box = () => screen.getByLabelText('Search or paste a link') as HTMLInputElement;
const type = async (text: string) => {
  await act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
};
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const mainButton = () => document.querySelector('.w-add') as HTMLButtonElement;
const press = async (el: Element, type: 'pointerdown' | 'pointerup' | 'pointercancel', init: { id?: number; x?: number; y?: number; primary?: boolean } = {}) => {
  await act(async () => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: init.x ?? 10, clientY: init.y ?? 10 });
    Object.assign(e, { pointerId: init.id ?? 1, isPrimary: init.primary ?? true });
    fireEvent(el, e);
  });
};
const clickOn = async (el: Element) => {
  await press(el, 'pointerdown');
  await press(el, 'pointerup');
  await act(async () => (el as HTMLElement).click());
};

let search: ReturnType<typeof vi.fn<() => unknown>>;
let page: HTMLElement;
beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' }]));
  resetWatch();
  resetWatchSearch();
  useWatchSearch.setState({ view: loadView(), sort: loadSort() });
  resetYoutubeStatus();
  useToolsStore.setState({ open: false });
  useSignalStore.setState({ call: null });
  search = vi.fn(() => ({ items: FOUND, next: null }));
  mocks.set('wall2_youtube_search', (_args?: unknown) => search());
  mocks.set('wall2_youtube_status', () => ({ setup: true, signedIn: true, reason: null, searchesLeft: 87 }));
  page = document.createElement('div');
  document.body.appendChild(page);
  render(
    <>
      <WatchCard />
      <HoverTipLayer />
    </>,
  );
  await type('night');
  await click(mainButton());
});
afterEach(() => {
  cleanup();
  page.remove();
  vi.useRealTimers();
  mocks.clear();
  resetTip();
  localStorage.clear();
  resetWatchSearch();
});

describe('resetting the Watch search', () => {
  it('shows results to start with', () => {
    expect(document.querySelector('.ws')).not.toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('a click on bare page outside the card ends the search and empties the box', async () => {
    await clickOn(page);
    expect(document.querySelector('.ws')).toBeNull();
    expect(useWatchSearch.getState().open).toBe(false);
    expect(box().value).toBe('');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('hover off the card, or a press with no release, does not reset', async () => {
    const card = document.querySelector('.w-card')!;
    await act(async () => {
      fireEvent.pointerEnter(card);
      fireEvent.pointerLeave(card);
      fireEvent.pointerMove(page);
      fireEvent.mouseOver(page);
    });
    await press(page, 'pointerdown');
    expect(document.querySelector('.ws')).not.toBeNull();
    expect(box().value).toBe('night');
  });

  it('a click inside the card (sort, view, a result, the box) does not reset', async () => {
    await clickOn(document.querySelector('.ws-seg button[aria-label="Show the results as a list"]')!);
    await clickOn(document.querySelector('.ws-play')!);
    await clickOn(box());
    await clickOn(document.querySelector('.ws-bar')!);
    expect(document.querySelector('.ws')).not.toBeNull();
    expect(box().value).toBe('night');
    expect(useWatchSearch.getState().view).toBe('list');
  });

  it('a press inside the card released outside does not reset', async () => {
    await press(box(), 'pointerdown');
    await press(page, 'pointerup');
    expect(document.querySelector('.ws')).not.toBeNull();
  });

  it('the Watch list button resets: box empty, results gone, view kept', async () => {
    pickView('list');
    await click(document.querySelector('.ws-back')!);
    expect(document.querySelector('.ws')).toBeNull();
    expect(box().value).toBe('');
    expect(useWatchSearch.getState().view).toBe('list');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('the box is empty when the card comes back to the watch list by Escape', async () => {
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Escape' });
    });
    expect(document.querySelector('.ws')).toBeNull();
    expect(box().value).toBe('');
  });

  it('opening the Watch tab again starts with no results kept', async () => {
    cleanup();
    expect(useWatchSearch.getState().open).toBe(true);
    render(<WatchCard />);
    await flush();
    expect(useWatchSearch.getState().open).toBe(false);
    expect(document.querySelector('.ws')).toBeNull();
    expect(box().value).toBe('');
  });

  it('Escape clears the typed text, and so does the box emptied by hand', async () => {
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Escape' });
    });
    expect(box().value).toBe('');
    await type('again');
    expect(box().value).toBe('again');
    await type('');
    expect(box().value).toBe('');
  });

  it('a click on a hover detail card, a slider, a tab or a focusable element does not reset', async () => {
    const mk = (html: string) => {
      page.insertAdjacentHTML('beforeend', html);
      return page.lastElementChild!;
    };
    for (const el of [
      mk('<div class="yt-dcard">x</div>'),
      mk('<div role="tooltip">x</div>'),
      mk('<div role="slider"></div>'),
      mk('<div role="switch"></div>'),
      mk('<div role="tab"></div>'),
      mk('<div role="option"></div>'),
      mk('<div role="button"></div>'),
      mk('<div tabindex="0"></div>'),
    ]) {
      await clickOn(el);
      expect(document.querySelector('.ws')).not.toBeNull();
    }
  });

  it('closing the Day drawer by its scrim does not reset', async () => {
    const scrim = document.createElement('div');
    scrim.className = 'drawer-scrim';
    page.appendChild(scrim);
    document.documentElement.setAttribute('data-drawer-open', '');
    try {
      await clickOn(scrim);
      document.documentElement.removeAttribute('data-drawer-open');
      await clickOn(scrim);
    } finally {
      document.documentElement.removeAttribute('data-drawer-open');
    }
    expect(document.querySelector('.ws')).not.toBeNull();
    expect(box().value).toBe('night');
  });

  it('a press while an overlay owns the pointer, released after it closed, does not reset', async () => {
    document.documentElement.setAttribute('data-drawer-open', '');
    await press(page, 'pointerdown');
    document.documentElement.removeAttribute('data-drawer-open');
    await press(page, 'pointerup');
    expect(document.querySelector('.ws')).not.toBeNull();
  });

  it('only the arming pointer resets: another pointer releasing, or a second touch, does not', async () => {
    await press(page, 'pointerdown', { id: 1 });
    await press(page, 'pointerup', { id: 2 });
    expect(document.querySelector('.ws')).not.toBeNull();
    await press(page, 'pointerup', { id: 1 });
    expect(document.querySelector('.ws')).toBeNull();
  });

  it('a secondary touch never arms', async () => {
    await press(page, 'pointerdown', { id: 5, primary: false });
    await press(page, 'pointerup', { id: 5, primary: false });
    expect(document.querySelector('.ws')).not.toBeNull();
  });

  it('a cancelled pointer disarms', async () => {
    await press(page, 'pointerdown', { id: 1 });
    await press(page, 'pointercancel', { id: 1 });
    await press(page, 'pointerup', { id: 1 });
    expect(document.querySelector('.ws')).not.toBeNull();
  });

  it('a drag of more than 8 px does not reset', async () => {
    await press(page, 'pointerdown', { x: 10, y: 10 });
    await press(page, 'pointerup', { x: 40, y: 10 });
    expect(document.querySelector('.ws')).not.toBeNull();
  });

  it('coming back to the Watch view paints the empty default list at once', async () => {
    cleanup();
    expect(useWatchSearch.getState().open).toBe(true);
    render(<WatchCard />);
    // The reset is a layout effect (before paint); the result is the empty default list with the first render's output replaced.
    expect(document.querySelector('.ws')).toBeNull();
    expect(box().value).toBe('');
    expect(useWatchSearch.getState().open).toBe(false);
  });
});
