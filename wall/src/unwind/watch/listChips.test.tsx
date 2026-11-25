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

describe('a chip that is gone', () => {
  it('is forgotten, so a tag made again later does not filter the list', async () => {
    localStorage.setItem(LISTVIEW_KEY, JSON.stringify({ chip: 'tag:gone', sort: 'recent' }));
    seed();
    render(<WatchCard />);
    await flush();
    expect(JSON.parse(localStorage.getItem(LISTVIEW_KEY)!).chip).toBe('all');
    cleanup();
    seed([...ITEMS, { kind: 'video', id: 'Qq1wWe2rTy3', label: 'Fresh', tags: ['gone'] }]);
    render(<WatchCard />);
    await flush();
    expect(labels()).toHaveLength(5);
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');
  });
  it('a chip label reads its name and count', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    expect(chip('Live').getAttribute('aria-label')).toBe('Live, 1');
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

describe('the sort menu by keyboard and touch', () => {
  const open = async () => {
    seed();
    render(<WatchCard />);
    await flush();
    const button = document.querySelector('.w-sortchip') as HTMLButtonElement;
    await click(button);
    const menu = document.querySelector('.w-sortmenu') as HTMLElement;
    const opts = () => [...document.querySelectorAll<HTMLElement>('.w-sortmenu [role="option"]')];
    const key = async (k: string) => {
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? menu, { key: k });
      });
    };
    return { button, opts, key };
  };
  it('opens on the current order and the arrows, Home and End move and wrap', async () => {
    const { opts, key } = await open();
    expect(document.activeElement).toBe(opts()[0]);
    await key('ArrowDown');
    expect(document.activeElement).toBe(opts()[1]);
    await key('ArrowUp');
    await key('ArrowUp');
    expect(document.activeElement).toBe(opts()[5]);
    await key('Home');
    expect(document.activeElement).toBe(opts()[0]);
    await key('End');
    expect(document.activeElement).toBe(opts()[5]);
  });
  it('a pick (what Enter and Space do on a button) sorts, closes and returns the focus', async () => {
    const { button, opts, key } = await open();
    await key('ArrowDown');
    await click(document.activeElement!);
    expect(document.querySelector('.w-sortmenu')).toBeNull();
    expect(button.textContent).toBe('Played');
    expect(document.activeElement).toBe(button);
    expect(opts()).toHaveLength(0);
  });
  it('Tab hands the focus back to the chip and closes the menu', async () => {
    const { button, key } = await open();
    await key('Tab');
    expect(document.querySelector('.w-sortmenu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
  it('a press outside closes it without a pick', async () => {
    const { button } = await open();
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(document.querySelector('.w-sortmenu')).toBeNull();
    expect(button.textContent).toBe('Recent');
  });
});

describe('the list under a filter', () => {
  it('filters and sorts 200 saved items', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ kind: 'video', id: `V${String(i).padStart(10, '0')}`, label: `Clip ${i}`, tags: i % 4 === 0 ? ['four'] : [], plays: i }));
    seed(many);
    render(<WatchCard />);
    await flush();
    expect(count()).toBe('200 saved');
    await click(chip('#four'));
    expect(labels()).toHaveLength(50);
    expect(count()).toBe('50 of 200');
    await type('clip 19');
    expect(labels()).toEqual(['Clip 192', 'Clip 196']);
    await type('clip 196');
    expect(labels()).toEqual(['Clip 196']);
    await click(document.querySelector('.w-sortchip')!);
    await click([...document.querySelectorAll('.w-sortmenu [role="option"]')][3]!);
    await type('');
    expect(labels()[0]).toBe('Clip 0');
    expect(labels()[1]).toBe('Clip 4');
    expect(labels()[49]).toBe('Clip 196');
  });
  it('keeps the row being renamed while a filter hides its neighbours', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    await click(document.querySelector('button[aria-label="Rename Apple orchard"]')!);
    await type('rain');
    expect(labels()).toEqual(['Rain radio']);
    expect(document.querySelector('.w-row.editing input')).not.toBeNull();
  });
  it('a lone # is no filter: the count stays "n saved"', async () => {
    seed();
    render(<WatchCard />);
    await flush();
    await type('#');
    expect(count()).toBe('4 saved');
  });
  it('the empty card has no chip row while a new playlist draft is open', async () => {
    seed([]);
    render(<WatchCard />);
    await flush();
    await click([...document.querySelectorAll('button')].find((b) => /New playlist/.test(b.textContent ?? ''))!);
    expect(document.querySelector('.own-draft')).not.toBeNull();
    expect(document.querySelector('.w-chiprow')).toBeNull();
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
