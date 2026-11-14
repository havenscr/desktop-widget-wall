// @ts-ignore node's own file calls; one test reads the stylesheet as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import { useDeckStore } from './deckStore';
import { UNDO_SHOW_MS } from './deckModel';
import { resetKeysFeed } from './keysFeed';
import { pickerBottomY, type KeysSummary } from './keysModel';
import { MAIN_GAP, rowEdges } from '../screens/frameLayout';
import { PINS_KEY } from './libraryModel';
import { PinnedRow } from './PinnedRow';
import { LATCH_MS } from './useGuard';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const DEFAULTS = ['lib:thirds', 'lib:focus', 'lib:record-169', 'lib:snip', 'lib:strip-dark'];
let summary: KeysSummary;
let libCalls: unknown[];
let setCalls: unknown[];
let answerFor: (id: string) => string | null;
let arrangeOk: boolean;
let arranged: unknown[];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetKeysFeed();
  useDeckStore.getState().clearApplied();
  libCalls = [];
  setCalls = [];
  arranged = [];
  arrangeOk = true;
  answerFor = (id) => LIBRARY_DATA.flatMap((g) => g.keys).find((k) => k.id === id)?.action ?? null;
  summary = { front: 'app', autoId: null, exe: null, sets: [], source: 'file', defaultPins: DEFAULTS, filePins: [] };
  mocks.set('wall2_keys_summary', () => summary);
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_arrange_status', () => arrangeOk);
  mocks.set('wall2_arrange', (a) => (arranged.push(a), { moved: 3, asked: 3 }));
  mocks.set('wall2_arrange_undo', () => 3);
  mocks.set('wall2_keys_send_library', (a) => {
    libCalls.push(a);
    const hit = LIBRARY_DATA.flatMap((g) => g.keys).find((k) => k.id === (a as { id: string }).id);
    if (!hit || !hit.runnable) throw 'no key';
    const act = answerFor(hit.id);
    return act === 'lock' || act === 'displays:off' ? null : act;
  });
  mocks.set('wall2_keys_send', (a) => {
    setCalls.push(a);
    return null;
  });
});
afterEach(() => {
  resetTip();
  resetKeysFeed();
  vi.useRealTimers();
  mocks.clear();
});

const tiles = () => screen.getAllByRole('button').filter((b) => b.classList.contains('pin-tile'));
const labels = () => tiles().map((b) => b.getAttribute('aria-label'));

it('shows the five default keys, with a pin beside the heading, and sends only the library id', async () => {
  const { container } = render(<PinnedRow />);
  await flush();
  expect(screen.getByText('Always here')).toBeTruthy();
  expect(container.querySelector('.deck-pin')).toBeTruthy();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Snip', 'Hide screen']);
  fireEvent.click(screen.getByRole('button', { name: 'Snip' }), { detail: 1 });
  await flush();
  expect(libCalls).toEqual([{ id: 'snip' }]);
  expect(screen.getByText('Snip sent')).toBeTruthy();
});

it('names its keys from keys.json when the file pins some, and sends the index of the pinned list', async () => {
  summary = { ...summary, defaultPins: ['file:0', 'lib:snip'], filePins: [{ label: 'Mine', icon: 'window', action: null }] };
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Mine', 'Snip']);
  fireEvent.click(screen.getByRole('button', { name: 'Mine' }), { detail: 1 });
  await flush();
  expect(setCalls).toEqual([{ setId: 'pinned', index: 0 }]);
});

