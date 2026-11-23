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

it('My zones shows its preview map on hover (the rule behind each place) and is disabled without a big screen', async () => {
  mocks.set('wall2_arrange_preview', () => ({ zones: [{ n: 1, x: 0, y: 0, w: 0.5, h: 1 }, { n: 2, x: 0.5, y: 0, w: 0.5, h: 1 }], moves: [{ zone: 1, app: 'Code', why: 'rule' }, { zone: 2, app: 'Edge', why: 'recent' }], stay: 0 }));
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:my-zones']));
  render(<><PinnedRow /><HoverTipLayer /></>);
  await flush();
  const zones = screen.getByRole('button', { name: 'My zones' });
  fireEvent.mouseEnter(zones);
  await flush(TIP_DELAY_MS);
  const card = screen.getByRole('tooltip').textContent ?? '';
  expect(card).toContain('your rule');
  expect(card).toContain('used last');
  expect(card).toContain('Click to move them.');
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
  // The menu of a pinned key has no Replace step: take the key off, then use the Add tile.
  fireEvent.contextMenu(screen.getByRole('button', { name }));
  await flush(801);
  fireEvent.click(screen.getByRole('menuitem', { name: /Remove from Always here/ }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  return screen.getByRole('dialog');
};

it('right-click opens the key menu and Remove then the Add tile opens the picker with the library by group', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Snip');
  expect(within(dlg).getByRole('searchbox', { name: 'Search keys' })).toBeTruthy();
  expect(document.activeElement).toBe(within(dlg).getByRole('searchbox'));
  for (const g of LIBRARY_DATA) expect(within(dlg).getByText(g.title)).toBeTruthy();
  expect(within(dlg).getAllByText('pinned').length).toBe(4);
  expect(within(dlg).queryByRole('button', { name: 'Snip, pinned' })).toBeNull();
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
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Always here' }));
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Always here' }));
  await flush();
  expect(labels()).toEqual([]);
  expect(screen.getByRole('button', { name: 'Add a key' })).toBeTruthy();
  expect(localStorage.getItem(PINS_KEY)).toBe('[]');
});

it('Remove and Add keep a stored key that does not resolve right now', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:gone', 'lib:snip']));
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Thirds', 'Snip']);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Always here' }));
  await flush();
  expect(labels()).toEqual(['Snip']);
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toEqual(['lib:gone', 'lib:snip']);
  // Adding into the free places: the unresolved entry stays while there is room, and storage never grows past five.
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Volume up' }));
  await flush();
  expect(labels()).toEqual(['Snip', 'Volume up']);
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toEqual(['lib:gone', 'lib:snip', 'lib:volume-up']);
});

it('a keys.json pin that does not resolve once keys.json has loaded is kept on a Remove, and is the first to give way when an Add needs room', async () => {
  const mine = { ref: 'file:0', label: 'Mine', action: null };
  localStorage.setItem(PINS_KEY, JSON.stringify([mine, 'lib:gone', 'lib:thirds', 'lib:snip', 'lib:focus']));
  render(<PinnedRow />);
  await flush();
  // keys.json has loaded and has no such key: that pin does not resolve, so three tiles show and two places are free.
  expect(labels()).toEqual(['Thirds', 'Snip', 'Focus']);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Always here' }));
  await flush();
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toEqual([mine, 'lib:gone', 'lib:thirds', 'lib:focus']);
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Volume up' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Volume down' }));
  await flush();
  const stored = JSON.parse(localStorage.getItem(PINS_KEY) ?? '') as unknown[];
  expect(stored).toHaveLength(5);
  // The oldest entry that did not resolve gave way first.
  expect(stored).toEqual(['lib:gone', 'lib:thirds', 'lib:focus', 'lib:volume-up', 'lib:volume-down']);
});

