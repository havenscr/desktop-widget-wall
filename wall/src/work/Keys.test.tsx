import { act, fireEvent, render, screen } from '@testing-library/react';
// @ts-ignore node's own file calls; this test reads the stylesheet as text.
import { readFileSync } from 'node:fs';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import type { ForYouItem } from './forYou';
import { resetKeysFeed } from './keysFeed';
import { resetLibIndex } from './keyLibrary';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { FOR_YOU_SHOWN, Keys, KEYS_POLL_MS, NEW_AGAIN_MS, TAKEOVER_MS, WHEEL_GAP_MS } from './Keys';
import { DECK_TILE_H, MODE_KEY, type KeysSummary } from './keysModel';
import { LATCH_MS } from './useGuard';
import { PINS_CHANGED_EVENT, PINS_KEY } from './libraryModel';

// What waits on the owner is tested on its own (forYou.test.tsx); here a small store stands in
// for the sources so a test can make an item arrive or go.
const fy = vi.hoisted(() => {
  let items: unknown[] = [];
  const subs = new Set<() => void>();
  return {
    get: () => items,
    set: (next: unknown[]) => {
      items = next;
      subs.forEach((f) => f());
    },
    sub: (f: () => void) => (subs.add(f), () => subs.delete(f)),
  };
});
vi.mock('./forYou', async (orig) => ({ ...(await orig<typeof import('./forYou')>()), useForYou: () => useSyncExternalStore(fy.sub, fy.get) }));

const item = (key: string, over: Partial<ForYouItem> = {}): ForYouItem => ({
  key,
  kind: 'waiting',
  title: `Session ${key}`,
  reason: 'waiting 3 min',
  action: 'Open chat',
  actionTip: 'Open the chat',
  ref: key,
  ...over,
});
const arrive = (...items: ForYouItem[]) => act(() => fy.set(items));

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const k = (label: string, action: string | null = null) => ({ label, icon: 'keyboard', action });
const general = { id: 'general', name: 'General', general: true, keys: [{ ...k('Snip'), icon: 'screenshot' }, { ...k('Clipboard'), icon: 'clipboard' }, k('Lock', 'lock'), k('Thirds', 'layout:thirds')] };
const sales = { id: 'sales', name: 'Sales app', general: false, keys: [{ ...k('Refresh'), icon: 'refresh' }] };
let answer: KeysSummary;
let sent: unknown[];
let sendFails: string | null;
let actionAnswer: string | null;
const front = (autoId: string | null, exe: string | null = null, sets = [general, sales]): KeysSummary => ({ front: 'app', autoId, exe, sets, source: 'file', defaultPins: [], filePins: [] });
const heading = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetKeysFeed();
  fy.set([]);
  sent = [];
  sendFails = null;
  actionAnswer = null;
  answer = front('sales');
  mocks.set('wall2_keys_summary', () => answer);
  mocks.set('wall2_arrange_status', () => true);
  mocks.set('wall2_keys_send', (args) => {
    sent.push(args);
    const set = [general, sales].find((s) => s.id === args?.setId);
    if (sendFails) throw sendFails;
    // The Rust rule: a specific set only types into its own app.
    if (set && !set.general && answer.autoId !== set.id) throw 'no app';
    return actionAnswer;
  });
});
afterEach(() => {
  resetTip();
  resetKeysFeed();
  vi.useRealTimers();
  mocks.clear();
});

it('shows the app own set as Now with its name and sends only a set id and a key index', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await flush();
  expect(sent).toEqual([{ setId: 'sales', index: 0 }]);
  expect(screen.getByText('Refresh sent to Sales app')).toBeTruthy();
});

it('shows the general set when the app in front has none of its own', async () => {
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · General')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Clipboard' })).toBeTruthy();
});

it('opens a key menu without sending and pins a library key to Always here', async () => {
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  expect(sent).toEqual([]);
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: /Pin to Always here/ }));
  await flush();
  expect(JSON.parse(localStorage.getItem('wall2-keys-pins') ?? '')).toEqual(['lib:snip']);
  expect(sent).toEqual([]);
  resetLibIndex();
});

