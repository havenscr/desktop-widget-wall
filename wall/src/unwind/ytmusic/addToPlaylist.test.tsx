import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { type YoutubeStatus, type YtPage, type YtPlayable, type YtPlaylist, type YtVideo } from '../../music/youtube';
import { hideTip, resetTip } from '../../ui/HoverTip';
import ytCss from '../../styles/ytmusic.css?raw';
import { MENU_ROW, MENU_WIDTH, place } from '../watch/AddToPlaylist';
import { OWN_KEY, resetOwnLists, useOwnLists } from '../watch/ownLists';
import { SAVED_KEY } from '../watch/saved';
import { resetWatch, useWatchStore } from '../watch/store';
import { resetListenSource } from '../spotify/model';
import { resetSpotifyStatus } from '../spotify/status';
import { resetQueue } from './queue';
import { resetYoutubeStatus } from './status';
import { resetLibrary, useYtLibrary } from './store';
import { YtMusicSide } from './YtMusicSide';

vi.setConfig({ testTimeout: 20_000 });

const THUMB = (n: number) => `https://i.ytimg.com/vi/${String(n).padStart(11, 'a')}/mqdefault.jpg`;
const playlist = (n: number): YtPlaylist => ({ id: `PLtest${n}`, title: `Mix ${n}`, count: 6, thumb: THUMB(n) });
const video = (n: number, playable: YtPlayable = 'yes', seconds = 200 + n): YtVideo => ({ id: String(n).padStart(11, 'v'), title: `Clip ${n}`, channel: `Channel ${n}`, seconds, thumb: THUMB(n), playable });
const page = <T,>(items: T[], next: string | null = null): YtPage<T> => ({ items, next });
const signedIn: YoutubeStatus = { setup: true, signedIn: true, reason: null, searchesLeft: 100 };
const ownId = (n: number) => `ownlist${String(n).padStart(5, '0')}`;
const OTHER = (n: number) => `other${String(n).padStart(6, '0')}`;

let songs: () => YtVideo[] = () => [video(1), video(2, 'embed'), video(3), video(4, 'private', 0), video(5, 'removed', 0), video(6)];

/** The library with a fake card around it (the menu hangs from `.sp-card`), signed in. */
function serve() {
  mocks.set('wall2_youtube_status', () => signedIn);
  mocks.set('wall2_youtube_playlists', () => page([playlist(1), playlist(2)]));
  mocks.set('wall2_youtube_items', () => page(songs()));
  mocks.set('wall2_youtube_liked', () => page([video(11), video(12, 'embed'), video(13)]));
  mocks.set('wall2_youtube_search', () => page([video(21), video(22)]));
  mocks.set('wall2_youtube_videos', () => []);
  mocks.set('get_now_playing', () => null);
}

/** `lists`: the owner's own playlists by name and the number of videos in each (filler videos, none of the library's). */
function seed(lists: [string, number, string[]?][]) {
  const saved = lists.map(([label], i) => ({ kind: 'own', id: ownId(i), label }));
  const records: Record<string, unknown> = {};
  lists.forEach(([, count, holds], i) => {
    const items = Array.from({ length: count }, (_, k) => ({ id: OTHER(i * 100 + k), title: `Filler ${k}`, channel: 'Filler', seconds: 100 + k }));
    for (const id of holds ?? []) items.push({ id, title: 'Held', channel: 'Held', seconds: 111 });
    records[ownId(i)] = { items, shuffle: false, repeat: false };
  });
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: records }));
  resetWatch();
  resetOwnLists();
}

const side = (tall = false) =>
  render(
    <div className={`sp-card yt${tall ? ' tall' : ''}`}>
      <YtMusicSide tall={tall} remote={null} />
    </div>,
  );
const tile = (name: string) => screen.getByText(name).closest('button') as HTMLButtonElement;
const row = (title: string) => screen.getByText(title, { selector: '.yt-title' }).closest('.yt-row') as HTMLElement;
const addOf = (title: string) => row(title).querySelector('.yt-add') as HTMLButtonElement | null;
const menu = () => screen.queryByRole('menu');
const picks = () => within(screen.getByRole('menu')).getAllByRole('menuitem');
const playing = () => useWatchStore.getState().playing;