it('a keys.json pin is never given up while keys.json is still loading; an Add that would need its place is refused', async () => {
  mocks.set('wall2_keys_summary', () => new Promise(() => undefined));
  const mine = { ref: 'file:0', label: 'Mine', action: null };
  localStorage.setItem(PINS_KEY, JSON.stringify([mine, 'lib:gone', 'lib:thirds', 'lib:snip', 'lib:focus']));
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Thirds', 'Snip', 'Focus']);
  // Room for one Add comes from the key the library lacks, not from the pin that is still loading.
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Volume up' }));
  await flush();
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toEqual([mine, 'lib:thirds', 'lib:snip', 'lib:focus', 'lib:volume-up']);
  // A second Add would have to drop it: refused, storage unchanged.
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Volume down' }));
  await flush();
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toEqual([mine, 'lib:thirds', 'lib:snip', 'lib:focus', 'lib:volume-up']);
  expect(labels()).toEqual(['Thirds', 'Snip', 'Focus', 'Volume up']);
});

it('clicking a row adds that key into the free slot and keeps it in storage; the others stay', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Snip');
  fireEvent.click(within(dlg).getByRole('button', { name: 'Volume up' }));
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Hide screen', 'Volume up']);
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toEqual(['lib:thirds', 'lib:focus', 'lib:record-169', 'lib:strip-dark', 'lib:volume-up']);
  // The choice is kept for the next start.
  const again = render(<PinnedRow />);
  await flush();
  expect(again.container.querySelectorAll('.pin-tile').length).toBeGreaterThanOrEqual(5);
});

it('choosing a key that is already pinned in the Add step does not pin it twice', async () => {
  render(<PinnedRow />);
  await flush();
  const dlg = await openPicker('Thirds');
  fireEvent.click(within(dlg).getByRole('button', { name: 'Snip, pinned' }));
  await flush();
  expect(labels()).toEqual(['Focus', 'Record 16:9', 'Snip', 'Hide screen']);
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
  for (const bad of ['nope', JSON.stringify(['lib:snip', 'lib:snip']), JSON.stringify([7]), JSON.stringify(['lib:snip', 'lib:focus', 'lib:thirds', 'lib:mute', 'lib:mixer', 'lib:zen'])]) {
    localStorage.setItem(PINS_KEY, bad);
    resetKeysFeed();
    const { unmount } = render(<PinnedRow />);
    await flush();
    expect(labels(), bad).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Snip', 'Hide screen']);
    unmount();
  }
});

it('a stored key that no longer resolves is dropped without bringing the defaults back', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:snip', 'lib:nope']));
  const first = render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Snip']);
  first.unmount();
  localStorage.setItem(PINS_KEY, JSON.stringify(['file:0']));
  resetKeysFeed();
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual([]);
  expect(screen.getByRole('button', { name: 'Add a key' })).toBeTruthy();
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
  expect(labels()).toEqual(['Thirds', 'Focus', 'Record 16:9', 'Hide screen']);
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
  dlg = await openPicker('Focus');
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
  // The previous test closed a picker by an outside press, which leaves its one-click swallow on the document; spend it.
  fireEvent.click(document.body);
  await openPicker('Snip');
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'task row' }));
  fireEvent.click(screen.getByRole('button', { name: 'task row' }), { detail: 1 });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(task).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'task row' }), { detail: 1 });
  expect(task).toHaveBeenCalledTimes(1);
  await openPicker('Focus');
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
    expect(dlg.firstElementChild!.className).toBe('pk-purpose');
    expect(dlg.children[1].className).toBe('pk-top');
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

// Guards, closing and sizes of the Always here row.

const OPEN_ATTR = 'data-drawer-open';
afterEach(() => {
  document.documentElement.removeAttribute(OPEN_ATTR);
});