it('says "No keys for this app" when there is no set and no general set', async () => {
  answer = front(null, 'notepad.exe', [sales]);
  render(<Keys />);
  await flush();
  expect(screen.getByText('No keys for this app')).toBeTruthy();
});

it('says where keys.json goes when the built-in keys are in use', async () => {
  answer = { ...front('sales'), source: 'default' };
  render(
    <>
      <Keys />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.mouseEnter(screen.getByText('Now · Sales app'));
  await flush(400);
  expect(document.body.textContent).toContain("put keys.json in the app's config folder");
});

it('Auto follows a change of app', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  answer = front('general', 'notepad.exe');
  await flush(KEYS_POLL_MS);
  expect(screen.getByText('Now · General')).toBeTruthy();
  expect(screen.getByRole('switch', { name: /Auto/ }).getAttribute('aria-checked')).toBe('true');
});

it('stepping holds the page, which then survives a change of app until Auto is clicked', async () => {
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByText('Now · General')).toBeTruthy();
  expect(screen.getByRole('switch', { name: /Auto/ }).getAttribute('aria-checked')).toBe('false');
  expect(JSON.parse(localStorage.getItem(MODE_KEY) ?? '')).toEqual({ hold: true, setId: 'general' });
  answer = front(null, 'notepad.exe', [general, sales]);
  await flush(KEYS_POLL_MS);
  expect(screen.getByText('Now · General')).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: /Auto/ }));
  expect(screen.getByText('No keys for this app')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(MODE_KEY) ?? '')).toEqual({ hold: false, setId: null });
});

it('the dots show every page and a click on one holds it; the wheel steps one page at most every quarter second', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual(['Sales app', 'General']);
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  expect(screen.getByText('Now · General')).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: /Auto/ }));
  const row = heading('Now · Sales app');
  fireEvent.wheel(row, { deltaY: 100 });
  fireEvent.wheel(row, { deltaY: 100 });
  expect(screen.getByText('Now · General')).toBeTruthy();
  await flush(WHEEL_GAP_MS + 10);
  fireEvent.wheel(heading('Now · General'), { deltaY: -100 });
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
});

it('a held page in the wrong app says why and never asks Rust, by mouse or keyboard', async () => {
  localStorage.setItem(MODE_KEY, JSON.stringify({ hold: true, setId: 'sales' }));
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  const key = screen.getByRole('button', { name: 'Refresh' });
  expect(key.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(key, { detail: 1 });
  await flush();
  expect(screen.getByText('Wrong app in front for Sales app')).toBeTruthy();
  fireEvent.keyDown(key, { key: 'Enter' });
  fireEvent.click(key, { detail: 0 });
  await flush();
  expect(sent).toEqual([]);
});

it('a held set that left keys.json is Auto again, in storage too; bad storage reads as Auto', async () => {
  localStorage.setItem(MODE_KEY, JSON.stringify({ hold: true, setId: 'gone' }));
  const { unmount } = render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(MODE_KEY) ?? '')).toEqual({ hold: false, setId: null });
  unmount();
  resetKeysFeed();
  localStorage.setItem(MODE_KEY, '{"hold":true,"setId":"<script>"}');
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
});

it('shows each refusal as one fixed line and ignores a click while one is sending', async () => {
  sendFails = 'not forward';
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await flush();
  expect(screen.getByText('Could not bring Sales app forward')).toBeTruthy();
  await flush(LATCH_MS + 10);
  let release: () => void = () => undefined;
  mocks.set('wall2_keys_send', (args) => new Promise((resolve) => { sent.push(args); release = () => resolve(null); }));
  sent = [];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(sent).toHaveLength(1);
  release();
  await flush();
});

it('draws nothing where the commands do not exist, and a quiet line when keys.json is bad', async () => {
  mocks.set('wall2_keys_summary', () => {
    throw 'unsupported';
  });
  const { container, unmount } = render(<Keys />);
  await flush();
  expect(container.textContent).toBe('');
  unmount();
  resetKeysFeed();
  mocks.set('wall2_keys_summary', () => {
    throw 'app 1, key 2: chord is not in the allowed key list';
  });
  render(<Keys />);
  await flush();
  expect(screen.getByText('keys.json has a problem')).toBeTruthy();
});