/** An opened playlist (Mix 1), its rows read. */
async function opened(tall = false) {
  serve();
  const r = side(tall);
  await screen.findByText('Mix 1');
  fireEvent.click(tile('Mix 1'));
  await screen.findByText('Clip 1');
  return r;
}

beforeEach(() => {
  localStorage.clear();
  songs = () => [video(1), video(2, 'embed'), video(3), video(4, 'private', 0), video(5, 'removed', 0), video(6)];
  resetListenSource();
  resetSpotifyStatus();
  resetYoutubeStatus();
  resetLibrary();
  resetQueue();
  resetWatch();
  resetOwnLists();
});
afterEach(() => {
  cleanup();
  hideTip(true);
  resetTip();
  mocks.clear();
  localStorage.clear();
});

describe('the control on a library row', () => {
  it('is on every row that plays and on no greyed row, in an opened playlist', async () => {
    seed([['Evening', 2]]);
    await opened();
    const rows = [...document.querySelectorAll('.yt-row')] as HTMLElement[];
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(!!r.querySelector('.yt-add')).toBe(!r.classList.contains('off'));
    expect(document.querySelectorAll('.yt-add')).toHaveLength(3);
    const add = addOf('Clip 1')!;
    expect(add.getAttribute('aria-label')).toBe('Add Clip 1 to a playlist');
    expect(add.getAttribute('aria-haspopup')).toBe('menu');
    expect(add.getAttribute('aria-expanded')).toBe('false');
  });

  it('is its own button after the play button, never inside it; a playlist tile has none', async () => {
    seed([['Evening', 2]]);
    serve();
    side();
    await screen.findByText('Mix 1');
    expect(document.querySelector('.yt-tile .yt-add, .yt-grid .yt-add')).toBeNull();
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    const li = row('Clip 1');
    const [play, add] = [...li.querySelectorAll('button')];
    expect(play!.classList.contains('yt-play')).toBe(true);
    expect(add!.classList.contains('yt-add')).toBe(true);
    expect(play!.contains(add!)).toBe(false);
    expect(add!.parentElement).toBe(li);
  });

  it('is on the rows of Liked and of a search answer too', async () => {
    seed([['Evening', 2]]);
    serve();
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await screen.findByText('Clip 11');
    expect(addOf('Clip 11')).not.toBeNull();
    expect(addOf('Clip 12')).toBeNull();
    expect(addOf('Clip 13')).not.toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    await screen.findByText('Clip 21');
    expect(addOf('Clip 21')).not.toBeNull();
    expect(addOf('Clip 22')).not.toBeNull();
  });

  it('a click on it opens the menu and never plays; a click on the rest of the row still plays', async () => {
    seed([['Evening', 2]]);
    await opened();
    fireEvent.click(addOf('Clip 3')!);
    expect(menu()).not.toBeNull();
    expect(addOf('Clip 3')!.getAttribute('aria-expanded')).toBe('true');
    expect(playing()).toBeNull();
    expect(row('Clip 3').classList.contains('menu-open')).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(menu()).toBeNull();
    expect(playing()).toBeNull();
    fireEvent.click(row('Clip 3').querySelector('.yt-play')!);
    expect(playing()?.id).toBe(video(3).id);
  });

  it('opens the Watch menu: the playlists with their counts, then New playlist; the first row has the focus', async () => {
    seed([['Evening', 2], ['Morning', 5]]);
    await opened();
    fireEvent.click(addOf('Clip 1')!);
    const rows = picks();
    expect(rows.map((r) => r.textContent)).toEqual(['Evening2, 2 videos', 'Morning5, 5 videos', 'New playlist']);
    expect(document.activeElement).toBe(rows[0]);
  });
});

