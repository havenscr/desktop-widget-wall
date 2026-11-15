import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { resetQueue, useYtQueue } from '../ytmusic/queue';
import { wallVideoView } from '../../home/wallVideo';
import { ownThumb } from './OwnParts';
import { OWN_KEY, resetOwnLists, useOwnLists } from './ownLists';
import { OWN_NOTE_MS, jump, next, ownView, playOwn, resetOwnPlay, setFollow, useOwnPlay } from './ownPlay';
import { framePoster } from './PlayerFrame';
import { PASTE_LINES } from './OwnEditor';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';

vi.setConfig({ testTimeout: 20_000 });

const FRIDAY = 'fridaywind01';
const SLOW = 'slowmorning1';
const PL = 'PLmockPlaylist0001';
const SINGLE = 'Ab3dEfGh1jK';
const V = (n: number) => `mockvideo${String(n).padStart(2, '0')}`;
const items = (n: number, known = true) => Array.from({ length: n }, (_, i) => (known ? { id: V(i + 1), title: `Video ${i + 1}`, channel: `Channel ${i + 1}`, seconds: 600 + i } : { id: V(i + 1) }));

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** Two playlists of the owner's own, a connected playlist and a single video, all in storage, then the stores read it. */
function seed(opts: { friday?: number; known?: boolean; extra?: unknown[]; shuffle?: boolean; repeat?: boolean } = {}) {
  const friday = items(opts.friday ?? 12, opts.known ?? true);
  localStorage.setItem(
    SAVED_KEY,
    JSON.stringify([
      { kind: 'own', id: FRIDAY, label: 'Friday wind down' },
      { kind: 'own', id: SLOW, label: 'Slow mornings' },
      { kind: 'playlist', id: PL, label: 'Weekend cooking' },
      { kind: 'video', id: SINGLE, label: 'Night drive mix' },
      ...(opts.extra ?? []),
    ]),
  );
  localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: { [FRIDAY]: { items: friday, shuffle: !!opts.shuffle, repeat: !!opts.repeat }, [SLOW]: { items: items(5).map((i) => ({ ...i, id: `slow${i.id.slice(4)}` })), shuffle: false, repeat: false } } }));
  resetWatch();
  resetOwnLists();
  resetOwnPlay();
  resetQueue();
  useWatchStore.getState().setTab('watch');
}