it('a layout key runs the layout, names how many windows moved, keeps its outline and offers Undo for a minute', async () => {
  render(<PinnedRow />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Thirds' }), { detail: 1 });
  await flush();
  expect(arranged).toEqual([{ layout: 'thirds' }]);
  expect(screen.getByText('3 windows arranged')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thirds' }).className).toContain('sel');
  expect(screen.getByRole('button', { name: 'Focus' }).className).not.toContain('sel');
  await flush(UNDO_SHOW_MS - 1_000);
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await flush();
  expect(screen.getByText('3 windows put back')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Thirds' }).className).not.toContain('sel');
});

it('hides Undo and the outline after 60 seconds and goes back to the heading', async () => {
  render(<PinnedRow />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Focus' }), { detail: 1 });
  await flush();
  await flush(6_000);
  expect(screen.getByText('3 windows arranged')).toBeTruthy();
  await flush(UNDO_SHOW_MS);
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  expect(screen.getByText('Always here')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Focus' }).className).not.toContain('sel');
});

it('with no big screen the layout keys are off with the reason and do nothing; the others still work', async () => {
  arrangeOk = false;
  render(<PinnedRow />);
  await flush();
  const thirds = screen.getByRole('button', { name: 'Thirds' });
  expect(thirds.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(thirds);
  await flush();
  expect(libCalls).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Snip' }), { detail: 1 });
  await flush();
  expect(libCalls).toEqual([{ id: 'snip' }]);
});

it('My zones explains the placement rule and is disabled without a big screen', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:my-zones']));
  render(<><PinnedRow /><HoverTipLayer /></>);
  await flush();
  const zones = screen.getByRole('button', { name: 'My zones' });
  fireEvent.mouseEnter(zones);
  await flush(TIP_DELAY_MS);
  expect(screen.getByRole('tooltip').textContent).toContain('The windows you used last move; the rest stay where they are');
  arrangeOk = false;
  await flush(60_000);
  expect(screen.getByRole('button', { name: 'My zones' }).getAttribute('aria-disabled')).toBe('true');
});

it('a refusal is one fixed line; a double click sends once; a held Enter never repeats', async () => {
  mocks.set('wall2_keys_send_library', (a) => {
    libCalls.push(a);
    throw 'elevated';
  });
  render(<PinnedRow />);
  await flush();
  const snip = screen.getByRole('button', { name: 'Snip' });
  fireEvent.click(snip, { detail: 1 });
  await flush();
  fireEvent.click(snip, { detail: 2 });
  await flush();
  expect(libCalls).toHaveLength(1);
  expect(screen.getByText('Cannot type: that app runs as admin')).toBeTruthy();
  expect(fireEvent.keyDown(snip, { key: 'Enter', repeat: true })).toBe(false);
  await flush(LATCH_MS + 10);
  fireEvent.click(snip, { detail: 1 });
  await flush();
  expect(libCalls).toHaveLength(2);
});

it('a wall action that cannot run says why on the row, and one Rust ran says so', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:lock', 'lib:focus-stop', 'lib:tasks-open', 'lib:displays-off']));
  render(<PinnedRow />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Lock the PC' }), { detail: 1 });
  await flush();
  expect(screen.getByText('Locking the PC')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Stop focus' }), { detail: 1 });
  await flush();
  expect(screen.getByText('No focus session to stop')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All monitors off' }), { detail: 1 });
  await flush();
  expect(screen.getByText('Screens going to sleep')).toBeTruthy();
});

it('draws nothing where the commands do not exist', async () => {
  mocks.set('wall2_keys_summary', () => {
    throw 'unsupported';
  });
  const { container } = render(<PinnedRow />);
  await flush();
  expect(container.textContent).toBe('');
});

it('still shows the default keys when keys.json is invalid, since the library does not depend on it', async () => {
  mocks.set('wall2_keys_summary', () => {
    throw 'app 1, key 1: chord is not in the allowed key list';
  });
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Snip', 'Hide screen']);
});

// Section: the picker

const openPicker = async (name: string) => {
  fireEvent.contextMenu(screen.getByRole('button', { name }));
  await flush(801);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Replace with another key' }));
  await flush();
  return screen.getByRole('dialog');
};

it('right-click opens the key menu and Replace opens the picker with the library by group', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Snip');
  expect(within(dlg).getByRole('searchbox', { name: 'Search keys' })).toBeTruthy();
  expect(document.activeElement).toBe(within(dlg).getByRole('searchbox'));
  for (const g of LIBRARY_DATA) expect(within(dlg).getByText(g.title)).toBeTruthy();
  expect(within(dlg).getAllByText('pinned').length + within(dlg).getAllByText('this slot').length).toBe(5);
  expect(within(dlg).getByRole('button', { name: 'Snip, pinned' }).textContent).toContain('this slot');
  expect(within(dlg).getByRole('button', { name: 'Reset to defaults' })).toBeTruthy();
});

it('the ContextMenu key and Shift+F10 open the key menu too', async () => {
  render(<PinnedRow />);
  await flush();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Focus' }), { key: 'ContextMenu' });
  await flush();
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Snip' }), { key: 'F10', shiftKey: true });
  await flush();
  expect(screen.getByRole('menu')).toBeTruthy();
});

it('Add a key appends into the next free slot and Remove can leave only the Add tile', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds']));
  render(<PinnedRow />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  expect(screen.getByRole('dialog', { name: 'Add a key to Always here' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  expect(labels()).toEqual(['Thirds', 'Snip']);
  fireEvent.click(screen.getByRole('button', { name: 'More options for Thirds' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Always here' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'More options for Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Always here' }));
  await flush();
  expect(labels()).toEqual([]);
  expect(screen.getByRole('button', { name: 'Add a key' })).toBeTruthy();
  expect(localStorage.getItem(PINS_KEY)).toBe('[]');
});

it('clicking a row swaps that key into the slot and keeps it in storage; the others stay', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Snip');
  fireEvent.click(within(dlg).getByRole('button', { name: 'Volume up' }));
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Volume up', 'Hide screen']);
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toEqual(['lib:thirds', 'lib:focus', 'lib:record-169', 'lib:volume-up', 'lib:strip-dark']);
  // The choice is kept for the next start.
  const again = render(<PinnedRow />);
  await flush();
  expect(again.container.querySelectorAll('.pin-tile').length).toBeGreaterThanOrEqual(5);
});

it('choosing a key that is already pinned swaps the two', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Thirds');
  fireEvent.click(within(dlg).getByRole('button', { name: 'Snip, pinned' }));
  await flush();
  expect(labels()).toEqual(['Snip', 'Focus', 'Record 16:9', 'Thirds', 'Hide screen']);
});

it('Reset to defaults clears the choice', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:mute', 'lib:mixer']));
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Mute sound', 'Volume mixer']);
  const dlg = await openPicker('Mute sound');
  fireEvent.click(within(dlg).getByRole('button', { name: 'Reset to defaults' }));
  await flush();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Snip', 'Hide screen']);
  expect(localStorage.getItem(PINS_KEY)).toBeNull();
});

it('storage that is not valid against the library is ignored and the defaults show', async () => {
  for (const bad of ['nope', JSON.stringify(['lib:nope']), JSON.stringify(['lib:snip', 'lib:snip']), JSON.stringify(['lib:new-chat']), JSON.stringify(['lib:snip', 'lib:focus', 'lib:thirds', 'lib:mute', 'lib:mixer', 'lib:zen'])]) {
    localStorage.setItem(PINS_KEY, bad);
    resetKeysFeed();
    const { unmount } = render(<PinnedRow />);
    await flush();
    expect(labels(), bad).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Snip', 'Hide screen']);
    unmount();
  }
});

it('search narrows the library; coming and unfinished keys are listed but cannot be pinned', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Snip');
  fireEvent.change(within(dlg).getByRole('searchbox'), { target: { value: 'chat' } });
  const newChat = within(dlg).getByRole('button', { name: 'New chat, coming' });
  expect(newChat.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(newChat);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Snip', 'Hide screen']);
  fireEvent.change(within(dlg).getByRole('searchbox'), { target: { value: 'power bi: refresh' } });
  expect(within(dlg).getByRole('button', { name: 'Power BI: refresh, check' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.change(within(dlg).getByRole('searchbox'), { target: { value: 'zzzz' } });
  expect(within(dlg).getByText('No key matches that search')).toBeTruthy();
});

it('a shortcut to check is marked "check" and can be pinned', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Snip');
  fireEvent.change(within(dlg).getByRole('searchbox'), { target: { value: 'record or pause' } });
  fireEvent.click(within(dlg).getByRole('button', { name: 'Record or pause, check' }));
  await flush();
  expect(labels()).toContain('Record or pause');
});

it('closes on Escape and on a click outside, and the arrow keys move through the rows', async () => {
  const { container } = render(
    <div>
      <button type="button">outside</button>
      <PinnedRow />
    </div>,
  );
  await flush();
  let dlg = await openPicker('Snip');
  fireEvent.keyDown(within(dlg).getByRole('searchbox'), { key: 'ArrowDown' });
  const first = document.activeElement as HTMLElement;
  expect(first.classList.contains('pk-row')).toBe(true);
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement).not.toBe(first);
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  dlg = await openPicker('Snip');
  fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(container.querySelector('.pk')).toBeNull();
});

it('rows are at least 32 px tall and the picker sits inside the deck, never over Next three', () => {
  const css: string = readFileSync('src/styles/work.css', 'utf8');
  const row = /\.pk-row \{[^}]*min-height: (\d+)px/.exec(css);
  expect(Number(row?.[1])).toBeGreaterThanOrEqual(32);
  const pk = /\.pk \{[^}]*\}/.exec(css)?.[0] ?? '';
  expect(pk).toContain('position: absolute');
  expect(pk).toContain('inset: 0');
  // Its box is the one around the two rows, which sits below Next three in the right wing; the deck grows to hold it when it is short.
  expect(/\.deck \{[^}]*position: relative/.test(css)).toBe(true);
  expect(/\.pinned[^{]*\{[^}]*position: relative/.test(css)).toBe(false);
  expect(/\.deck:has\(\.pk\) \{[^}]*min-height: 232px/.test(css)).toBe(true);
});

it('the click that closes the picker is not also delivered to what was under the pointer; the next click is', async () => {
  const task = vi.fn();
  const later = vi.fn();
  render(
    <div>
      <button type="button" onClick={task}>
        task row
      </button>
      <button type="button" onClick={later}>
        Later
      </button>
      <PinnedRow />
    </div>,
  );
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'More options for Snip' }));
  await flush();
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'More options for Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Replace with another key' }));
  await flush();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'task row' }));
  fireEvent.click(screen.getByRole('button', { name: 'task row' }), { detail: 1 });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(task).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'task row' }), { detail: 1 });
  expect(task).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'More options for Snip' }));
  await flush();
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'More options for Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Replace with another key' }));
  await flush();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Later' }));
  fireEvent.click(screen.getByRole('button', { name: 'Later' }), { detail: 1 });
  expect(later).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Later' }), { detail: 1 });
  expect(later).toHaveBeenCalledTimes(1);
});