it('shows up to eight keys, five at a time when a second row does not fit, the arrows stepping through them', async () => {
  const ten = { id: 'ten', name: 'Ten', general: false, keys: Array.from({ length: 10 }, (_, i) => k(`K${i}`)) };
  answer = front('ten', null, [ten]);
  render(<Keys />);
  await flush();
  // No layout here, so a second row never fits: the first five, and "1/2" by the page name.
  expect(screen.getAllByRole('button', { name: /^K\d$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['K0', 'K1', 'K2', 'K3', 'K4']);
  expect(document.querySelector('.deck-part')!.textContent).toBe('1/2');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await flush();
  expect(screen.getAllByRole('button', { name: /^K\d$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['K5', 'K6', 'K7']);
  expect(document.querySelector('.deck-part')!.textContent).toBe('2/2');
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  await flush();
  expect(screen.getAllByRole('button', { name: /^K\d$/ })).toHaveLength(5);
});

it('a double click sends once, a repeated Enter after a completed send sends nothing, and a different key is not held off', async () => {
  render(<Keys />);
  await flush();
  const b = screen.getByRole('button', { name: 'Refresh' });
  fireEvent.click(b, { detail: 1 });
  await flush();
  fireEvent.click(b, { detail: 2 });
  await flush();
  expect(sent).toHaveLength(1);
  expect(fireEvent.keyDown(b, { key: 'Enter', repeat: true })).toBe(false);
  fireEvent.click(b, { detail: 0 });
  await flush();
  expect(sent).toHaveLength(1);
  await flush(LATCH_MS + 10);
  fireEvent.click(b, { detail: 1 });
  await flush();
  expect(sent).toHaveLength(2);
  answer = front('general', 'notepad.exe');
  await flush(KEYS_POLL_MS);
  sent = [];
  fireEvent.click(screen.getByRole('button', { name: 'Snip' }), { detail: 1 });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Clipboard' }), { detail: 1 });
  await flush();
  expect(sent).toEqual([{ setId: 'general', index: 0 }, { setId: 'general', index: 1 }]);
});

it('a key that carries a wall action runs it through the control the wall already has, once', async () => {
  const arranged: unknown[] = [];
  mocks.set('wall2_arrange', (a) => (arranged.push(a), { moved: 3, asked: 3 }));
  answer = front('general', 'notepad.exe');
  actionAnswer = 'layout:thirds';
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Thirds' }), { detail: 1 });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Thirds' }), { detail: 2 });
  await flush();
  expect(sent).toEqual([{ setId: 'general', index: 3 }]);
  expect(arranged).toEqual([{ layout: 'thirds' }]);
  expect(screen.getByText('3 windows arranged')).toBeTruthy();
  // Lock is run by Rust itself: the page has nothing to run and says so.
  actionAnswer = null;
  await flush(LATCH_MS + 10);
  fireEvent.click(screen.getByRole('button', { name: 'Lock' }), { detail: 1 });
  await flush();
  expect(screen.getByText('Locking the PC')).toBeTruthy();
});

it('a layout key is off, with the reason, when there is no big screen, and a held wrong app does not turn an action key off', async () => {
  mocks.set('wall2_arrange_status', () => false);
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  const b = screen.getByRole('button', { name: 'Thirds' });
  expect(b.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(b);
  await flush();
  expect(sent).toEqual([]);
  fireEvent.click(screen.getByRole('tab', { name: 'Sales app' }));
  expect(screen.getByRole('button', { name: 'Refresh' }).className).toContain('off');
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  expect(screen.getByRole('button', { name: 'Lock' }).className).not.toContain('off');
});

// Section: the For you page

it('the For you page is first in the pages while something waits, and is skipped when nothing does', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual(['Sales app', 'General']);
  await arrive(item('a'));
  expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual(['For you', 'Sales app', 'General']);
  // Nothing waits: stepping never lands on it, and Auto never shows it.
  await arrive();
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(screen.getByText('Now · General')).toBeTruthy();
});

it('a NEW item takes the row for 45 seconds, then the keys come back by themselves even though it still waits', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  await arrive(item('a'));
  expect(screen.getByText('Now · For you')).toBeTruthy();
  expect(screen.getByText('Session a')).toBeTruthy();
  await flush(TAKEOVER_MS - 1_000);
  expect(screen.getByText('Now · For you')).toBeTruthy();
  await flush(2_000);
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  // The same item staying does not take it again; a second new one does.
  await arrive(item('a'));
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  await arrive(item('a'), item('b'));
  expect(screen.getByText(/Now · For you/)).toBeTruthy();
});