describe('adding', () => {
  it('stores the row\'s own title, channel and length for a row of an opened playlist, and the video shows in the playlist', async () => {
    seed([['Evening', 2]]);
    await opened();
    fireEvent.click(addOf('Clip 3')!);
    fireEvent.click(picks()[0]!);
    expect(useOwnLists.getState().lists[ownId(0)]!.items.at(-1)).toEqual({ id: video(3).id, title: 'Clip 3', channel: 'Channel 3', seconds: 203 });
    // The menu stays open with the check; a second click takes the video out again.
    expect(picks()[0]!.querySelector('.w-pop-check')).not.toBeNull();
    fireEvent.click(picks()[0]!);
    expect(useOwnLists.getState().lists[ownId(0)]!.items.some((i) => i.id === video(3).id)).toBe(false);
  });

  it('works for a Liked row and a search result', async () => {
    seed([['Evening', 2]]);
    serve();
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await screen.findByText('Clip 11');
    fireEvent.click(addOf('Clip 11')!);
    fireEvent.click(picks()[0]!);
    fireEvent.keyDown(picks()[0]!, { key: 'Escape' });
    expect(menu()).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    await screen.findByText('Clip 21');
    fireEvent.click(addOf('Clip 21')!);
    fireEvent.click(picks()[0]!);
    const items = useOwnLists.getState().lists[ownId(0)]!.items;
    expect(items.at(-2)).toEqual({ id: video(11).id, title: 'Clip 11', channel: 'Channel 11', seconds: 211 });
    expect(items.at(-1)).toEqual({ id: video(21).id, title: 'Clip 21', channel: 'Channel 21', seconds: 221 });
  });

  it('asks YouTube for nothing when the row already carries its title, channel and length', async () => {
    seed([['Evening', 2]]);
    const read = vi.fn(() => []);
    await opened();
    mocks.set('wall2_youtube_videos', read);
    fireEvent.click(addOf('Clip 1')!);
    fireEvent.click(picks()[0]!);
    await act(async () => void (await Promise.resolve()));
    expect(read).not.toHaveBeenCalled();
  });

  it('marks a playlist that already holds the video with a check', async () => {
    seed([['Evening', 2, [video(1).id]], ['Morning', 3]]);
    await opened();
    fireEvent.click(addOf('Clip 1')!);
    expect(picks()[0]!.className).toContain('has');
    expect(picks()[0]!.querySelector('.w-pop-check')).not.toBeNull();
    expect(picks()[1]!.querySelector('.w-pop-check')).toBeNull();
  });

  it('reads "Full" for a full playlist, in readable text, and adds nothing to it', async () => {
    seed([['Evening', 50], ['Morning', 3]]);
    await opened();
    fireEvent.click(addOf('Clip 1')!);
    const full = picks()[0]!;
    expect(full.getAttribute('aria-disabled')).toBe('true');
    expect(full.classList.contains('full')).toBe(true);
    expect(full.querySelector('em')!.textContent).toBe('Full');
    expect(picks()[1]!.querySelector('em')!.textContent).toBe('3');
    fireEvent.click(full);
    expect(useOwnLists.getState().lists[ownId(0)]!.items).toHaveLength(50);
  });

  it('New playlist makes a playlist with this video in it', async () => {
    seed([]);
    await opened();
    fireEvent.click(addOf('Clip 6')!);
    expect(picks().map((r) => r.textContent)).toEqual(['New playlist']);
    fireEvent.click(picks()[0]!);
    const field = screen.getByLabelText('Name for the new playlist') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Late set' } });
    await act(async () => void fireEvent.submit(field.form!));
    const made = useWatchStore.getState().saved.find((i) => i.kind === 'own' && i.label === 'Late set')!;
    expect(useOwnLists.getState().lists[made.id]!.items).toEqual([{ id: video(6).id, title: 'Clip 6', channel: 'Channel 6', seconds: 206 }]);
    expect(menu()).toBeNull();
  });

  it('shows the line a refused pick gets, and places the limited menu again when the line makes it taller', async () => {
    seed([['Evening', 2]]);
    await opened();
    const add = addOf('Clip 1')!;
    const card = document.querySelector('.sp-card') as HTMLElement;
    const scroller = document.querySelector('.yt-rowscroll') as HTMLElement;
    const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    // The music card at rest, its rows ending at wall y 471, the control at y 225: a 210 high menu fits under it, a 240 high one does not.
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(box(1740, 24, 800, 462));
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(box(1756, 156, 778, 315));
    vi.spyOn(add, 'getBoundingClientRect').mockReturnValue(box(2481, 225, 30, 30));
    Object.defineProperty(card, 'offsetWidth', { configurable: true, value: 800 });
    Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 462 });
    // The menu is 210 high, and 30 more while its refusal line shows.
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('w-pop') ? (this.querySelector('.w-err') ? 240 : 210) : 0;
    });
    try {
      fireEvent.click(add);
      const top = () => (screen.getByRole('menu') as HTMLElement).style.top;
      expect(top()).toBe('237px');
      // A pick that is refused (the playlist filled up under the menu).
      const refusal = 'This playlist is full (50). Remove one first.';
      useOwnLists.setState({ addVideo: () => refusal });
      fireEvent.click(picks()[0]!);
      expect(screen.getByRole('alert').textContent).toBe(`Evening: ${refusal}`);
      // The line made the menu 240 high: it no longer fits under the control inside the rows' foot, so it was placed again (above it, held inside the card).
      expect(top()).toBe('0px');
      expect(useOwnLists.getState().lists[ownId(0)]!.items).toHaveLength(2);
    } finally {
      height.mockRestore();
    }
  });
});

