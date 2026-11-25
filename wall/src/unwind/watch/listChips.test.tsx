import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { useSignalStore } from '../../signals/store';
import { resetTip } from '../../ui/HoverTip';
import { resetYoutubeStatus } from '../ytmusic/status';
import { WatchCard } from './WatchCard';
import { useToolsStore } from '../../tools/store';
import { resetOwnLists } from './ownLists';
import { closeWatchSearch } from './searchStore';
import { SAVED_KEY } from './saved';
import { resetWatch } from './store';
import { LISTVIEW_KEY, resetListView } from './listViewStore';

vi.setConfig({ testTimeout: 20_000 });

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
const chip = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.w-chip')].find((b) => b.querySelector('.w-chip-name')?.textContent === name)!;
const labels = () => [...document.querySelectorAll('.w-list .w-label')].map((e) => e.textContent);
const count = () => document.querySelector('.u-card-head .u-xs')?.textContent;

const ITEMS = [
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix', tags: ['lofi'], plays: 2, lastPlayedAt: 1_760_000_000_000 },
  { kind: 'live', id: 'Lofi_Live01', label: 'Rain radio', tags: ['lofi', 'sleep'], plays: 7, lastPlayedAt: 1_770_000_000_000 },
  { kind: 'twitch', id: 'pixel_harbor', label: 'Harbor channel' },
  { kind: 'video', id: 'Zz9yXxWw8vU', label: 'Apple orchard', seconds: 600 },
];

function seed(items: unknown[] = ITEMS) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(items));
  resetWatch();
  resetOwnLists();
  resetListView();
  closeWatchSearch();
}

let search: ReturnType<typeof vi.fn<(args?: unknown) => unknown>>;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetYoutubeStatus();
  useToolsStore.setState({ open: false });
  useSignalStore.setState({ call: null });
  search = vi.fn<(args?: unknown) => unknown>(() => ({ items: [], next: null }));
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

describe('the chip row', () => {
  it('shows All, Live, Videos, Playlists, Twitch while one is saved, then tags by use, with counts', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    expect([...document.querySelectorAll('.w-chip')].map((b) => b.textContent)).toEqual(['All4', 'Live1', 'Videos2', 'Playlists0', 'Twitch1', '#lofi2', '#sleep1']);
    expect(count()).toBe('4 saved');
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');
  });
  it('has no Twitch chip without a Twitch channel and no chip row on the empty card', async () => {
    seed(ITEMS.slice(0, 2));
    render(<WatchCard />);
    await flush();
    expect(chip('Twitch')).toBeUndefined();
    cleanup();
    seed([]);
    render(<WatchCard />);
    await flush();
    expect(document.querySelector('.w-chiprow')).toBeNull();
  });
  it('a chip narrows the list and the count reads "n of total"', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    await click(chip('Videos'));
    expect(labels()).toEqual(['Night drive mix', 'Apple orchard']);
    expect(count()).toBe('2 of 4');
    await click(chip('#lofi'));
    expect(labels()).toEqual(['Night drive mix', 'Rain radio']);
    await click(chip('All'));
    expect(count()).toBe('4 saved');
  });
  it('says so when a chip holds nothing', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    await click(chip('Playlists'));
    expect(labels()).toEqual([]);
    expect(screen.getByRole('status').textContent).toBe('Nothing saved under this chip.');
  });
  it('keeps the choice for this viewer and reads it back', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    await click(chip('Live'));
    expect(JSON.parse(localStorage.getItem(LISTVIEW_KEY)!)).toEqual({ chip: 'live', sort: 'recent' });
    cleanup();
    resetListView();
    render(<WatchCard />);
    await flush();
    expect(labels()).toEqual(['Rain radio']);
  });
  it('falls back to All when the chosen tag is gone', async () => {
    localStorage.setItem(LISTVIEW_KEY, JSON.stringify({ chip: 'tag:gone', sort: 'recent' }));
    seed();
    render(<WatchCard />);
    await flush();
    expect(labels()).toHaveLength(4);
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the sort chip', () => {
  it('opens a listbox of six orders, marks the current one and reorders the list', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    const button = document.querySelector('.w-sortchip') as HTMLButtonElement;
    expect(button.textContent).toBe('Recent');
    await click(button);
    const opts = [...document.querySelectorAll('.w-sortmenu [role="option"]')];
    expect(opts.map((o) => o.textContent)).toEqual(['Recent', 'Last played', 'Most played', 'Name, A to Z', 'Longest first', 'Most viewed']);
    expect(opts.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    await click(opts[2]!);
    expect(document.querySelector('.w-sortmenu')).toBeNull();
    expect(labels()).toEqual(['Rain radio', 'Night drive mix', 'Harbor channel', 'Apple orchard']);
    expect((document.querySelector('.w-sortchip') as HTMLElement).textContent).toBe('Plays');
    expect(JSON.parse(localStorage.getItem(LISTVIEW_KEY)!).sort).toBe('plays');
  });
  it('Escape closes the menu and hands the focus back to the chip', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    const button = document.querySelector('.w-sortchip') as HTMLButtonElement;
    await click(button);
    const menu = document.querySelector('.w-sortmenu') as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(menu, { key: 'Escape' });
    });
    expect(document.querySelector('.w-sortmenu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('typing in the field', () => {
  it('filters the list as words are typed and reads "n of total"', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    await type('rain');
    expect(labels()).toEqual(['Rain radio']);
    expect(count()).toBe('1 of 4');
    await type('#sleep');
    expect(labels()).toEqual(['Rain radio']);
    await type('zzz');
    expect(screen.getByRole('status').textContent).toBe('Nothing in the list matches those words.');
    await type('');
    expect(labels()).toHaveLength(4);
    expect(count()).toBe('4 saved');
  });
  it('Enter still searches YouTube with the words typed', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    await type('rain');
    await act(async () => {
      fireEvent.submit(document.querySelector('.w-field')!);
    });
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('a link is never a filter and still saves', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    await type('https://youtu.be/Qk3mPz7aXy1');
    expect(labels()).toHaveLength(4);
    await act(async () => {
      fireEvent.submit(document.querySelector('.w-field')!);
    });
    await flush();
    expect(search).not.toHaveBeenCalled();
    expect(count()).toBe('5 saved');
  });
});
