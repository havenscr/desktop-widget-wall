import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { YoutubeStatus, YtPage, YtPlaylist, YtVideo } from '../../music/youtube';
import { resetTools } from '../../tools/store';
import { hideTip, resetTip } from '../../ui/HoverTip';
import { resetListenSource } from '../spotify/model';
import { resetSpotifyStatus } from '../spotify/status';
import { DETAIL_CARD_MS, DEFAULT_SORT, compactCount, detailWords, rowThumb, sortVideos, uploadMonth } from './model';
import { resetQueue, useYtQueue } from './queue';
import { resetYoutubeStatus } from './status';
import { resetLibrary, useYtLibrary } from './store';
import { YtMusicSide } from './YtMusicSide';

vi.setConfig({ testTimeout: 20_000 });

const THUMB = (n: number) => `https://i.ytimg.com/vi/${String(n).padStart(11, 'a')}/mqdefault.jpg`;
const vid = (n: number, extra: Partial<YtVideo> = {}): YtVideo => ({ id: String(n).padStart(11, 'v'), title: `Clip ${n}`, channel: `Channel ${n}`, seconds: 100, thumb: THUMB(n), playable: 'yes', ...extra });
const titles = (list: YtVideo[]) => list.map((v) => v.title);

describe('compact counts and upload months', () => {
  it('shortens a count to at most four characters, cutting rather than rounding up', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(900)).toBe('900');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1000)).toBe('1K');
    expect(compactCount(1500)).toBe('1.5K');
    expect(compactCount(9999)).toBe('9.9K');
    expect(compactCount(10_000)).toBe('10K');
    expect(compactCount(87_300)).toBe('87K');
    expect(compactCount(999_999)).toBe('999K');
    expect(compactCount(1_000_000)).toBe('1M');
    expect(compactCount(2_450_000)).toBe('2.4M');
    expect(compactCount(312_000)).toBe('312K');
    expect(compactCount(4_800_000_000)).toBe('4.8B');
  });
  it('says nothing for a missing or bad count', () => {
    for (const bad of [null, undefined, NaN, -5, Infinity]) expect(compactCount(bad as number | null)).toBe('');
  });
  it('writes the upload month as "Mar 2023", and nothing for anything else', () => {
    expect(uploadMonth('2023-03-14')).toBe('Mar 2023');
    expect(uploadMonth('2019-12-01')).toBe('Dec 2019');
    for (const bad of [null, undefined, '', 'soon', '2023-13-01', '2023-00-01']) expect(uploadMonth(bad)).toBe('');
  });
});

