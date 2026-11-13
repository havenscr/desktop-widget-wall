import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import type { ForYouItem } from './forYou';
import { resetKeysFeed } from './keysFeed';
import { FOR_YOU_SHOWN, Keys, KEYS_POLL_MS, TAKEOVER_MS, WHEEL_GAP_MS } from './Keys';
import { MODE_KEY, type KeysSummary } from './keysModel';
import { LATCH_MS } from './useGuard';

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

it('a held page in the wrong app is refused with fixed words and types nothing', async () => {
  localStorage.setItem(MODE_KEY, JSON.stringify({ hold: true, setId: 'sales' }));
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await flush();
  expect(screen.getByText('Wrong app in front for Sales app')).toBeTruthy();
  expect(sent).toEqual([{ setId: 'sales', index: 0 }]);
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

it('renders up to eight keys and no more', async () => {
  const ten = { id: 'ten', name: 'Ten', general: false, keys: Array.from({ length: 10 }, (_, i) => k(`K${i}`)) };
  answer = front('ten', null, [ten]);
  render(<Keys />);
  await flush();
  expect(screen.getAllByRole('button', { name: /^K\d$/ })).toHaveLength(8);
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

// ---- the For you page ----

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
  fireEvent.click(screen.getByRole('button', { name: 'Join: Design review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open chat: Session s1' }));
  await flush();
  expect(calls).toEqual([{ key: 'mk' }, { id: 's1' }]);
});