it('opens no menu and no picker while an overlay owns the pointer', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip']));
  render(<PinnedRow />);
  await flush();
  document.documentElement.setAttribute(OPEN_ATTR, '');
  const snip = screen.getByRole('button', { name: 'Snip' });
  fireEvent.contextMenu(snip);
  fireEvent.keyDown(snip, { key: 'ContextMenu' });
  fireEvent.keyDown(snip, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  // Once the overlay is gone the Add tile and the menu work again.
  document.documentElement.removeAttribute(OPEN_ATTR);
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await flush();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('the menu closes on a press elsewhere, and a second right-click on the same key closes it and opens it again', async () => {
  render(<PinnedRow />);
  await flush();
  const snip = screen.getByRole('button', { name: 'Snip' });
  fireEvent.contextMenu(snip);
  await flush();
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(snip);
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.pointerDown(snip, { button: 2 });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(snip);
  expect(screen.getAllByRole('menu')).toHaveLength(1);
});

it('no key has a corner button: not at rest, hovered or focused', async () => {
  const { container } = render(<PinnedRow />);
  await flush();
  const snip = screen.getByRole('button', { name: 'Snip' });
  const none = () => {
    expect(container.querySelector('.key-more')).toBeNull();
    expect(screen.queryByRole('button', { name: /More options for/ })).toBeNull();
    expect(container.querySelectorAll('.key-tile-wrap > *').length).toBe(container.querySelectorAll('.key-tile-wrap').length);
  };
  none();
  fireEvent.pointerEnter(snip);
  fireEvent.mouseOver(snip);
  none();
  snip.focus();
  none();
});

it('a pinned key menu lists Run it now, Move left, Move right, Replace with another key and Remove from Always here, each with helper text, and no Edit keys file', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip']));
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  const rows = screen.getAllByRole('menuitem');
  expect(rows.map((m) => m.querySelector('span')?.textContent)).toEqual(['Run it now', 'Move left', 'Move right', 'Replace with another key', 'Remove from Always here']);
  for (const row of rows) expect((row.getAttribute('title') ?? '').length).toBeGreaterThan(10);
  expect(screen.queryByRole('menuitem', { name: /Edit keys file/ })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: /Remove from Always here/ }));
  await flush();
  expect(labels()).toEqual(['Thirds']);
});

const stored = () => JSON.parse(localStorage.getItem(PINS_KEY) ?? 'null');

it('Move left and Move right swap a pin with its neighbour and save the order', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip', 'lib:focus']));
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Move left/ }));
  await flush();
  expect(labels()).toEqual(['Snip', 'Thirds', 'Focus']);
  expect(stored()).toEqual(['lib:snip', 'lib:thirds', 'lib:focus']);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Move right/ }));
  await flush();
  expect(labels()).toEqual(['Thirds', 'Snip', 'Focus']);
  expect(stored()).toEqual(['lib:thirds', 'lib:snip', 'lib:focus']);
});

it('Move left is off on the first pin and Move right on the last, each saying why', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip']));
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  const left = screen.getByRole('menuitem', { name: /Move left/ }) as HTMLButtonElement;
  expect(left.disabled).toBe(true);
  expect(left.getAttribute('title')).toBe('Already first.');
  expect((screen.getByRole('menuitem', { name: /Move right/ }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(document, { key: 'Escape' });
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  const right = screen.getByRole('menuitem', { name: /Move right/ }) as HTMLButtonElement;
  expect(right.disabled).toBe(true);
  expect(right.getAttribute('title')).toBe('Already last.');
});

it('a move from the keyboard menu keeps focus on the moved tile', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip', 'lib:focus']));
  render(<PinnedRow />);
  await flush();
  const snip = screen.getByRole('button', { name: 'Snip' });
  snip.focus();
  fireEvent.keyDown(snip, { key: 'ContextMenu' });
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Move right/ }));
  await flush();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Snip']);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Snip' }));
});