it('the amber chip counts what waits and jumps to the page, which then holds', async () => {
  render(<Keys />);
  await flush();
  await arrive(item('a'), item('b'), item('c'));
  await flush(TAKEOVER_MS + 1_000);
  const chip = screen.getByRole('button', { name: 'For you 3' });
  fireEvent.click(chip);
  expect(screen.getByText(/Now · For you · \+1 more/)).toBeTruthy();
  expect(FOR_YOU_SHOWN).toBe(2);
  expect(screen.getAllByRole('button', { name: /^Open chat:/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'For you 3' })).toBeNull();
  expect(screen.getByRole('switch', { name: /Auto/ }).getAttribute('aria-checked')).toBe('false');
  expect(JSON.parse(localStorage.getItem(MODE_KEY) ?? '')).toEqual({ hold: true, setId: 'foryou' });
});

it('Hold keeps the row where it is: a new item adds to the chip but never takes the row, and Hold never times out', async () => {
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByText('Now · General')).toBeTruthy();
  await arrive(item('a'));
  expect(screen.getByText('Now · General')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'For you 1' })).toBeTruthy();
  await flush(TAKEOVER_MS * 4);
  expect(screen.getByText('Now · General')).toBeTruthy();
  // Held on For you, it stays long after 45 seconds; once nothing waits it goes back to Auto.
  fireEvent.click(screen.getByRole('button', { name: 'For you 1' }));
  await flush(TAKEOVER_MS * 4);
  expect(screen.getByText(/Now · For you/)).toBeTruthy();
  await arrive();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(MODE_KEY) ?? '')).toEqual({ hold: false, setId: null });
});

it('stepping by hand while the row is taken over turns Hold on and ends the take-over', async () => {
  render(<Keys />);
  await flush();
  await arrive(item('a'));
  expect(screen.getByText('Now · For you')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  await flush(TAKEOVER_MS * 2);
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
});

it('shows each item with its icon, title, reason and one button, and the button runs the existing command with the right id', async () => {
  const calls: unknown[] = [];
  mocks.set('wall2_focus_omnigent', (a) => void calls.push(a));
  mocks.set('wall2_meet_join', (a) => void calls.push(a));
  render(<Keys />);
  await flush();
  await arrive(item('s1', { reason: 'asks: which thumbnail' }), item('m1', { kind: 'meeting', title: 'Design review', reason: 'starts in 4 min', action: 'Join', ref: 'mk' }));
  expect(screen.getByText('asks: which thumbnail')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Join: Design review' }), { detail: 1 });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Open chat: Session s1' }), { detail: 1 });
  await flush();
  expect(calls).toEqual([{ key: 'mk' }, { id: 's1' }]);
});

it('an item that drops out for a poll and comes back does not take the row again; one gone for 10 minutes does', async () => {
  render(<Keys />);
  await flush();
  await arrive(item('a'));
  expect(screen.getByText('Now · For you')).toBeTruthy();
  await flush(TAKEOVER_MS + 1_000);
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  // The source goes stale for one poll and recovers: the same item, no second take-over.
  await arrive();
  await flush(15_000);
  await arrive(item('a'));
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  // Gone for 10 minutes or more: new again.
  await arrive();
  await flush(NEW_AGAIN_MS);
  await arrive(item('a'));
  expect(screen.getByText('Now · For you')).toBeTruthy();
});