it('a click inside the picker on something that is not a control does not stop Escape closing it', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Snip');
  fireEvent.pointerDown(within(dlg).getByText('Anywhere on the PC'));
  (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('Lock and All monitors off never run from the keyboard, and the tile is blurred after a mouse click', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:lock', 'lib:displays-off', 'lib:snip']));
  render(<PinnedRow />);
  await flush();
  const lock = screen.getByRole('button', { name: 'Lock the PC' });
  const off = screen.getByRole('button', { name: 'All monitors off' });
  lock.focus();
  // Enter and Space on the focused tile: the keydown is stopped and the click it would make (detail 0) does nothing.
  expect(fireEvent.keyDown(lock, { key: 'Enter' })).toBe(false);
  expect(fireEvent.keyDown(off, { key: ' ' })).toBe(false);
  fireEvent.click(lock, { detail: 0 });
  fireEvent.click(off, { detail: 0 });
  await flush();
  expect(libCalls).toEqual([]);
  // A mouse click runs it, and the tile no longer holds the focus afterwards.
  fireEvent.click(lock, { detail: 1 });
  await flush();
  expect(libCalls).toEqual([{ id: 'lock' }]);
  expect(document.activeElement).not.toBe(lock);
  await flush(LATCH_MS + 10);
  off.focus();
  fireEvent.click(off, { detail: 1 });
  await flush();
  expect(libCalls).toEqual([{ id: 'lock' }, { id: 'displays-off' }]);
  expect(document.activeElement).not.toBe(off);
  // Other keys still run from the keyboard.
  fireEvent.click(screen.getByRole('button', { name: 'Snip' }), { detail: 0 });
  await flush();
  expect(libCalls).toHaveLength(3);
});

it('when the library cannot be read the row says so plainly and Try again reads it again', async () => {
  let fail = true;
  mocks.set('wall2_keys_library', () => {
    if (fail) throw 'boom';
    return LIBRARY_DATA;
  });
  render(<PinnedRow />);
  await flush();
  expect(screen.getByText('Keys not available')).toBeTruthy();
  expect(screen.queryByText('Loading keys')).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await flush();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Snip', 'Hide screen']);
});

it('a pin on a keys.json key keeps its label and action in storage and is dropped when the file changes under it', async () => {
  summary = { ...summary, defaultPins: ['file:0', 'lib:snip'], filePins: [{ label: 'Mine', icon: 'window', action: null }] };
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Snip');
  fireEvent.click(within(dlg).getByRole('button', { name: 'Volume up' }));
  await flush();
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toEqual([{ ref: 'file:0', label: 'Mine', action: null }, 'lib:volume-up']);
  // The file now has a different key at index 0: that pin is dropped, the other stays.
  summary = { ...summary, filePins: [{ label: 'Changed', icon: 'window', action: null }] };
  resetKeysFeed();
  const again = render(<PinnedRow />);
  await flush(2500);
  expect(within(again.container).queryByRole('button', { name: 'Changed' })).toBeNull();
  expect(within(again.container).queryByRole('button', { name: 'Mine' })).toBeNull();
  expect(within(again.container).getAllByRole('button', { name: 'Volume up' }).length).toBeGreaterThan(0);
});

it('the open picker runs down to just above the timeline, never over it', async () => {
  // A laid-out Work at scale 1: the right wing from y 20, the deck (and the picker's top) at y 274.
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('wing') ? 20 : this.classList.contains('pk') ? 274 : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: this.classList.contains('wing') ? 490 : 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  const off = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('wing') ? 490 : 0;
  });
  try {
    render(
      <div className="wing wr right-wing">
        <div className="deck">
          <PinnedRow />
        </div>
      </div>,
    );
    await flush();
    const dlg = await openPicker('Snip');
    const height = parseFloat(dlg.style.height);
    const bottom = 274 + height;
    const timelineTop = rowEdges()[2].top;
    expect(bottom).toBeLessThan(timelineTop);
    expect(bottom).toBe(pickerBottomY());
    expect(timelineTop - bottom).toBe(MAIN_GAP);
    // Search at the top, Reset at the bottom, the list between them the one part that scrolls.
    expect(dlg.firstElementChild!.className).toBe('pk-top');
    expect(dlg.lastElementChild!.className).toBe('pk-reset');
  } finally {
    rect.mockRestore();
    off.mockRestore();
  }
});

it('the picker list has the slim scrollbar and a fade at its foot', () => {
  const css: string = readFileSync('src/styles/work.css', 'utf8');
  const list = /\.pk-list \{[^}]*\}/.exec(css)?.[0] ?? '';
  expect(list).toContain('scrollbar-width: thin');
  expect(list).toContain('mask-image: linear-gradient');
});

it('each pin carries its kind from the library group: Record 16:9 and Snip as capture, Hide screen as system', async () => {
  render(<PinnedRow />);
  await flush();
  const kinds = [...document.querySelectorAll('.pin-tile')].map((t) => t.getAttribute('data-kind'));
  expect(kinds).toEqual(['layout', 'layout', 'capture', 'capture', 'system']);
});

it('a pin saved before the rename (lib:strip-dark) still resolves, now reading Hide screen', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:strip-dark', 'lib:snip']));
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Hide screen', 'Snip']);
  expect(screen.getByRole('button', { name: 'Hide screen' }).getAttribute('data-kind')).toBe('system');
});
