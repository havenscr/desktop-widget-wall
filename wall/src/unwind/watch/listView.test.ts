import { describe, expect, it } from 'vitest';
import { chipCounts, chipExists, countLine, filterItems, isChip, isSort, sortItems, tagChip, wordsOf } from './listView';
import { LISTVIEW_KEY, parseListView } from './listViewStore';
import type { SavedItem } from './saved';

const V = (n: number, extra: Partial<SavedItem> = {}): SavedItem => ({ kind: 'video', id: `Vid${String(n).padStart(8, '0')}`, label: `Video ${n}`, ...extra });
const ITEMS: SavedItem[] = [
  V(1, { tags: ['lofi', 'Focus'], plays: 3, lastPlayedAt: 1_700_000_000_000, seconds: 300, views: 50 }),
  { kind: 'live', id: 'Lofi_Live01', label: 'Rain radio', tags: ['lofi'], plays: 9, lastPlayedAt: 1_800_000_000_000 },
  { kind: 'playlist', id: 'PLmockPlaylist0001', label: 'Weekend list' },
  { kind: 'own', id: 'abcdefghijkl', label: 'Mine', named: true, tags: ['focus'] },
  { kind: 'twitch', id: 'pixel_harbor', label: 'Harbor channel' },
  V(2, { label: 'apple video', seconds: 900, views: 5000 }),
  V(3, { label: 'Zebra video', plays: 3, lastPlayedAt: 1_750_000_000_000, seconds: 900 }),
];

describe('chipCounts', () => {
  it('counts each kind, own and YouTube playlists together, and tags by use', () => {
    const c = chipCounts(ITEMS);
    expect(c).toMatchObject({ all: 7, live: 1, video: 3, playlist: 2, twitch: 1 });
    expect(c.tags.map((t) => [t.name, t.count])).toEqual([['Focus', 2], ['lofi', 2]]);
    expect(c.tags[0]!.chip).toBe('tag:focus');
  });
  it('merges tags that differ only in case, keeping the first spelling', () => {
    const c = chipCounts([V(1, { tags: ['Focus'] }), V(2, { tags: ['focus'] })]);
    expect(c.tags).toEqual([{ chip: 'tag:focus', name: 'Focus', count: 2 }]);
  });
  it('has no Twitch chip meaning without one, and drops a tag nobody has', () => {
    const c = chipCounts([V(1)]);
    expect(chipExists(c, 'twitch')).toBe(false);
    expect(chipExists(c, 'live')).toBe(true);
    expect(chipExists(c, tagChip('lofi'))).toBe(false);
    expect(chipExists(c, 'all')).toBe(true);
  });
});

describe('filterItems', () => {
  const ids = (xs: SavedItem[]) => xs.map((i) => i.label);
  it('All keeps everything in stored order', () => {
    expect(filterItems(ITEMS, 'all', '')).toEqual(ITEMS);
  });
  it('each kind chip keeps its kind', () => {
    expect(ids(filterItems(ITEMS, 'live', ''))).toEqual(['Rain radio']);
    expect(ids(filterItems(ITEMS, 'video', ''))).toEqual(['Video 1', 'apple video', 'Zebra video']);
    expect(ids(filterItems(ITEMS, 'playlist', ''))).toEqual(['Weekend list', 'Mine']);
    expect(ids(filterItems(ITEMS, 'twitch', ''))).toEqual(['Harbor channel']);
  });
  it('a tag chip keeps the items with that tag, in any case', () => {
    expect(ids(filterItems(ITEMS, 'tag:focus', ''))).toEqual(['Video 1', 'Mine']);
    expect(ids(filterItems(ITEMS, 'tag:lofi', ''))).toEqual(['Video 1', 'Rain radio']);
  });
  it('typed words filter by label, tag and kind, every word needed, any case', () => {
    expect(ids(filterItems(ITEMS, 'all', 'RAIN'))).toEqual(['Rain radio']);
    expect(ids(filterItems(ITEMS, 'all', '#lofi'))).toEqual(['Video 1', 'Rain radio']);
    expect(ids(filterItems(ITEMS, 'all', 'lofi live'))).toEqual(['Rain radio']);
    expect(ids(filterItems(ITEMS, 'all', 'twitch'))).toEqual(['Harbor channel']);
    expect(filterItems(ITEMS, 'all', 'nothing like this')).toEqual([]);
  });
  it('a chip and words work together', () => {
    expect(ids(filterItems(ITEMS, 'video', 'zebra'))).toEqual(['Zebra video']);
    expect(filterItems(ITEMS, 'live', 'zebra')).toEqual([]);
  });
  it('keeps the item whose key is asked for whatever the filter says', () => {
    expect(ids(filterItems(ITEMS, 'live', '', 'twitch:pixel_harbor'))).toEqual(['Rain radio', 'Harbor channel']);
  });
  it('wordsOf drops empty words and leading #', () => {
    expect(wordsOf('  #Lofi   mix ## ')).toEqual(['lofi', 'mix']);
  });
});