const row = (name: string) => screen.getByText(name).closest('.w-row') as HTMLElement;
const w = () => useWatchStore.getState();
const o = () => useOwnPlay.getState();
const own = () => useOwnLists.getState();
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
};
const press = async (el: Element, init: KeyboardEventInit) => {
  await act(async () => {
    fireEvent.keyDown(el, init);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
  localStorage.clear();
  resetWatch();
  resetOwnLists();
  resetOwnPlay();
  resetQueue();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => null);
  mocks.set('wall2_watch_open', () => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  resetOwnPlay();
  resetQueue();
  localStorage.clear();
  framePoster.render = null;
});

describe('the list', () => {
  it('shows a tile and a count for yours, the word YouTube for a connected playlist, and nothing for a video', async () => {
    seed({ extra: [{ kind: 'own', id: 'emptylist001', label: 'Empty one' }] });
    own().load();
    render(<UnwindView />);
    await flush();
    expect(within(row('Friday wind down')).getByText('12 videos')).toBeTruthy();
    expect(row('Friday wind down').querySelector('.own-tile')).not.toBeNull();
    expect(within(row('Slow mornings')).getByText('5 videos')).toBeTruthy();
    expect(within(row('Empty one')).getByText('No videos')).toBeTruthy();
    expect(within(row('Weekend cooking')).getByText('YouTube')).toBeTruthy();
    expect(row('Weekend cooking').querySelector('.own-tile')).toBeNull();
    expect(row('Night drive mix').querySelector('.w-count')).toBeNull();
    expect(screen.getByText('5 saved'.replace('5', '5')) ?? null).toBeTruthy();
  });

  it('says "1 video" for one', async () => {
    seed({ friday: 1 });
    render(<UnwindView />);
    await flush();
    expect(within(row('Friday wind down')).getByText('1 video')).toBeTruthy();
  });

  it('has the New playlist button, disabled with its reason at 24 entries', async () => {
    seed();
    const r = render(<UnwindView />);
    await flush();
    const button = screen.getByRole('button', { name: 'New playlist' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    r.unmount();
    const full = Array.from({ length: 20 }, (_, i) => ({ kind: 'video', id: `Filler${String(i).padStart(5, '0')}`, label: `Filler ${i}` }));
    seed({ extra: full });
    render(<UnwindView />);
    await flush();
    expect((screen.getByRole('button', { name: 'New playlist' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens a name row holding "My playlist"; Enter makes the playlist and opens the editor', async () => {
    seed();
    render(<UnwindView />);
    await flush();
    await click(screen.getByRole('button', { name: 'New playlist' }));
    const field = screen.getByLabelText('Name for the new playlist') as HTMLInputElement;
    expect(field.value).toBe('My playlist');
    // Nothing is stored until Enter.
    expect(w().saved).toHaveLength(4);
    fireEvent.change(field, { target: { value: 'Rainy day' } });
    await press(field, { key: 'Enter' });
    expect(w().saved[0]).toMatchObject({ kind: 'own', label: 'Rainy day' });
    expect(own().open).toBe(w().saved[0]!.id);
    expect(document.querySelector('.w-card.own-tall')).not.toBeNull();
    expect(screen.getByText('Rainy day')).toBeTruthy();
  });

  it('Escape and a click on another row drop the draft and store nothing', async () => {
    seed();
    render(<UnwindView />);
    await flush();
    await click(screen.getByRole('button', { name: 'New playlist' }));
    await press(screen.getByLabelText('Name for the new playlist'), { key: 'Escape' });
    expect(screen.queryByLabelText('Name for the new playlist')).toBeNull();
    expect(w().saved).toHaveLength(4);
    await click(screen.getByRole('button', { name: 'New playlist' }));
    expect(screen.getByLabelText('Name for the new playlist')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Rename Night drive mix' }));
    expect(screen.queryByLabelText('Name for the new playlist')).toBeNull();
    expect(w().saved).toHaveLength(4);
  });

  it('plays a playlist from its first video; an empty one opens the editor; the pencil opens the editor', async () => {
    seed({ extra: [{ kind: 'own', id: 'emptylist001', label: 'Empty one' }] });
    render(<UnwindView />);
    await flush();
    await click(row('Friday wind down').querySelector('.w-play')!);
    expect(w().playing?.id).toBe(V(1));
    expect(w().source).toBe('own');
    act(() => setFollow(false));
    expect(row('Friday wind down').querySelector('.w-play')!.getAttribute('title')).toBe('Friday wind down is playing. Show it.');
    expect(row('Empty one').querySelector('.w-play')!.getAttribute('title')).toBe('Empty: click to add videos');
    await click(row('Empty one').querySelector('.w-play')!);
    expect(own().open).toBe('emptylist001');
    act(() => own().setOpen(null));
    act(() => setFollow(false));
    await click(screen.getByRole('button', { name: 'Edit Slow mornings' }));
    expect(own().open).toBe(SLOW);
  });

  it('marks the playing playlist on with "3 of 12" in place of the count', async () => {
    seed();
    render(<UnwindView />);
    await flush();
    act(() => void playOwn(FRIDAY, V(3)));
    await flush();
    act(() => setFollow(false));
    const r = row('Friday wind down');
    expect(r.className).toContain('on');
    expect(within(r).getByText('3 of 12')).toBeTruthy();
    expect(within(r).queryByText('12 videos')).toBeNull();
  });

  it('asks once before deleting, keeps on Keep and on Escape, and deletes the record and the entry', async () => {
    seed();
    render(<UnwindView />);
    await flush();
    await click(screen.getByRole('button', { name: 'Delete Friday wind down' }));
    expect(screen.getByText('Delete Friday wind down and its 12 videos?')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Keep' }));
    expect(w().saved.some((i) => i.id === FRIDAY)).toBe(true);
    await click(screen.getByRole('button', { name: 'Delete Friday wind down' }));
    await press(screen.getByRole('button', { name: 'Keep' }), { key: 'Escape' });
    expect(screen.queryByText(/and its 12 videos/)).toBeNull();
    expect(w().saved.some((i) => i.id === FRIDAY)).toBe(true);
    act(() => void playOwn(FRIDAY));
    await flush();
    act(() => setFollow(false));
    await click(screen.getByRole('button', { name: 'Delete Friday wind down' }));
    await click(screen.getByRole('button', { name: 'Delete' }));
    expect(w().saved.some((i) => i.id === FRIDAY)).toBe(false);
    expect(own().lists[FRIDAY]).toBeUndefined();
    expect(w().playing).toBeNull();
  });
});

describe('Add to a playlist', () => {
  async function playSingle() {
    render(<UnwindView />);
    await flush();
    act(() => w().play({ kind: 'video', id: SINGLE }));
    act(() => w().setReport({ title: 'Reported title', channel: 'Reported channel', duration: 321 }));
    await flush();
  }

  it('shows the round button only for a single video, with the open button reading "YouTube"', async () => {
    seed();
    await playSingle();
    const add = screen.getByRole('button', { name: 'Add to a playlist' });
    expect(add).toBeTruthy();
    const open = screen.getByRole('button', { name: 'Open in YouTube' });
    expect(open.querySelector('.w-open-t')!.textContent).toBe('YouTube');
    expect(add.previousElementSibling).toBe(open);
  });

  it('is absent for a live stream, a connected playlist and Twitch, whose open button keeps its words', async () => {
    seed({ extra: [{ kind: 'live', id: 'Lofi_Live01', label: 'Lofi radio' }, { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' }] });
    render(<UnwindView />);
    await flush();
    for (const [id, kind, words] of [['Lofi_Live01', 'live', 'Open in YouTube'], [PL, 'playlist', 'Open in YouTube'], ['pixel_harbor', 'twitch', 'Open on Twitch']] as const) {
      act(() => w().play({ kind, id }));
      await flush();
      expect(screen.queryByRole('button', { name: 'Add to a playlist' })).toBeNull();
      expect(screen.getByRole('button', { name: words }).querySelector('.w-open-t')!.textContent).toBe(words);
    }
  });

  it('opens a menu with its kicker and the playlists; Enter adds the video with what the player reported', async () => {
    seed();
    await playSingle();
    await click(screen.getByRole('button', { name: 'Add to a playlist' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Add this video to')).toBeTruthy();
    const rows = within(menu).getAllByRole('menuitem');
    expect(rows.map((r) => r.getAttribute('title') ?? '')).toEqual(['', '', '']);
    expect(within(menu).getByRole('menuitem', { name: 'Friday wind down, 12 videos' })).toBe(rows[0]);
    expect(within(menu).getByRole('menuitem', { name: 'Slow mornings, 5 videos' })).toBe(rows[1]);
    expect(rows[2]!.textContent).toBe('New playlist');
    // The first row has the focus; Enter picks it.
    expect(document.activeElement).toBe(rows[0]);
    await click(rows[0]!);
    expect(own().lists[FRIDAY]!.items.at(-1)).toEqual({ id: SINGLE, title: 'Reported title', channel: 'Reported channel', seconds: 321 });
    // It holds the video now: a check, and a click takes it out again.
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]!.querySelector('.w-pop-check')).not.toBeNull();
    await click(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]!);
    expect(own().lists[FRIDAY]!.items.some((i) => i.id === SINGLE)).toBe(false);
  });

  it('moves with the arrow keys and Escape closes it and returns the focus to the button', async () => {
    seed();
    await playSingle();
    const add = screen.getByRole('button', { name: 'Add to a playlist' });
    await click(add);
    const menu = screen.getByRole('menu');
    const rows = within(menu).getAllByRole('menuitem');
    await press(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    await press(rows[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
    await press(rows[2]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
    await press(rows[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[2]);
    await press(rows[2]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(add);
    // The video went on playing: Escape in the menu is the menu's.
    expect(w().playing?.id).toBe(SINGLE);
  });

  it('a click outside closes it', async () => {
    seed();
    await playSingle();
    await click(screen.getByRole('button', { name: 'Add to a playlist' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('makes a new playlist with this video in it from the menu', async () => {
    seed();
    await playSingle();
    await click(screen.getByRole('button', { name: 'Add to a playlist' }));
    await click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'New playlist' }));
    const field = screen.getByLabelText('Name for the new playlist') as HTMLInputElement;
    expect(field.value).toBe('My playlist');
    fireEvent.change(field, { target: { value: 'Late night' } });
    await act(async () => void fireEvent.submit(field.form!));
    expect(screen.queryByRole('menu')).toBeNull();
    const made = w().saved[0]!;
    expect(made).toMatchObject({ kind: 'own', label: 'Late night' });
    expect(own().lists[made.id]!.items).toEqual([{ id: SINGLE, title: 'Reported title', channel: 'Reported channel', seconds: 321 }]);
  });

  it('disables a full playlist with its reason', async () => {
    seed({ friday: 50 });
    await playSingle();
    await click(screen.getByRole('button', { name: 'Add to a playlist' }));
    const full = within(screen.getByRole('menu')).getAllByRole('menuitem')[0]!;
    expect(full.getAttribute('aria-disabled')).toBe('true');
    await click(full);
    expect(own().lists[FRIDAY]!.items).toHaveLength(50);
  });

  it('the controls do not fade while the menu is open', async () => {
    seed();
    await playSingle();
    act(() => w().setReport({ started: true, time: 5, duration: 100 }));
    await click(screen.getByRole('button', { name: 'Add to a playlist' }));
    await flush(10_000);
    expect(document.querySelector('.w-now')!.getAttribute('data-ctl')).toBe('shown');
  });

  it('a saved video\'s row has its own add button that opens the same menu, with the owner\'s label as the title', async () => {
    seed();
    render(<UnwindView />);
    await flush();
    await click(screen.getByRole('button', { name: 'Add Night drive mix to a playlist' }));
    const menu = screen.getByRole('menu');
    await click(within(menu).getAllByRole('menuitem')[1]!);
    expect(own().lists[SLOW]!.items.at(-1)).toEqual({ id: SINGLE, title: 'Night drive mix' });
  });
});

describe('the editor', () => {
  async function editor(opts: Parameters<typeof seed>[0] = {}) {
    seed(opts);
    const r = render(<UnwindView />);
    await flush();
    act(() => own().setOpen(FRIDAY));
    await flush();
    return r;
  }
  const rows = () => [...document.querySelectorAll<HTMLElement>('.own-v.two')];

  it('grows the card and lists the videos with their pictures through the seam, title and "channel · length"', async () => {
    const seam = vi.spyOn(ownThumb, 'url');
    await editor();
    expect(document.querySelector('.w-card.own-tall')).not.toBeNull();
    expect(rows()).toHaveLength(12);
    expect(rows()[0]!.textContent).toContain('Video 1');
    expect(rows()[0]!.textContent).toContain('Channel 1 · 10:00');
    expect(document.querySelector('.own-totals')!.textContent).toBe('12 videos · 2 h 1 min');
    // The pictures come only through the seam, with a checked id, and carry no referrer.
    expect(seam).toHaveBeenCalledWith(V(1));
    const img = rows()[0]!.querySelector('img')!;
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${V(1)}/mqdefault.jpg`);
    seam.mockRestore();
  });

  it('says "YouTube video" and "named once it has played" for an unknown title, and counts only (with its tip) when a length is unknown', async () => {
    await editor({ known: false });
    expect(rows()[0]!.textContent).toContain('YouTube video');
    expect(rows()[0]!.textContent).toContain('named once it has played');
    expect(document.querySelector('.own-totals')!.textContent).toBe('12 videos');
  });

  it('dims a video that failed this session with its words', async () => {
    await editor();
    act(() => useYtQueue.setState({ failed: new Map([[V(2), 'embed' as const], [V(3), 'removed' as const]]) }));
    expect(rows()[1]!.className).toContain('bad');
    expect(rows()[1]!.textContent).toContain('Plays only on YouTube');
    expect(rows()[2]!.textContent).toContain('No longer on YouTube');
  });

  it('puts a video in order by dragging its grip, with the pointer events', async () => {
    await editor();
    const list = document.querySelector<HTMLElement>('.own-vlist')!;
    const wrap = document.querySelector<HTMLElement>('.own-vwrap')!;
    const box = { left: 0, top: 0, right: 506, bottom: 428, width: 506, height: 428, x: 0, y: 0, toJSON: () => ({}) };
    list.getBoundingClientRect = () => box as DOMRect;
    wrap.getBoundingClientRect = () => box as DOMRect;
    const grip = rows()[5]!.querySelector('.own-grip')!;
    act(() => void fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 10, clientY: 5 * 56 + 28 }));
    expect(rows()[5]!.className).toContain('ghosted');
    act(() => void fireEvent.pointerMove(grip, { pointerId: 1, clientX: 10, clientY: 2 * 56 + 20 }));
    expect(document.querySelector('.own-line-drop')).not.toBeNull();
    expect(document.querySelector('.own-ghost')).not.toBeNull();
    // Nothing is stored until it is dropped.
    expect(own().lists[FRIDAY]!.items[2]!.id).toBe(V(3));
    act(() => void fireEvent.pointerUp(grip, { pointerId: 1 }));
    expect(own().lists[FRIDAY]!.items.map((i) => i.id).slice(0, 4)).toEqual([V(1), V(2), V(6), V(3)]);
    expect(document.querySelector('.own-ghost')).toBeNull();
    // The new order is in storage at once.
    expect(JSON.parse(localStorage.getItem(OWN_KEY)!).lists[FRIDAY].items[2].id).toBe(V(6));
  });

  it('Escape during a drag puts the row back and does not close the editor', async () => {
    await editor();
    const list = document.querySelector<HTMLElement>('.own-vlist')!;
    const wrap = document.querySelector<HTMLElement>('.own-vwrap')!;
    const box = { left: 0, top: 0, right: 506, bottom: 428, width: 506, height: 428, x: 0, y: 0, toJSON: () => ({}) };
    list.getBoundingClientRect = () => box as DOMRect;
    wrap.getBoundingClientRect = () => box as DOMRect;
    const grip = rows()[4]!.querySelector('.own-grip')!;
    act(() => void fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 4 * 56 + 28 }));
    act(() => void fireEvent.pointerMove(grip, { pointerId: 1, clientY: 40 }));
    expect(document.querySelector('.own-ghost')).not.toBeNull();
    await press(document.body, { key: 'Escape' });
    expect(document.querySelector('.own-ghost')).toBeNull();
    expect(own().open).toBe(FRIDAY);
    act(() => void fireEvent.pointerUp(grip, { pointerId: 1 }));
    expect(own().lists[FRIDAY]!.items[4]!.id).toBe(V(5));
  });

  it('Alt+Up and Alt+Down move the focused row and keep the focus on it; Delete removes it and focuses the next', async () => {
    await editor();
    const third = rows()[2]!;
    third.focus();
    await press(third, { key: 'ArrowUp', altKey: true });
    expect(own().lists[FRIDAY]!.items.slice(0, 3).map((i) => i.id)).toEqual([V(1), V(3), V(2)]);
    expect((document.activeElement as HTMLElement).dataset.vid).toBe(V(3));
    await press(document.activeElement!, { key: 'ArrowDown', altKey: true });
    await press(document.activeElement!, { key: 'ArrowDown', altKey: true });
    expect(own().lists[FRIDAY]!.items.slice(0, 4).map((i) => i.id)).toEqual([V(1), V(2), V(4), V(3)]);
    expect((document.activeElement as HTMLElement).dataset.vid).toBe(V(3));
    const first = rows()[0]!;
    first.focus();
    await press(first, { key: 'Delete' });
    expect(own().lists[FRIDAY]!.items).toHaveLength(11);
    expect((document.activeElement as HTMLElement).dataset.vid).toBe(V(2));
  });

  it('the remove button takes a video out of the playlist', async () => {
    await editor();
    await click(screen.getByRole('button', { name: 'Remove Video 4' }));
    expect(own().lists[FRIDAY]!.items.some((i) => i.id === V(4))).toBe(false);
  });

  it('Escape closes the editor and never stops the video; Done and the back arrow close it too', async () => {
    seed();
    render(<UnwindView />);
    await flush();
    act(() => w().play({ kind: 'video', id: SINGLE }));
    act(() => own().setOpen(FRIDAY));
    await flush();
    await press(document.body, { key: 'Escape' });
    expect(own().open).toBeNull();
    expect(w().playing?.id).toBe(SINGLE);
    act(() => own().setOpen(FRIDAY));
    await click(screen.getByRole('button', { name: 'Done' }));
    expect(own().open).toBeNull();
    act(() => own().setOpen(FRIDAY));
    await click(screen.getByRole('button', { name: 'Back to the Watch list' }));
    expect(own().open).toBeNull();
    act(() => own().setOpen(FRIDAY));
    act(() => w().setTab('listen'));
    expect(own().open).toBeNull();
    expect(w().playing?.id).toBe(SINGLE);
  });

  it('Escape in a field is the field\'s and does not close the editor', async () => {
    await editor();
    const field = screen.getByLabelText('Paste a video link');
    await press(field, { key: 'Escape' });
    expect(own().open).toBe(FRIDAY);
  });

  it('adds what is playing, with its name and length; refuses when nothing, or not a video, or already in', async () => {
    seed();
    render(<UnwindView />);
    await flush();
    act(() => own().setOpen(SLOW));
    await flush();
    const chip = () => screen.getByRole('button', { name: /What is playing/ });
    expect(chip().getAttribute('aria-disabled')).toBe('true');
    act(() => w().play({ kind: 'live', id: 'Lofi_Live01' }));
    expect(chip().getAttribute('aria-disabled')).toBe('true');
    act(() => w().play({ kind: 'video', id: SINGLE }));
    act(() => w().setReport({ title: 'Reported title', channel: 'Reported channel', duration: 200 }));
    await flush();
    expect(chip().getAttribute('aria-disabled')).toBeNull();
    await click(chip());
    expect(own().lists[SLOW]!.items.at(-1)).toEqual({ id: SINGLE, title: 'Reported title', channel: 'Reported channel', seconds: 200 });
    expect(chip().getAttribute('aria-disabled')).toBe('true');
  });

  it('From the Watch list shows the saved single videos, with a plus and then a check; the back arrow returns to the rows', async () => {
    await editor();
    await click(screen.getByRole('button', { name: /From the Watch list/ }));
    expect(screen.getByText('Night drive mix')).toBeTruthy();
    expect(document.querySelectorAll('.own-v.two')).toHaveLength(0);
    await click(screen.getByRole('button', { name: 'Add Night drive mix' }));
    expect(own().lists[FRIDAY]!.items.at(-1)).toEqual({ id: SINGLE, title: 'Night drive mix' });
    expect(screen.getByRole('button', { name: 'Night drive mix is in the playlist' })).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Back to the playlist' }));
    expect(document.querySelectorAll('.own-v.two')).toHaveLength(13);
  });

  it('adds a pasted video link, ignoring a list beside it, and refuses what a playlist cannot hold', async () => {
    seed();
    render(<UnwindView />);
    await flush();
    act(() => own().setOpen(SLOW));
    await flush();
    const field = screen.getByLabelText('Paste a video link');
    const add = screen.getByRole('button', { name: 'Add' });
    const paste = async (text: string) => {
      fireEvent.change(field, { target: { value: text } });
      await click(add);
    };
    await paste('https://www.youtube.com/watch?v=Zz9yXxWw8vU&list=PLmockPlaylist0002');
    expect(own().lists[SLOW]!.items.at(-1)).toEqual({ id: 'Zz9yXxWw8vU' });
    expect(screen.queryByText(/Save the playlist too/)).toBeNull();
    await paste('https://www.youtube.com/watch?v=Zz9yXxWw8vU');
    expect(screen.getByRole('alert').textContent).toBe('That video is already in this playlist.');
    await paste(`https://www.youtube.com/playlist?list=${PL}`);
    expect(screen.getByRole('alert').textContent).toBe(PASTE_LINES.playlist);
    await paste('https://www.youtube.com/live/Lofi_Live01');
    expect(screen.getByRole('alert').textContent).toBe(PASTE_LINES.stream);
    await paste('twitch.tv/pixel_harbor');
    expect(screen.getByRole('alert').textContent).toBe(PASTE_LINES.stream);
    await paste('https://example.com/x');
    expect(screen.getByRole('alert').textContent).toBe('That is not a YouTube or Twitch link.');
    await flush(6100);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the pencil renames the playlist in place, 60 characters, Enter saves and Escape keeps', async () => {
    await editor();
    await click(screen.getByRole('button', { name: 'Rename Friday wind down' }));
    let field = screen.getByLabelText('Name of the playlist') as HTMLInputElement;
    expect(field.maxLength).toBe(60);
    fireEvent.change(field, { target: { value: 'Other name' } });
    await press(field, { key: 'Escape' });
    expect(w().saved.find((i) => i.id === FRIDAY)!.label).toBe('Friday wind down');
    await click(screen.getByRole('button', { name: 'Rename Friday wind down' }));
    field = screen.getByLabelText('Name of the playlist') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Other name' } });
    await press(field, { key: 'Enter' });
    expect(w().saved.find((i) => i.id === FRIDAY)!.label).toBe('Other name');
  });

  it('Delete asks once in the editor; Play starts the playlist and closes the editor; Play is off when empty', async () => {
    await editor();
    await click(screen.getByRole('button', { name: /^Delete/ }));
    expect(screen.getByText('Delete Friday wind down and its 12 videos?')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Keep' }));
    await click(screen.getByRole('button', { name: 'Play' }));
    expect(own().open).toBeNull();
    expect(w().playing?.id).toBe(V(1));
    own().setOpen(FRIDAY);
    await flush();
    await click(screen.getByRole('button', { name: /^Delete/ }));
    await click(screen.getByRole('button', { name: 'Delete' }));
    expect(own().lists[FRIDAY]).toBeUndefined();
    expect(own().open).toBeNull();
    expect(w().playing).toBeNull();
  });

  it('Play is disabled for an empty playlist', async () => {
    seed({ friday: 0 });
    render(<UnwindView />);
    await flush();
    act(() => own().setOpen(FRIDAY));
    await flush();
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('while it plays', () => {
  async function playing(opts: Parameters<typeof seed>[0] = {}, from = V(3)) {
    seed(opts);
    const r = render(<UnwindView />);
    await flush();
    act(() => void playOwn(FRIDAY, from));
    await flush();
    return r;
  }

  it('shows the playing playlist in the card, the video on in cyan, the foot and the switches stored on the playlist', async () => {
    await playing();
    expect(document.querySelector('.w-card .own-v.on')!.textContent).toContain('Video 3');
    expect(screen.getByText('3 of 12')).toBeTruthy();
    expect(screen.getByText('Stops after the last video')).toBeTruthy();
    const shuffle = screen.getByRole('button', { name: 'Shuffle' });
    const repeat = screen.getByRole('button', { name: 'Repeat' });
    expect(shuffle.getAttribute('aria-pressed')).toBe('false');
    await click(repeat);
    expect(repeat.getAttribute('aria-pressed')).toBe('true');
    expect(own().lists[FRIDAY]!.repeat).toBe(true);
    expect(screen.getByText('Repeat is on: it starts again after the last video')).toBeTruthy();
    await click(shuffle);
    expect(shuffle.getAttribute('aria-pressed')).toBe('true');
    expect(own().lists[FRIDAY]!.shuffle).toBe(true);
    expect(JSON.parse(localStorage.getItem(OWN_KEY)!).lists[FRIDAY]).toMatchObject({ shuffle: true, repeat: true });
    // Shuffle on keeps the video on first and the saved order alone.
    expect(own().lists[FRIDAY]!.items.map((i) => i.id)).toEqual(items(12).map((i) => i.id));
  });

  it('a click on another row plays it; a failed row is dimmed and cannot be clicked', async () => {
    await playing();
    act(() => useYtQueue.setState({ failed: new Map([[V(7), 'embed' as const]]) }));
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.w-card .own-v')];
    expect(rows[6]!.className).toContain('bad');
    expect(rows[6]!.textContent).toContain('Plays only on YouTube');
    await click(rows[6]!);
    expect(w().playing?.id).toBe(V(3));
    await flush(1100);
    await click(rows[0]!);
    expect(w().playing?.id).toBe(V(1));
  });

  it('the back arrow returns to the Watch list and it plays on, with its pill; clicking the playing row shows the card again', async () => {
    await playing();
    await click(screen.getByRole('button', { name: 'Back to the Watch list' }));
    expect(document.querySelector('.w-card .own-v')).toBeNull();
    expect(within(row('Friday wind down')).getByText('3 of 12')).toBeTruthy();
    expect(w().playing?.id).toBe(V(3));
    await click(row('Friday wind down').querySelector('.w-play')!);
    expect(document.querySelector('.w-card .own-v.on')).not.toBeNull();
  });

  it('Stop returns the card to the Watch list', async () => {
    await playing();
    await click(screen.getByRole('button', { name: 'Stop' }));
    expect(document.querySelector('.w-card .own-v')).toBeNull();
    expect(screen.getByText('6 saved'.replace('6', '4'))).toBeTruthy();
  });

  it('the Edit button opens the editor', async () => {
    await playing();
    await click(screen.getByRole('button', { name: 'Edit' }));
    expect(own().open).toBe(FRIDAY);
    // The playlist goes on playing.
    expect(w().playing?.id).toBe(V(3));
  });

  it('the left block says "Your playlist · 3 of 12", the video\'s title and channel, "Playing <name>", the Next line, and no "Saved as"', async () => {
    await playing();
    expect(document.querySelector('.u-src')!.textContent).toBe('Your playlist · 3 of 12');
    expect(document.querySelector('.w-title')!.textContent).toBe('Video 3');
    expect(document.querySelector('.w-by')!.textContent).toBe('Channel 3');
    expect(document.querySelector('.w-sub')!.textContent).toBe('Playing Friday wind down');
    expect(document.querySelector('.w-next')!.textContent).toBe('NextVideo 4');
    act(() => w().setReport({ title: 'Reported name', channel: 'Reported channel' }));
    expect(document.querySelector('.w-title')!.textContent).toBe('Reported name');
    expect(document.querySelector('.w-by')!.textContent).toBe('Reported channel');
    const title = document.querySelector('.w-title') as HTMLElement;
    act(() => void fireEvent.mouseEnter(title));
    await flush(400);
    expect(document.body.textContent).not.toContain('Saved as');
    act(() => w().setPaused(true));
    expect(document.querySelector('.w-sub')!.textContent).toBe('Paused');
  });

  it('has no Next line on the last video with repeat off, and names the first with repeat on', async () => {
    await playing({}, V(12));
    expect(document.querySelector('.w-next')).toBeNull();
    act(() => own().setRepeat(FRIDAY, true));
    expect(document.querySelector('.w-next')!.textContent).toBe('NextVideo 1');
  });

  it('Previous and Next are the playlist\'s, with their tips; Next on the last stays on and ends it', async () => {
    await playing({}, V(11));
    const prev = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement;
    const nextButton = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(nextButton.disabled).toBe(false);
    await flush(1100);
    await click(nextButton);
    expect(w().playing?.id).toBe(V(12));
    await flush(1100);
    await click(screen.getByRole('button', { name: 'Next' }));
    expect(w().playing).toBeNull();
    expect(o().finished).toMatchObject({ listId: FRIDAY, total: 12 });
  });

  it('shows the skip note for six seconds, in its words, with the count', async () => {
    await playing();
    await flush(1100);
    act(() => w().setReport({ error: 150 }));
    await flush(0);
    act(() => w().setReport({ started: true }));
    expect(document.querySelector('.own-skip')!.textContent).toBe('Skipped one: it plays only on YouTube');
    expect(document.querySelector('.u-src')!.textContent).toBe('Your playlist · 4 of 12');
    await flush(OWN_NOTE_MS - 100);
    expect(document.querySelector('.own-skip')).not.toBeNull();
    await flush(200);
    expect(document.querySelector('.own-skip')).toBeNull();
    expect(document.querySelector('.w-sub')!.textContent).toBe('Playing Friday wind down');
  });

  it('shows the end block when the last video ends with repeat off, and Play again starts from the first', async () => {
    await playing({ friday: 2 }, V(2));
    await flush(1100);
    act(() => w().setReport({ started: true, time: 4, duration: 100 }));
    act(() => w().setReport({ ended: true }));
    await flush(0);
    expect(w().playing).toBeNull();
    expect(document.querySelector('.u-src')!.textContent).toBe('Your playlist · ended');
    expect(document.querySelector('.w-title')!.textContent).toBe('Friday wind down');
    expect(document.querySelector('.w-by')!.textContent).toBe('1 of 2 videos played');
    expect(document.querySelector('.w-sub')!.textContent).toBe('Stopped after the last video');
    expect(document.querySelector('.w-time')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit the playlist' })).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Play again' }));
    expect(w().playing?.id).toBe(V(1));
    expect(o().finished).toBeNull();
    expect(document.querySelector('.u-src')!.textContent).toBe('Your playlist · 1 of 2');
  });

  it('says "All 2 videos played" when every one played', async () => {
    await playing({ friday: 2 }, V(1));
    for (let i = 0; i < 2; i++) {
      await flush(1100);
      act(() => w().setReport({ started: true, time: 4, duration: 100 }));
      act(() => w().setReport({ ended: true }));
      await flush(1100);
    }
    expect(document.querySelector('.w-by')!.textContent).toBe('All 2 videos played');
  });

  it('shows the form for no video playing, with Open in YouTube on the first video and Edit the playlist', async () => {
    await playing({ friday: 2 });
    await flush(1100);
    act(() => w().setReport({ error: 150 }));
    await flush(1100);
    act(() => w().setReport({ error: 150 }));
    await flush(0);
    expect(w().playing).toBeNull();
    expect(document.querySelector('.w-by')!.textContent).toBe('None of these can play here');
    const opened: unknown[] = [];
    mocks.set('wall2_watch_open', (a: unknown) => void opened.push(a));
    await click(screen.getByRole('button', { name: 'Open in YouTube' }));
    expect(opened).toEqual([{ kind: 'video', id: V(1) }]);
    await click(screen.getByRole('button', { name: 'Edit the playlist' }));
    expect(own().open).toBe(FRIDAY);
  });

  it('the end block goes when the playlist is deleted, and any play clears it', async () => {
    await playing({ friday: 1 }, V(1));
    act(() => next());
    await flush(0);
    expect(o().finished).not.toBeNull();
    act(() => w().play({ kind: 'video', id: SINGLE }));
    expect(o().finished).toBeNull();
    expect(document.querySelector('.u-src')!.textContent).toBe('YouTube video');
  });
});

describe('Home and the pins', () => {
  it('Home reads "Your playlist, 3 of 12" with the title and the playlist\'s own list', async () => {
    seed();
    act(() => void playOwn(FRIDAY, V(3)));
    const view = ownView(w(), o(), own().lists)!;
    const home = wallVideoView({ playing: w().playing, paused: w().paused, needsClick: w().needsClick, report: w().report, source: w().source }, undefined, view)!;
    expect(home.sub).toBe('Your playlist, 3 of 12');
    expect(home.shortSub).toBe('Your playlist, 3 of 12');
    expect(home.title).toBe('Video 3');
    expect(home.list).toEqual({ index: 2, count: 12 });
    expect(home.youtube).toBe(true);
    jump(V(5));
  });

  it('own playlists are never offered as pins', async () => {
    const { pinnable, withPin } = await import('./pins');
    seed();
    expect(pinnable([null, null, null], w().saved).map((i) => i.kind)).toEqual(['playlist', 'video']);
    expect(withPin([null, null, null], w().saved, 0, `own:${FRIDAY}`)).toEqual([null, null, null]);
  });
});