it('an item gone for just under 10 minutes is still the same item, and the memory is bounded by a day', async () => {
  render(<Keys />);
  await flush();
  await arrive(item('a'));
  await flush(TAKEOVER_MS + 1_000);
  await arrive();
  await flush(NEW_AGAIN_MS - 5_000);
  await arrive(item('a'));
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  await arrive();
  vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
  await arrive(item('a'));
  expect(screen.getByText('Now · For you')).toBeTruthy();
});

it('items already waiting when the row mounts do not take it over, and the chip shows', async () => {
  fy.set([item('a'), item('b')]);
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'For you 2' })).toBeTruthy();
  await flush(TAKEOVER_MS);
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
});

it('a new item while Hold is on does not arm a take-over: Auto afterwards shows the keys, not For you', async () => {
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await arrive(item('a'));
  expect(screen.getByText('Now · General')).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: /Auto/ }));
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
});

it('a take-over waits for a press in flight: the key still gets its click, and the row changes after it', async () => {
  render(<Keys />);
  await flush();
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  fireEvent.pointerDown(refresh);
  await arrive(item('a'));
  // Still the same row, the same button, mid press.
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBe(refresh);
  fireEvent.pointerUp(refresh);
  fireEvent.click(refresh, { detail: 1 });
  await flush(0);
  expect(sent).toEqual([{ setId: 'sales', index: 0 }]);
  await flush(10);
  // The result line of the press is on the heading; the page itself is For you now.
  expect(screen.getByText('Session a')).toBeTruthy();
});

it('a take-over waits for a key held down too, and is dropped if Hold came on meanwhile', async () => {
  render(<Keys />);
  await flush();
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  fireEvent.keyDown(refresh, { key: 'Enter' });
  await arrive(item('a'));
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  fireEvent.keyUp(refresh, { key: 'Enter' });
  await flush(10);
  expect(screen.getByText('Now · General')).toBeTruthy();
});

it('a failed For you action shows one fixed line, and a double click runs it once', async () => {
  const calls: unknown[] = [];
  mocks.set('wall2_meet_join', (a) => {
    calls.push(a);
    throw 'gone';
  });
  render(<Keys />);
  await flush();
  await arrive(item('m1', { kind: 'meeting', title: 'Design review', action: 'Join', ref: 'mk' }));
  const join = screen.getByRole('button', { name: 'Join: Design review' });
  fireEvent.click(join, { detail: 1 });
  await flush();
  fireEvent.click(join, { detail: 2 });
  await flush();
  expect(calls).toEqual([{ key: 'mk' }]);
  expect(screen.getByText('Could not open the meeting')).toBeTruthy();
});

it('Lock and All monitors off never run from the keyboard from a set either', async () => {
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  const lock = screen.getByRole('button', { name: 'Lock' });
  lock.focus();
  expect(fireEvent.keyDown(lock, { key: 'Enter' })).toBe(false);
  fireEvent.click(lock, { detail: 0 });
  await flush();
  expect(sent).toEqual([]);
  fireEvent.click(lock, { detail: 1 });
  await flush();
  expect(sent).toEqual([{ setId: 'general', index: 2 }]);
  expect(document.activeElement).not.toBe(lock);
});