describe('closing', () => {
  it('Escape closes only the menu: the list stays open and the focus returns to the control', async () => {
    seed([['Evening', 2]]);
    await opened();
    const add = addOf('Clip 1')!;
    fireEvent.click(add);
    expect(document.activeElement).toBe(picks()[0]);
    fireEvent.keyDown(picks()[0]!, { key: 'Escape' });
    expect(menu()).toBeNull();
    // The document's Escape (back to Playlists) did not fire as well.
    expect(useYtLibrary.getState().opened?.id).toBe('PLtest1');
    expect(screen.getByText('Clip 1')).toBeTruthy();
    expect(document.activeElement).toBe(add);
    // With no menu open, Escape still goes back.
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByText('Mix 2');
    expect(useYtLibrary.getState().opened).toBeNull();
  });

  it('Escape in the new playlist\'s name field closes that field, not the menu or the list', async () => {
    seed([['Evening', 2]]);
    await opened();
    fireEvent.click(addOf('Clip 1')!);
    fireEvent.click(picks().at(-1)!);
    fireEvent.keyDown(screen.getByLabelText('Name for the new playlist'), { key: 'Escape' });
    expect(menu()).not.toBeNull();
    expect(screen.queryByLabelText('Name for the new playlist')).toBeNull();
    expect(useYtLibrary.getState().opened?.id).toBe('PLtest1');
  });

  it('a click outside closes it and the focus returns to the control', async () => {
    seed([['Evening', 2]]);
    await opened();
    fireEvent.click(addOf('Clip 1')!);
    fireEvent.pointerDown(screen.getByText('Clip 3'));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(addOf('Clip 1'));
  });

  it('closes when the list scrolls', async () => {
    seed([['Evening', 2]]);
    await opened();
    const add = addOf('Clip 1')!;
    fireEvent.click(add);
    fireEvent.scroll(document.querySelector('.yt-rowscroll')!);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it('its own list scrolling never reaches the rows\' scroll listener: the menu is outside the rows scroller', async () => {
    seed([['A', 1], ['B', 1], ['C', 1], ['D', 1], ['E', 1]]);
    await opened();
    fireEvent.click(addOf('Clip 1')!);
    const scroller = document.querySelector('.yt-rowscroll') as HTMLElement;
    // The close-on-scroll listener is on the rows scroller: a menu inside it would be reached by a scroll that bubbles.
    expect(scroller.contains(screen.getByRole('menu'))).toBe(false);
    const list = document.querySelector('.w-pop-rows') as HTMLElement;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(menu()).not.toBeNull();
    // ... while the rows' own scroll does close it.
    fireEvent.scroll(scroller);
    expect(menu()).toBeNull();
  });

  it('closes when the tab changes and when the playlist is left', async () => {
    seed([['Evening', 2]]);
    serve();
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await screen.findByText('Clip 11');
    fireEvent.click(addOf('Clip 11')!);
    expect(menu()).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Playlists' }));
    await screen.findByText('Mix 1');
    expect(menu()).toBeNull();
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    fireEvent.click(addOf('Clip 1')!);
    expect(menu()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Playlists' }));
    await screen.findByText('Mix 2');
    expect(menu()).toBeNull();
  });

  it('closes when its row leaves the list (Refresh read other videos)', async () => {
    seed([['Evening', 2]]);
    await opened();
    fireEvent.click(addOf('Clip 3')!);
    expect(menu()).not.toBeNull();
    songs = () => [video(7), video(8), video(9)];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Clip 7');
    expect(menu()).toBeNull();
  });

  it('stays open when the list grows by a page and its row is where it was', async () => {
    seed([['Evening', 2]]);
    serve();
    mocks.set('wall2_youtube_items', (a) => (a?.pageToken ? page([video(8), video(9)]) : page([video(1), video(3), video(6)], 'p1')));
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    fireEvent.click(addOf('Clip 3')!);
    await act(async () => void useYtLibrary.setState((s) => ({ songs: { ...s.songs, items: [...s.songs.items, video(8)] } })));
    expect(menu()).not.toBeNull();
  });
});

describe('the menu\'s list is capped', () => {
  const rowsBox = () => document.querySelector('.w-pop-rows') as HTMLElement;
  it('shows three playlist rows at rest and scrolls the rest, with five and with nine playlists', async () => {
    for (const n of [5, 9]) {
      seed(Array.from({ length: n }, (_, i) => [`List ${i}`, 1] as [string, number]));
      const r = await opened(false);
      fireEvent.click(addOf('Clip 1')!);
      expect(picks()).toHaveLength(n + 1);
      expect(rowsBox().style.maxHeight).toBe(`${3 * MENU_ROW}px`);
      r.unmount();
      cleanup();
      resetLibrary();
    }
  });

  it('shows four tall', async () => {
    seed(Array.from({ length: 9 }, (_, i) => [`List ${i}`, 1] as [string, number]));
    await opened(true);
    fireEvent.click(addOf('Clip 1')!);
    expect(rowsBox().style.maxHeight).toBe(`${4 * MENU_ROW}px`);
  });
});

describe('the row stays quiet around the control', () => {
  it('the row\'s hover card does not show while the menu is open', async () => {
    vi.useFakeTimers();
    try {
      seed([['Evening', 2]]);
      serve();
      const { HoverTipLayer } = await import('../../ui/HoverTip');
      render(
        <div className="sp-card yt">
          <YtMusicSide tall={false} remote={null} />
          <HoverTipLayer />
        </div>,
      );
      await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
      fireEvent.click(tile('Mix 1'));
      await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
      fireEvent.click(addOf('Clip 1')!);
      fireEvent.mouseEnter(row('Clip 3'));
      fireEvent.focus(row('Clip 3').querySelector('.yt-play')!);
      await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
      expect(document.querySelector('.hover-tip')).toBeNull();
    } finally {
      hideTip(true);
      vi.useRealTimers();
    }
  });

  it('the control has its own card, and the row\'s card does not cover it', async () => {
    vi.useFakeTimers();
    try {
      seed([['Evening', 2]]);
      serve();
      const { HoverTipLayer } = await import('../../ui/HoverTip');
      render(
        <div className="sp-card yt">
          <YtMusicSide tall={false} remote={null} />
          <HoverTipLayer />
        </div>,
      );
      await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
      fireEvent.click(tile('Mix 1'));
      await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
      fireEvent.mouseEnter(row('Clip 1'));
      await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
      expect(document.querySelector('.hover-tip')!.textContent).toContain('Channel 1');
      fireEvent.mouseEnter(addOf('Clip 1')!);
      expect(document.querySelector('.hover-tip')).toBeNull();
      await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
      expect(document.querySelector('.hover-tip')!.textContent).toBe('Add to a playlist');
      // Keyboard focus on the control shows the control's card, not the row's.
      fireEvent.mouseLeave(addOf('Clip 1')!);
      fireEvent.focus(addOf('Clip 1')!);
      await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
      expect(document.querySelector('.hover-tip')!.textContent).toBe('Add to a playlist');
    } finally {
      hideTip(true);
      vi.useRealTimers();
    }
  });
});

// The stylesheet as text: jsdom draws no rules, the fit-check measures the real ones.
describe('the rules in the stylesheet', () => {
  it('shows the control on row hover, on keyboard focus within the row and while its menu is open, in the length\'s place', () => {
    expect(ytCss).toMatch(/\.yt-row:hover > \.yt-add,\s*\.yt-row:has\(:focus-visible\) > \.yt-add,\s*\.yt-row\.menu-open > \.yt-add \{\s*opacity: 1;/);
    expect(ytCss).toMatch(/\.yt-row\.canadd:hover \.yt-len,\s*\.yt-row\.canadd:has\(:focus-visible\) \.yt-len,\s*\.yt-row\.canadd\.menu-open \.yt-len \{\s*opacity: 0;/);
    expect(ytCss).toMatch(/\.yt-add \{[^}]*width: 30px;[^}]*height: 30px;[^}]*opacity: 0;/);
  });
  it('fades over 200 ms and just appears under reduced motion', () => {
    expect(ytCss).toMatch(/\.yt-add \{[^}]*transition: opacity 200ms ease/);
    expect(ytCss).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.yt-add,\s*\.yt-len \{\s*transition: none;/);
  });
});

describe('where the menu opens, with a limit', () => {
  const fake = (rect: { left: number; top: number; width: number; height: number }, extra: Record<string, unknown> = {}) =>
    ({ getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top }), offsetWidth: rect.width, offsetHeight: rect.height, closest: () => null, ...extra }) as unknown as HTMLElement;
  // The music card at rest: 800 by 462 at 1740, 24; its rows end at wall y 471 (the foot of the rows scroller).
  const card = fake({ left: 1740, top: 24, width: 800, height: 462 });
  const rows = fake({ left: 1756, top: 156, width: 778, height: 315 });
  const control = (top: number) => fake({ left: 2481, top, width: 30, height: 30 });

  it('opens under the control when the menu fits above the rows\' foot plus 8 px', () => {
    const at = place(card, control(200), 'anchor', 210, rows);
    expect(at.top).toBeCloseTo(200 + 30 + 6 - 24, 0);
    expect(at.left).toBeCloseTo(2511 - MENU_WIDTH - 1740, 0);
  });

  it('opens upward when it would pass the foot of the rows, even where the card has room below', () => {
    // Without the limit the card (to 486 plus 8) takes a menu ending at 489; with it the foot is 471 plus 8.
    const low = control(243);
    expect(place(card, low, 'anchor', 210).top).toBeCloseTo(243 + 30 + 6 - 24, 0);
    const up = place(card, low, 'anchor', 210, rows);
    expect(up.top).toBeCloseTo(243 - 6 - 210 - 24, 0);
    expect(up.top + 210 + 24).toBeLessThanOrEqual(243 - 6 + 0.5);
  });

  it('a card with a 1 px border: the library\'s menu starts at the padding edge, so its right edge is on the control\'s and it never touches its row', () => {
    const bordered = fake({ left: 1740, top: 24, width: 800, height: 462 }, { clientLeft: 1, clientTop: 1 });
    const at = place(bordered, control(200), 'anchor', 210, rows);
    expect(at.left + 1 + 1740 + MENU_WIDTH).toBeCloseTo(2511, 0);
    expect(at.top + 1 + 24).toBeCloseTo(200 + 30 + 6, 0);
    // Without a limit (Watch) the border is not allowed for: the place stays what it always was.
    const old = place(bordered, control(200), 'anchor', 210);
    expect(old.left + 1740 + MENU_WIDTH).toBeCloseTo(2511, 0);
    expect(old.top + 24).toBeCloseTo(200 + 30 + 6, 0);
  });

  it('without a limit it places as before (Watch\'s rows)', () => {
    const watch = fake({ left: 2000, top: 20, width: 540, height: 312 });
    expect(place(watch, fake({ left: 2400, top: 70, width: 32, height: 32 }), 'anchor', 168).top).toBeCloseTo(102 - 20 + 6, 0);
    expect(place(watch, fake({ left: 2400, top: 230, width: 32, height: 32 }), 'anchor', 168).top + 168).toBeLessThanOrEqual(230 - 20);
    expect(place(watch, fake({ left: 2400, top: 230, width: 32, height: 32 }), 'anchor', 168, null).top).toBe(place(watch, fake({ left: 2400, top: 230, width: 32, height: 32 }), 'anchor', 168).top);
  });
});

describe('storage keys', () => {
  it('the test seeds the keys the stores read', () => {
    seed([['Evening', 1]]);
    expect(useOwnLists.getState().lists[ownId(0)]!.items).toHaveLength(1);
    expect(useWatchStore.getState().saved.map((i) => i.label)).toEqual(['Evening']);
    void waitFor;
  });
});