describe('sortItems', () => {
  const ids = (xs: SavedItem[]) => xs.map((i) => i.label);
  it('Recent is the stored order', () => {
    expect(sortItems(ITEMS, 'recent')).toEqual(ITEMS);
  });
  it('Last played: newest first, never played last in stored order', () => {
    expect(ids(sortItems(ITEMS, 'played'))).toEqual(['Rain radio', 'Zebra video', 'Video 1', 'Weekend list', 'Mine', 'Harbor channel', 'apple video']);
  });
  it('Most played: more first, a tie keeps stored order, none last', () => {
    expect(ids(sortItems(ITEMS, 'plays')).slice(0, 3)).toEqual(['Rain radio', 'Video 1', 'Zebra video']);
    expect(ids(sortItems(ITEMS, 'plays')).slice(3)).toEqual(['Weekend list', 'Mine', 'Harbor channel', 'apple video']);
  });
  it('Name: A to Z without regard to case, numbers by value', () => {
    const items = [V(1, { label: 'item 10' }), V(2, { label: 'Item 9' }), V(3, { label: 'banana' }), V(4, { label: 'Apple' })];
    expect(ids(sortItems(items, 'name'))).toEqual(['Apple', 'banana', 'Item 9', 'item 10']);
  });
  it('Longest: more seconds first, a tie keeps stored order, no length last', () => {
    expect(ids(sortItems(ITEMS, 'longest'))).toEqual(['apple video', 'Zebra video', 'Video 1', 'Rain radio', 'Weekend list', 'Mine', 'Harbor channel']);
  });
  it('Most viewed: more views first, none last', () => {
    expect(ids(sortItems(ITEMS, 'views')).slice(0, 2)).toEqual(['apple video', 'Video 1']);
    expect(ids(sortItems(ITEMS, 'views')).slice(2)).toEqual(['Rain radio', 'Weekend list', 'Mine', 'Harbor channel', 'Zebra video']);
  });
  it('does not change the list it was given', () => {
    const copy = [...ITEMS];
    sortItems(ITEMS, 'name');
    expect(ITEMS).toEqual(copy);
  });
});

describe('the count line and the kept choice', () => {
  it('reads "62 saved", or "7 of 62" while narrowed', () => {
    expect(countLine(62, 62, false)).toBe('62 saved');
    expect(countLine(7, 62, true)).toBe('7 of 62');
  });
  it('knows its chips and sorts', () => {
    for (const c of ['all', 'live', 'video', 'playlist', 'twitch', 'tag:lofi']) expect(isChip(c)).toBe(true);
    for (const c of ['', 'tag:', 'tag:Lofi', 'tag:#x', 'other', 5, null]) expect(isChip(c)).toBe(false);
    expect(isSort('plays')).toBe(true);
    expect(isSort('best')).toBe(false);
  });
  it('reads a kept choice field by field and falls back to All and Recent', () => {
    expect(LISTVIEW_KEY).toBe('wall2-watch-listview');
    expect(parseListView(JSON.stringify({ chip: 'tag:lofi', sort: 'views' }))).toEqual({ chip: 'tag:lofi', sort: 'views' });
    expect(parseListView(JSON.stringify({ chip: 'bad', sort: 'views' }))).toEqual({ chip: 'all', sort: 'views' });
    expect(parseListView(JSON.stringify({ chip: 'live', sort: 7 }))).toEqual({ chip: 'live', sort: 'recent' });
    for (const raw of [null, '', 'not json', '5', 'null']) expect(parseListView(raw)).toEqual({ chip: 'all', sort: 'recent' });
  });
});