it('drops the group name from a key label on its own page; the full name stays in the name and hover', async () => {
  const code = { id: 'lib-vscode', name: 'VS Code', general: false, keys: [k('VS Code: command palette'), k('VS Code: search all files'), k('Format document')] };
  answer = front('lib-vscode', null, [code, general]);
  render(
    <>
      <Keys />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const tile = screen.getByRole('button', { name: 'VS Code: command palette' });
  expect(tile.querySelector('.deck-lbl')!.textContent).toBe('Command palette');
  expect(screen.getByRole('button', { name: 'VS Code: search all files' }).textContent).toBe('Search all files');
  expect(screen.getByRole('button', { name: 'Format document' }).textContent).toBe('Format document');
  fireEvent.mouseEnter(tile);
  await flush(400);
  expect(document.querySelector('.hover-tip')!.textContent).toContain('VS Code: command palette');
});

it('a held set whose app is not in front keeps its tiles, dimmed one step, and says why', async () => {
  localStorage.setItem('wall2-keys-mode', JSON.stringify({ hold: true, setId: 'sales' }));
  answer = front('general', 'notepad.exe');
  render(
    <>
      <Keys />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const tile = screen.getByRole('button', { name: 'Refresh' });
  expect(tile.className).toContain('off');
  expect(tile.className).toContain('key-tile');
  fireEvent.mouseEnter(tile);
  await flush(400);
  expect(document.querySelector('.hover-tip')!.textContent).toContain('Sales app is not in front, so this would send nothing');
});

// Section: keys tinted by kind, For you as two plates

it('every key carries its kind from data; a key that cannot be sent keeps it but is drawn off', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('data-kind')).toBe('app');
  localStorage.setItem('wall2-keys-mode', JSON.stringify({ hold: true, setId: 'general' }));
  answer = front('general', 'notepad.exe');
  await flush(KEYS_POLL_MS);
  // Without the library read the file's own general set is a system set; its wall action keys go by their action.
  expect(screen.getByRole('button', { name: 'Snip' }).getAttribute('data-kind')).toBe('system');
  expect(screen.getByRole('button', { name: 'Lock' }).getAttribute('data-kind')).toBe('system');
  expect(screen.getByRole('button', { name: 'Thirds' }).getAttribute('data-kind')).toBe('layout');
});

it('a key that cannot be sent is drawn off (no kind colour applies to it)', async () => {
  localStorage.setItem('wall2-keys-mode', JSON.stringify({ hold: true, setId: 'sales' }));
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  const tile = screen.getByRole('button', { name: 'Refresh' });
  expect(tile.classList.contains('off')).toBe(true);
  expect(tile.classList.contains('key-tile')).toBe(true);
  // The colour keys on data-kind: an unavailable key has none, so no kind colour can reach it.
  expect(tile.hasAttribute('data-kind')).toBe(false);
});

it('a key of the owner own keys.json takes the kind of the library key with its label', async () => {
  resetLibIndex();
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  localStorage.setItem('wall2-keys-mode', JSON.stringify({ hold: true, setId: 'general' }));
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  expect(screen.getByRole('button', { name: 'Snip' }).getAttribute('data-kind')).toBe('capture');
  expect(screen.getByRole('button', { name: 'Clipboard' }).getAttribute('data-kind')).toBe('system');
  resetLibIndex();
});