it('Replace with another key opens the picker for that slot and a choice changes only that slot', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip', 'lib:focus']));
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  const item = screen.getByRole('menuitem', { name: /Replace with another key/ });
  expect(item.getAttribute('title')).toBe("Pick a key from the library to take Snip's place. A key already in Always here swaps places with it.");
  fireEvent.click(item);
  await flush();
  expect(screen.getByText('Reset to defaults')).toBeTruthy();
  const hide = LIBRARY_DATA.flatMap((g) => g.keys).find((k) => k.id === 'strip-dark')!;
  fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes(hide.label) && !b.classList.contains('pin-tile'))!);
  await flush();
  expect(labels()).toEqual(['Thirds', hide.label, 'Focus']);
  expect(stored()).toEqual(['lib:thirds', 'lib:strip-dark', 'lib:focus']);
});

const pickKey = async (id: string) => {
  const k = LIBRARY_DATA.flatMap((g) => g.keys).find((x) => x.id === id)!;
  fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes(k.label) && !b.classList.contains('pin-tile'))!);
  await flush();
  return k.label;
};

it('a move from a mouse-opened menu keeps focus on the moved key', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip', 'lib:focus']));
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Move right/ }));
  await flush();
  expect(labels()).toEqual(['Thirds', 'Focus', 'Snip']);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Snip' }));
});

it('moves and a replace keep an unresolved stored entry in place, dropping and duplicating nothing', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:gone', 'lib:snip']));
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Thirds', 'Snip']);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Move left/ }));
  await flush();
  expect(labels()).toEqual(['Snip', 'Thirds']);
  expect(stored()).toEqual(['lib:snip', 'lib:gone', 'lib:thirds']);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Replace with another key/ }));
  await flush();
  await pickKey('strip-dark');
  expect(stored()).toEqual(['lib:snip', 'lib:gone', 'lib:strip-dark']);
});

it('moves and a replace with nothing stored save the fallback pins whole', async () => {
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Move right/ }));
  await flush();
  expect(stored()).toEqual(['lib:focus', 'lib:thirds', 'lib:record-169', 'lib:snip', 'lib:strip-dark']);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Replace with another key/ }));
  await flush();
  await pickKey('volume-up');
  expect(stored()).toEqual(['lib:focus', 'lib:thirds', 'lib:record-169', 'lib:volume-up', 'lib:strip-dark']);
});

it('moves and a replace keep a keys.json pin as one entry with its label and action', async () => {
  summary = { ...summary, defaultPins: ['file:0', 'lib:snip'], filePins: [{ label: 'Mine', icon: 'window', action: null }] };
  localStorage.setItem(PINS_KEY, JSON.stringify([{ ref: 'file:0', label: 'Mine', action: null }, 'lib:snip', 'lib:focus']));
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Mine' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Move right/ }));
  await flush();
  expect(labels()).toEqual(['Snip', 'Mine', 'Focus']);
  expect(stored()).toEqual(['lib:snip', { ref: 'file:0', label: 'Mine', action: null }, 'lib:focus']);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Focus' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Replace with another key/ }));
  await flush();
  await pickKey('strip-dark');
  expect(stored()).toEqual(['lib:snip', { ref: 'file:0', label: 'Mine', action: null }, 'lib:strip-dark']);
});

it('Replace with a key already in Always here swaps the two places', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip', 'lib:focus']));
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Replace with another key/ }));
  await flush();
  await pickKey('focus');
  expect(labels()).toEqual(['Focus', 'Snip', 'Thirds']);
  expect(stored()).toEqual(['lib:focus', 'lib:snip', 'lib:thirds']);
});

it('Run it now in a pinned key menu sends that key once', async () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:snip']));
  render(<PinnedRow />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: /Run it now/ }), { detail: 1 });
  await flush();
  expect(libCalls).toEqual([{ id: 'snip' }]);
});

it('every pinned key tooltip ends with the right-click line', async () => {
  render(<><PinnedRow /><HoverTipLayer /></>);
  await flush();
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Snip' }));
  await flush(TIP_DELAY_MS);
  expect(screen.getByRole('tooltip').textContent).toMatch(/\. Right-click for more\.$/);
  expect(screen.getByRole('tooltip').textContent).not.toContain('corner');
});