describe('sorting the answer', () => {
  const list = [
    vid(1, { title: 'Delta', channel: 'beta', seconds: 300, views: 50 }),
    vid(2, { title: 'alpha', channel: 'Zed', seconds: 0, views: null }),
    vid(3, { title: 'Charlie', channel: 'Alpha', seconds: 120, views: 9000 }),
    vid(4, { title: 'Bravo', channel: '', seconds: 600, views: 9000 }),
    vid(5, { title: 'Echo', channel: 'beta', seconds: 120 }),
  ];
  it('Best match is the answer as it came, as a new list', () => {
    const out = sortVideos(list, 'best');
    expect(titles(out)).toEqual(titles(list));
    expect(out).not.toBe(list);
  });
  it('Most viewed puts the most first, ties in the answer order, and rows with no views last', () => {
    expect(titles(sortVideos(list, 'views'))).toEqual(['Charlie', 'Bravo', 'Delta', 'alpha', 'Echo']);
  });
  it('Longest and Shortest put a row with no length last in both', () => {
    expect(titles(sortVideos(list, 'longest'))).toEqual(['Bravo', 'Delta', 'Charlie', 'Echo', 'alpha']);
    expect(titles(sortVideos(list, 'shortest'))).toEqual(['Charlie', 'Echo', 'Delta', 'Bravo', 'alpha']);
  });
  it('Channel and Title are A to Z whatever the case, with an empty channel last', () => {
    expect(titles(sortVideos(list, 'channel'))).toEqual(['Charlie', 'Delta', 'Echo', 'alpha', 'Bravo']);
    expect(titles(sortVideos(list, 'title'))).toEqual(['alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
  });
  it('never changes the list it was given', () => {
    const before = titles(list);
    for (const s of ['views', 'longest', 'shortest', 'channel', 'title'] as const) sortVideos(list, s);
    expect(titles(list)).toEqual(before);
  });
});

describe('a result row picture and its details words', () => {
  it('uses the picture from YouTube, else the address built from a checked id, else none', () => {
    expect(rowThumb({ id: vid(1).id, thumb: THUMB(7) })).toBe(THUMB(7));
    expect(rowThumb({ id: 'abcdefghijk', thumb: null })).toBe('https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
    expect(rowThumb({ id: 'abcdefghijk', thumb: 'https://evil.example/x.jpg' })).toBe('https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
    expect(rowThumb({ id: 'not a video id', thumb: 'https://evil.example/x.jpg' })).toBeNull();
  });
  it('has details words only when the row carries something beyond title and channel', () => {
    expect(detailWords(vid(1))).toBeNull();
    const w = detailWords(vid(1, { views: 2_400_000, likes: 61_000, seconds: 3760, published: '2023-03-14', description: 'First line' }));
    expect(w).toEqual({ views: '2.4M', likes: '61K', length: '1:02:40', month: 'Mar 2023', description: 'First line' });
    expect(detailWords(vid(1, { views: 5, likes: null }))?.likes).toBe('');
  });
  it('cuts the description by characters, never leaving half of an emoji', () => {
    const w = detailWords(vid(1, { description: `${'a'.repeat(599)}\u{1F600}tail` }));
    expect(Array.from(w!.description)).toHaveLength(600);
    expect(w!.description.endsWith('\u{1F600}')).toBe(true);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(w!.description)).toBe(false);
  });
});

const signedIn: YoutubeStatus = { setup: true, signedIn: true, reason: null, searchesLeft: 100 };
const page = <T,>(items: T[]): YtPage<T> => ({ items, next: null });
const playlist = (n: number): YtPlaylist => ({ id: `PLtest${n}`, title: `Mix ${n}`, count: 5, thumb: THUMB(n) });
const found = [
  vid(21, { title: 'Clip 21', channel: 'Mira', seconds: 214, views: 2_400_000, likes: 58_000, published: '2023-03-14', description: 'One\nTwo\nThree\nFour' }),
  vid(22, { title: 'Clip 22', channel: 'Aurora', seconds: 3724, views: 87_000, likes: null, published: '2021-07-02', description: 'A long set.' }),
  vid(23, { title: 'Clip 23', channel: 'Juno', seconds: 0, views: null }),
  vid(24, { title: 'Clip 24', channel: 'Cora', seconds: 95, views: 900, thumb: null }),
];
let searches = 0;
function serve() {
  searches = 0;
  mocks.set('wall2_youtube_status', () => signedIn);
  mocks.set('wall2_youtube_playlists', () => page([playlist(1)]));
  mocks.set('wall2_youtube_liked', () => page([]));
  mocks.set('wall2_youtube_items', () => page([]));
  mocks.set('wall2_youtube_search', () => {
    searches += 1;
    return page(found);
  });
  mocks.set('get_now_playing', () => null);
}
const side = () =>
  render(
    <div className="sp-card yt">
      <YtMusicSide tall={false} remote={null} />
    </div>,
  );
const rowTitles = () => [...document.querySelectorAll('.yt-row .yt-title')].map((e) => e.textContent);
const run = async (words: string) => {
  const field = screen.getByPlaceholderText('Search YouTube Music');
  fireEvent.change(field, { target: { value: words } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await screen.findByText('Clip 21');
};
const sortButton = () => screen.getByRole('button', { name: /^Sort results/ });
const pickSort = (label: string) => {
  fireEvent.click(sortButton());
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Sort results' })).getByRole('option', { name: new RegExp(label) }));
};

beforeEach(() => {
  resetListenSource();
  resetSpotifyStatus();
  resetYoutubeStatus();
  resetTools();
  resetLibrary();
  resetQueue();
  serve();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  hideTip(true);
  resetTip();
  mocks.clear();
});

describe('the sort button on the chip row', () => {
  it('sits left of Library, outside the chip group, with a hover card, and shows the six choices', async () => {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    const chips = document.querySelector('.mu-chips') as HTMLElement;
    const group = within(chips).getByRole('radiogroup', { name: 'Show' });
    expect(group.contains(sortButton())).toBe(false);
    expect(sortButton().compareDocumentPosition(within(chips).getByRole('button', { name: 'Library' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sortButton().textContent).toBe('');
    fireEvent.click(sortButton());
    const options = within(screen.getByRole('listbox', { name: 'Sort results' })).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Best match', 'Most viewed', 'Longest first', 'Shortest first', 'Channel, A to Z', 'Title, A to Z']);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('picking Longest reorders the rows, shows its short name in cyan, and searches nothing again', async () => {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    expect(rowTitles()).toEqual(['Clip 21', 'Clip 22', 'Clip 23', 'Clip 24']);
    pickSort('Longest');
    expect(rowTitles()).toEqual(['Clip 22', 'Clip 21', 'Clip 24', 'Clip 23']);
    expect(sortButton().textContent).toBe('Longest');
    expect(sortButton().classList.contains('on')).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(searches).toBe(1);
    pickSort('Most viewed');
    expect(rowTitles()).toEqual(['Clip 21', 'Clip 22', 'Clip 24', 'Clip 23']);
    pickSort('Best match');
    expect(rowTitles()).toEqual(['Clip 21', 'Clip 22', 'Clip 23', 'Clip 24']);
    expect(sortButton().classList.contains('on')).toBe(false);
    expect(searches).toBe(1);
  });

  it('Best match comes back with every new search', async () => {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    pickSort('Title');
    expect(useYtLibrary.getState().sort).toBe('title');
    await run('day');
    expect(useYtLibrary.getState().sort).toBe(DEFAULT_SORT);
    expect(sortButton().classList.contains('on')).toBe(false);
  });

  it('plays the row it shows: a click on the first sorted row starts the sorted order', async () => {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    pickSort('Shortest');
    expect(rowTitles()[0]).toBe('Clip 24');
    expect(screen.getByRole('button', { name: 'Play Clip 24' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play Clip 24' }));
    const q = useYtQueue.getState();
    expect(q.entries.map((e) => e.id)).toEqual([found[3]!, found[0]!, found[1]!, found[2]!].map((v) => v.id));
    expect(q.pos).toBe(0);
    expect(q.entries[q.pos]!.id).toBe(found[3]!.id);
  });

  it('keeps the playing mark on the row that plays when a sort moves it', async () => {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    fireEvent.click(screen.getByRole('button', { name: 'Play Clip 22' }));
    const marked = () => [...document.querySelectorAll('.yt-row.on .yt-title')].map((e) => e.textContent);
    expect(marked()).toEqual(['Clip 22']);
    pickSort('Shortest');
    expect(rowTitles()).toEqual(['Clip 24', 'Clip 21', 'Clip 22', 'Clip 23']);
    expect(marked()).toEqual(['Clip 22']);
    pickSort('Channel');
    expect(marked()).toEqual(['Clip 22']);
  });

  it('has the listbox keys: arrows move, Enter picks, Escape closes and hands focus back', async () => {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    fireEvent.click(sortButton());
    const box = screen.getByRole('listbox', { name: 'Sort results' });
    const options = within(box).getAllByRole('option');
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[5]);
    fireEvent.keyDown(box, { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(sortButton());
    fireEvent.click(sortButton());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is not on the Playlists chip, which shows tiles', async () => {
    mocks.set('wall2_youtube_search_playlists', () => ({ playlists: [playlist(2)], searchesLeft: 9 }));
    side();
    await screen.findByText('Mix 1');
    await run('night');
    fireEvent.click(screen.getByRole('radio', { name: /^Playlists/ }));
    expect(screen.queryByRole('button', { name: /^Sort results/ })).toBeNull();
  });
});

describe('a search result row', () => {
  it('has the picture in place of the number, the views in their own column before the length, and none for a row without views', async () => {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    const rows = [...document.querySelectorAll('.yt-row')] as HTMLElement[];
    expect(document.querySelector('.yt-num')).toBeNull();
    const src = (r: HTMLElement) => r.querySelector('.yt-rowthumb img')?.getAttribute('src');
    expect(src(rows[0]!)).toBe(THUMB(21));
    // No picture sent: the address is built from the checked id.
    expect(src(rows[3]!)).toBe(`https://i.ytimg.com/vi/${found[3]!.id}/mqdefault.jpg`);
    const cells = (r: HTMLElement) => [...r.querySelectorAll('.yt-cells > span')].map((e) => e.className.split(' ')[0]);
    expect(cells(rows[0]!)).toEqual(['yt-n', 'yt-title', 'yt-chan', 'yt-views', 'yt-len']);
    expect(rows.map((r) => r.querySelector('.yt-views')?.textContent)).toEqual(['2.4M', '87K', '', '900']);
    expect(rows[0]!.querySelector('.yt-len')?.textContent).toBe('3:34');
  });

  it('library rows outside a search keep their number and have no views column', async () => {
    mocks.set('wall2_youtube_liked', () => page([vid(11, { views: 5000 })]));
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(screen.getByText('Liked'));
    await screen.findByText('Clip 11');
    expect(document.querySelector('.yt-num')?.textContent).toBe('1');
    expect(document.querySelector('.yt-views')).toBeNull();
    expect(document.querySelector('.yt-rowthumb')).toBeNull();
  });
});

describe('the details card', () => {
  const rowOf = (title: string) => screen.getByText(title, { selector: '.yt-title' }).closest('.yt-row') as HTMLElement;
  const card = () => document.querySelector('[data-detail-card]') as HTMLElement | null;
  async function ready() {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    vi.useFakeTimers();
  }

  it('shows after the pointer rests half a second, with the details, and goes when the pointer leaves', async () => {
    await ready();
    fireEvent.mouseEnter(rowOf('Clip 21'));
    act(() => void vi.advanceTimersByTime(DETAIL_CARD_MS - 1));
    expect(card()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    const c = card()!;
    expect(c).toBeTruthy();
    expect(document.querySelector('.sp-card')!.contains(c)).toBe(true);
    expect(c.querySelector('img')?.getAttribute('src')).toBe(THUMB(21));
    expect(c.querySelector('.yt-dcard-title')?.textContent).toBe('Clip 21');
    const facts = c.querySelector('.yt-dcard-facts')!.textContent;
    for (const word of ['Mira', '2.4M views', '58K', '3:34', 'Mar 2023']) expect(facts).toContain(word);
    expect(c.querySelector('.yt-dcard-desc')?.textContent).toBe('One\nTwo\nThree\nFour');
    fireEvent.mouseLeave(rowOf('Clip 21'));
    expect(card()).toBeNull();
  });

  it('leaving before half a second shows nothing, and a hidden like count leaves that fact out', async () => {
    await ready();
    fireEvent.mouseEnter(rowOf('Clip 22'));
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.mouseLeave(rowOf('Clip 22'));
    act(() => void vi.advanceTimersByTime(1000));
    expect(card()).toBeNull();
    fireEvent.mouseEnter(rowOf('Clip 22'));
    act(() => void vi.advanceTimersByTime(DETAIL_CARD_MS));
    expect(card()!.querySelector('.yt-dcard-facts')!.querySelectorAll('span')).toHaveLength(4);
    expect(card()!.querySelector('.yt-dcard-facts')!.textContent).toContain('Jul 2021');
  });

  it('a wait begun on rows that then change order shows nothing', async () => {
    await ready();
    fireEvent.mouseEnter(rowOf('Clip 21'));
    act(() => void vi.advanceTimersByTime(300));
    pickSort('Most viewed');
    expect(rowTitles()).toEqual(['Clip 21', 'Clip 22', 'Clip 24', 'Clip 23']);
    act(() => void vi.advanceTimersByTime(2000));
    expect(card()).toBeNull();
  });

  it('is never wider or taller than the music card less its edges', async () => {
    side();
    await screen.findByText('Mix 1');
    await run('night');
    const host = document.querySelector('.sp-card') as HTMLElement;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 200 });
    vi.useFakeTimers();
    fireEvent.mouseEnter(rowOf('Clip 21'));
    act(() => void vi.advanceTimersByTime(DETAIL_CARD_MS));
    expect(card()!.style.width).toBe('276px');
    expect(card()!.style.maxHeight).toBe('176px');
    expect(card()!.style.overflow).toBe('hidden');
  });

  it('the review knob opens the card of a row once the results show', async () => {
    window.history.replaceState(null, '', '/?ytcard=1');
    try {
      side();
      await screen.findByText('Mix 1');
      await run('night');
      expect(card()?.querySelector('.yt-dcard-title')?.textContent).toBe('Clip 22');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('a row with nothing but title, channel and length has no card', async () => {
    await ready();
    fireEvent.mouseEnter(rowOf('Clip 23'));
    act(() => void vi.advanceTimersByTime(2000));
    expect(card()).toBeNull();
  });

  it('closes on a press on the row and on a scroll of the list', async () => {
    await ready();
    fireEvent.mouseEnter(rowOf('Clip 21'));
    act(() => void vi.advanceTimersByTime(DETAIL_CARD_MS));
    expect(card()).toBeTruthy();
    fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement);
    expect(card()).toBeNull();
    fireEvent.mouseEnter(rowOf('Clip 21'));
    act(() => void vi.advanceTimersByTime(DETAIL_CARD_MS));
    expect(card()).toBeTruthy();
    fireEvent.mouseDown(rowOf('Clip 21'));
    expect(card()).toBeNull();
  });
});