it('For you shows two plates the height of a key, title cut with the full text in the hover, one button each', async () => {
  render(
    <>
      <Keys />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const long = 'A very long meeting title that cannot fit in half the row at all';
  await arrive(item('s1'), item('m1', { kind: 'meeting', title: long, reason: 'starts in 4 min', action: 'Join', ref: 'mk' }), item('s2'));
  const plates = [...document.querySelectorAll('.fy-plate')] as HTMLElement[];
  expect(plates.length).toBe(FOR_YOU_SHOWN);
  for (const p of plates) {
    expect(p.classList.contains('fy-li')).toBe(true);
    expect(p.querySelectorAll('button').length).toBe(1);
  }
  expect(plates.map((p) => p.getAttribute('data-kind'))).toEqual(['agent', 'app']);
  expect(screen.getByText(/\+1 more/)).toBeTruthy();
  // The title is in one cut line; the full title and the reason show on hover.
  expect(plates[1].querySelector('.fy-tx b')!.textContent).toBe(long);
  fireEvent.mouseEnter(plates[1]);
  await flush(400);
  expect(document.querySelector('.hover-tip')!.textContent).toContain(`${long}: starts in 4 min`);
});

it('For you with one item shows one plate and keeps the second half empty', async () => {
  render(<Keys />);
  await flush();
  await arrive(item('s1'));
  expect(document.querySelectorAll('.fy-plate').length).toBe(1);
  expect(document.querySelector('.fy-list')!.children.length).toBe(1);
});

it('a one-line and a two-line label make tiles of one class and one structure (icon, then a two-line label area)', async () => {
  const wide = { id: 'wide', name: 'Wide', general: false, keys: [k('Snip'), k('Clipboard history for the whole day, long'), k('Lock')] };
  answer = front('wide', null, [wide, general]);
  render(<Keys />);
  await flush();
  const tiles = screen.getAllByRole('button').filter((b) => b.classList.contains('key-tile'));
  expect(tiles.length).toBe(3);
  const shape = (t: Element) => [t.className, [...t.children].map((c) => `${c.tagName}.${c.getAttribute('class') ?? ''}`)];
  expect(shape(tiles[1])).toEqual(shape(tiles[0]));
  expect(shape(tiles[2])).toEqual(shape(tiles[0]));
  expect(shape(tiles[0])[1]).toEqual(['svg.tabler-icon tabler-icon-keyboard', 'SPAN.deck-lbl']);
});

it('the key tile rule builds one height from an icon box and a two-line label area, and DECK_TILE_H says the same', () => {
  const css = readFileSync('src/styles/work.css', 'utf8');
  const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/[.[\]]/g, '\\$&')} \\{([^}]*)\\}`))![1];
  const tile = rule('.deck-tile.key-tile');
  expect(tile).toContain('height: 70px');
  expect(tile).toContain('grid-template-rows: 20px 32px');
  expect(tile).toContain('row-gap: 4px');
  expect(tile).toContain('padding: 6px 8px');
  expect(tile).toContain('line-height: 16px');
  // 6 + 20 + 4 + 32 + 6 padding and gaps, plus the two 1 px edges.
  expect(6 + 20 + 4 + 32 + 6 + 2).toBe(DECK_TILE_H);
  const label = rule('.key-tile .deck-lbl');
  expect(label).toContain('-webkit-line-clamp: 2');
  expect(label).toContain('max-height: 32px');
  expect(label).toContain('align-self: center');
  // The For you plates are the same height, so the Now row is one height on every page.
  expect(rule('.fy-li')).toContain(`height: ${DECK_TILE_H}px`);
});

// Key menus on the Now row: guards, closing, and what they say.

const OPEN_ATTR = 'data-drawer-open';
const menuUp = () => screen.queryByRole('menu');
const libraryMocks = () => mocks.set('wall2_keys_library', () => LIBRARY_DATA);

afterEach(() => {
  document.documentElement.removeAttribute(OPEN_ATTR);
  vi.restoreAllMocks();
  resetLibIndex();
});

it('opens no menu while an overlay owns the pointer: not by right-click, the corner button or the keyboard', async () => {
  libraryMocks();
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  document.documentElement.setAttribute(OPEN_ATTR, '');
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  fireEvent.click(screen.getByRole('button', { name: 'More options for Snip' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Snip' }), { key: 'ContextMenu' });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Snip' }), { key: 'F10', shiftKey: true });
  await flush();
  expect(menuUp()).toBeNull();
  // The same gestures open it once the overlay is gone.
  document.documentElement.removeAttribute(OPEN_ATTR);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  expect(menuUp()).not.toBeNull();
});

it('closes its menu on a press elsewhere and on a change of page or mode', async () => {
  libraryMocks();
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  expect(menuUp()).not.toBeNull();
  fireEvent.pointerDown(document.body);
  expect(menuUp()).toBeNull();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  expect(menuUp()).not.toBeNull();
  // Stepping to another page turns Hold on and shows other keys.
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await flush();
  expect(menuUp()).toBeNull();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Refresh' }));
  await flush();
  expect(menuUp()).not.toBeNull();
  // Back to Auto is a change of mode.
  fireEvent.click(screen.getByRole('switch', { name: /Auto/ }));
  await flush();
  expect(menuUp()).toBeNull();
});

it('closes the menu when the feed brings another set under it', async () => {
  libraryMocks();
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  expect(menuUp()).not.toBeNull();
  // The same set again (a poll that changed nothing): the menu stays.
  await flush(KEYS_POLL_MS);
  expect(menuUp()).not.toBeNull();
  answer = front('sales', 'sales.exe');
  await flush(KEYS_POLL_MS);
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  expect(menuUp()).toBeNull();
  // And it does not come back when the first set returns.
  answer = front('general', 'notepad.exe');
  await flush(KEYS_POLL_MS);
  expect(screen.getByText('Now · General')).toBeTruthy();
  expect(menuUp()).toBeNull();
});

it('disables Pin with its reason when Always here is full, and when the key is already there', async () => {
  libraryMocks();
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:focus', 'lib:mute', 'lib:mixer', 'lib:zen']));
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  const full = screen.getByRole('menuitem', { name: /Always here is full/ }) as HTMLButtonElement;
  expect(full.disabled).toBe(true);
  expect(full.textContent).toContain('5 of 5');
  fireEvent.click(full);
  expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? '')).toHaveLength(5);
  fireEvent.pointerDown(document.body);
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:snip']));
  act(() => window.dispatchEvent(new Event(PINS_CHANGED_EVENT)));
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  expect((screen.getByRole('menuitem', { name: /Already in Always here/ }) as HTMLButtonElement).disabled).toBe(true);
});

it('a blocked store does not throw into the Pin click', async () => {
  libraryMocks();
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => fireEvent.click(screen.getByRole('menuitem', { name: /Pin to Always here/ }))).not.toThrow();
  expect(menuUp()).toBeNull();
});

it("updates the menu's pin count when a pin is made elsewhere", async () => {
  libraryMocks();
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Snip' }));
  await flush();
  expect(screen.getByRole('menuitem', { name: /Pin to Always here/ }).textContent).toContain('0 of 5');
  // A pin made through the Add tile of the Always here row.
  localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds', 'lib:focus', 'lib:mute']));
  act(() => window.dispatchEvent(new Event(PINS_CHANGED_EVENT)));
  expect(screen.getByRole('menuitem', { name: /Pin to Always here/ }).textContent).toContain('3 of 5');
});

it('every enabled Now key says the menu exists in its tooltip, and a disabled key keeps its reason', async () => {
  mocks.set('wall2_arrange_status', () => false);
  answer = front('general', 'notepad.exe');
  render(
    <>
      <Keys />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Clipboard' }));
  await flush(400);
  expect(document.body.textContent).toContain('Send Clipboard to the app in front. Right-click, or the button in its corner, for more.');
  fireEvent.mouseLeave(screen.getByRole('button', { name: 'Clipboard' }));
  await flush(400);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Lock' }));
  await flush(400);
  expect(document.body.textContent).toContain('Lock. Right-click, or the button in its corner, for more.');
  fireEvent.mouseLeave(screen.getByRole('button', { name: 'Lock' }));
  await flush(400);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Thirds' }));
  await flush(400);
  expect(document.body.textContent).not.toContain('Right-click, or the button in its corner');
  expect(document.body.textContent).toContain('There is no big screen');
});

it('draws the Now keys at the size and column count for 1 to 5 keys', async () => {
  const sized = [
    ['wide', 1],
    ['wide', 2],
    ['up1', 3],
    ['', 4],
    ['', 5],
  ] as const;
  for (const [n, [cls, cols]] of sized.entries()) {
    const set = { id: `n${n + 1}`, name: `Set ${n + 1}`, general: false, keys: Array.from({ length: n + 1 }, (_v, j) => k(`Key ${j}`)) };
    answer = front(set.id, null, [set, general]);
    resetKeysFeed();
    const { container, unmount } = render(<Keys />);
    await flush();
    const tiles = container.querySelector('.keys-tiles') as HTMLElement;
    expect(tiles.querySelectorAll('.key-tile').length).toBe(n + 1);
    expect(tiles.classList.contains('wide'), `${n + 1} wide`).toBe(cls === 'wide');
    expect(tiles.classList.contains('up1'), `${n + 1} up1`).toBe(cls === 'up1');
    expect(tiles.style.gridTemplateColumns).toBe(`repeat(${cols}, minmax(0px, 1fr))`);
    unmount();
  }
});