it('a menu opened by the keyboard returns focus to its key on Escape', async () => {
  render(<PinnedRow />);
  await flush();
  const focus = screen.getByRole('button', { name: 'Focus' });
  focus.focus();
  fireEvent.keyDown(focus, { key: 'ContextMenu' });
  await flush();
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(focus);
});

it('draws the row at the size and column count for 1 to 5 tiles, the Add tile counted', async () => {
  // With n pins the row has n tiles plus the Add tile, up to five.
  const cases: [string[], number, string][] = [
    [[], 1, 'wide'],
    [['lib:thirds'], 2, 'wide'],
    [['lib:thirds', 'lib:focus'], 3, 'up1'],
    [['lib:thirds', 'lib:focus', 'lib:snip'], 4, ''],
    [['lib:thirds', 'lib:focus', 'lib:snip', 'lib:mute'], 5, ''],
    [['lib:thirds', 'lib:focus', 'lib:snip', 'lib:mute', 'lib:mixer'], 5, ''],
  ];
  for (const [pins, tilesDrawn, cls] of cases) {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
    resetKeysFeed();
    const { container, unmount } = render(<PinnedRow />);
    await flush();
    const row = container.querySelector('.pin-tiles') as HTMLElement;
    expect(row.querySelectorAll('.key-tile').length, `${pins.length} pins`).toBe(tilesDrawn);
    expect(!!row.querySelector('.add-key'), `${pins.length} pins add`).toBe(pins.length < 5);
    expect(row.classList.contains('wide'), `${pins.length} pins wide`).toBe(cls === 'wide');
    expect(row.classList.contains('up1'), `${pins.length} pins up1`).toBe(cls === 'up1');
    expect(row.style.gridTemplateColumns).toBe(`repeat(${tilesDrawn}, minmax(0px, 1fr))`);
    unmount();
  }
});

it('a pinned PowerToys key that is off stays in its slot, greyed with the reason and never sent, and runs again once the module is back on', async () => {
  const withColor = (patch: Record<string, unknown>) => LIBRARY_DATA.map((g) => ({ ...g, keys: g.keys.map((k) => (k.id === 'pt-color' ? { ...k, ...patch } : k)) }));
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:snip', 'lib:pt-color', 'lib:thirds', 'lib:focus', 'lib:strip-dark']));
  mocks.set('wall2_keys_library', () => withColor({ kind: 'off', runnable: false, how: 'Off in PowerToys' }));
  const first = render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Snip', 'Color picker', 'Thirds', 'Focus', 'Hide screen']);
  const tile = screen.getByRole('button', { name: 'Color picker' });
  expect(tile.getAttribute('aria-disabled')).toBe('true');
  expect(tile.className).toContain('off');
  fireEvent.click(tile, { detail: 1 });
  await flush();
  expect(libCalls).toEqual([]);
  fireEvent.mouseEnter(tile);
  fireEvent.pointerEnter(tile);
  await flush(TIP_DELAY_MS + 50);
  // Its menu cannot run it either.
  fireEvent.contextMenu(tile);
  await flush();
  expect((screen.getByRole('menuitem', { name: /Run it now/ }) as HTMLButtonElement).disabled).toBe(true);
  first.unmount();
  resetKeysFeed();
  mocks.set('wall2_keys_library', () => withColor({ kind: 'key', runnable: true, how: 'Win+Shift+C' }));
  render(<PinnedRow />);
  await flush();
  expect(labels()).toEqual(['Snip', 'Color picker', 'Thirds', 'Focus', 'Hide screen']);
  const back = screen.getByRole('button', { name: 'Color picker' });
  expect(back.getAttribute('aria-disabled')).toBeNull();
  answerFor = () => null;
  fireEvent.click(back, { detail: 1 });
  await flush();
  expect(libCalls).toEqual([{ id: 'pt-color' }]);
});
