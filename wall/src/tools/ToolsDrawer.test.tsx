import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { Rail } from '../rail/Rail';
import { usePlaceStore } from '../state/places';
import { resetTip } from '../ui/HoverTip';
import { DEFAULT_LOOKS } from '../unwind/watch/looks';
import { useWatchStore } from '../unwind/watch/store';
import { resetKeysFeed, useKeysFeedStore } from '../work/keysFeed';
import type { KeysSummary } from '../work/keysModel';
import { resetReports } from './reports';
import { resetRetries } from './sources';
import { resetTools, useToolsStore } from './store';
import { AUTO_CLOSE_MS, RING_MS, ToolsDrawer, fileKeyCount, keysLine } from './ToolsDrawer';

/** Move the clock in steps of at most 10 s, each its own act, so the 2 second keys poll never piles into one render batch. */
const flush = async (ms = 0) => {
  let left = ms;
  do {
    const step = Math.min(left, 10_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
    left -= step;
  } while (left > 0);
};

const key = (label: string) => ({ label, icon: 'keyboard', action: null });
const summary = (over: Partial<KeysSummary> = {}): KeysSummary => ({
  front: 'idle',
  autoId: null,
  exe: null,
  sets: [
    { id: 'lib-vscode', name: 'VS Code', general: false, keys: [key('a'), key('b')] },
    { id: 'sales', name: 'Sales', general: false, keys: [key('c'), key('d'), key('e')] },
  ],
  source: 'file',
  defaultPins: [],
  filePins: [key('p')],
  ...over,
});

let keysAnswer: () => unknown;
let opened: ReturnType<typeof vi.fn<(a?: unknown) => unknown>>;
const openedHandler = (a?: unknown) => opened(a);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-13T17:00:00Z'));
  resetTools();
  resetTip();
  resetReports();
  resetRetries();
  resetKeysFeed();
  useWatchStore.setState({ looks: { ...DEFAULT_LOOKS } });
  usePlaceStore.setState({ active: 'work' });
  keysAnswer = () => summary();
  opened = vi.fn();
  mocks.set('wall2_keys_summary', () => keysAnswer());
  mocks.set('wall2_open_keys_file', openedHandler);
  mocks.set('wall2_build_info', () => ({ commit: '7c9f442', builtAt: '2026-11-13T16:17Z' }));
  mocks.set('wall2_meet_next', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }, { id: 'second', label: 'Second', state: 'signed-out' }], meetings: [] }));
  mocks.set('wall2_spotify_status', () => ({ setup: false, signedIn: false }));
  mocks.set('wall2_tasks_next', () => []);
  mocks.set('wall2_sonos_summary', () => ({}));
  mocks.set('wall2_machines', () => ({ pc: {}, box: {}, boxStale: false }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const openIt = async (focus: 'accounts' | null = null) => {
  render(<ToolsDrawer />);
  act(() => useToolsStore.getState().openDrawer(focus));
  await flush();
};

it('draws nothing until it is opened, then the five sections and the footer', async () => {
  render(<ToolsDrawer />);
  expect(screen.queryByLabelText('Tools')).toBeNull();
  act(() => useToolsStore.getState().openDrawer());
  await flush();
  const drawer = screen.getByLabelText('Tools');
  for (const text of ['Accounts', 'Video look', 'Keys file', 'Sources', 'Build 7c9f442']) expect(drawer.textContent).toContain(text);
  expect(drawer.textContent).toContain('Accounts and sources moved here from the screens');
  expect(screen.getAllByRole('button', { name: /^Retry / })).toHaveLength(8);
});

it('the rail button opens it from any place, shows pressed, and closes it again', async () => {
  usePlaceStore.setState({ active: 'home' });
  render(
    <>
      <Rail />
      <ToolsDrawer />
    </>,
  );
  const btn = screen.getByRole('button', { name: 'Tools' });
  expect(btn.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(btn);
  await flush();
  expect(screen.getByLabelText('Tools', { selector: 'section' })).toBeTruthy();
  expect(btn.getAttribute('aria-pressed')).toBe('true');
  expect(usePlaceStore.getState().active).toBe('home');
  fireEvent.click(btn);
  await flush();
  expect(screen.queryByLabelText('Tools', { selector: 'section' })).toBeNull();
});

it('Escape, the close button and a click outside close it; a click inside does not', async () => {
  await openIt();
  fireEvent.pointerDown(screen.getByText('Accounts'));
  expect(useToolsStore.getState().open).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(useToolsStore.getState().open).toBe(false);
  act(() => useToolsStore.getState().openDrawer());
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Close Tools' }));
  expect(useToolsStore.getState().open).toBe(false);
  act(() => useToolsStore.getState().openDrawer());
  await flush();
  fireEvent.pointerDown(document.body);
  expect(useToolsStore.getState().open).toBe(false);
});

it('closes by itself after 2 minutes with no pointer over it; a pointer over it holds it open', async () => {
  await openIt();
  fireEvent.pointerEnter(screen.getByLabelText('Tools', { selector: 'section' }));
  await flush(AUTO_CLOSE_MS + 1000);
  expect(useToolsStore.getState().open).toBe(true);
  fireEvent.pointerLeave(screen.getByLabelText('Tools', { selector: 'section' }));
  await flush(AUTO_CLOSE_MS - 1000);
  expect(useToolsStore.getState().open).toBe(true);
  await flush(2000);
  expect(useToolsStore.getState().open).toBe(false);
});

it('opened from a link it rings Accounts for 2 seconds', async () => {
  await openIt('accounts');
  const block = document.querySelector('[data-section="accounts"]')!;
  expect(block.className).toContain('tools-ringed');
  expect(block.className.split(/\s+/)).not.toContain('ring');
  await flush(RING_MS + 100);
  expect(block.className).not.toContain('tools-ringed');
});

it('Tools class lists do not reuse bare shared work classes', async () => {
  const mod = 'node:fs';
  const fs = await import(/* @vite-ignore */ mod);
  const source = fs.readFileSync(['src', 'tools', 'ToolsDrawer.tsx'].join('/'), 'utf8');
  const work = fs.readFileSync(['src', 'styles', 'work.css'].join('/'), 'utf8');
  const shared = new Set([...work.matchAll(/^\.([a-z][a-z0-9-]*)\s*\{/gm)].map((m) => m[1]));
  const toolLists = [...source.matchAll(/['"]([^'"]*tools-[^'"]*)['"]/g)].flatMap((m) => m[1].split(/\s+/));
  expect(toolLists.filter((name) => shared.has(name))).toEqual([]);
});

it('Accounts: the signed-out calendar has Sign in, Spotify not set up has no button, and there is no Twitch row', async () => {
  await openIt();
  await flush();
  const list = screen.getByRole('list', { name: 'Accounts' });
  expect(list.textContent).toContain('Work calendar');
  expect(list.textContent).toContain('Second calendar');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  expect(list.textContent).toContain('Not set up');
  expect(list.textContent).not.toContain('Twitch');
  // Calendar sign out + calendar sign in; Spotify has none.
  expect(list.querySelectorAll('button')).toHaveLength(2);
});

it('Video look: chips from the Watch looks, the active one lit, a click uses the Watch setter', async () => {
  await openIt();
  const feathered = screen.getByRole('button', { name: 'Feathered' });
  const drive = screen.getByRole('button', { name: 'Drive-in' });
  expect(drive.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(feathered);
  expect(useWatchStore.getState().looks).toMatchObject({ mode: 'one', all: 'feather' });
  expect(feathered.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('How video sits in the sky on Watch')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Off' })).toBeNull();
});

it('Keys file: count and read time, Open calls the fixed command, Reload reads again', async () => {
  await openIt();
  await flush();
  expect(screen.getByText(/^keys\.json, 4 keys, read /)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(opened).toHaveBeenCalledTimes(1);
  expect(opened.mock.calls[0]).toEqual([undefined]);
  let reads = 0;
  keysAnswer = () => {
    reads += 1;
    return summary({ sets: [] , filePins: [key('x')] });
  };
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await flush();
  expect(reads).toBe(1);
  expect(screen.getByText(/^keys\.json, 1 key, read /)).toBeTruthy();
});

it('Keys file: no file says defaults, and a refusal shows amber with the whole reason on hover', async () => {
  keysAnswer = () => summary({ source: 'default' });
  await openIt();
  await flush();
  expect(screen.getByText('No keys.json. Defaults in use')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  act(() => useToolsStore.getState().close());
  resetKeysFeed();
  keysAnswer = () => {
    throw 'app 3, key 7: chord is not in the allowed key list';
  };
  act(() => useToolsStore.getState().openDrawer());
  await flush();
  const line = screen.getByText(/^keys\.json refused: app 3, key 7/);
  expect(line.className).toContain('bad');
});

it('an Open that fails says so', async () => {
  mocks.set('wall2_open_keys_file', () => Promise.reject('failed'));
  await openIt();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await flush();
  expect(screen.getByText('Could not open the file')).toBeTruthy();
});

it('keysLine and fileKeyCount', () => {
  expect(fileKeyCount(summary())).toBe(4);
  expect(keysLine({ status: 'loading' }, null).text).toBe('Reading keys.json');
  expect(keysLine({ status: 'problem', text: 'bad chord' }, null)).toMatchObject({ bad: true, text: 'keys.json refused: bad chord' });
  expect(keysLine({ status: 'ready', summary: summary({ source: 'default' }) }, null).text).toBe('No keys.json. Defaults in use');
});

it('Retry reads exactly once however it is clicked while the read is slow (clicks at 0.5, 1.5 and 3 seconds)', async () => {
  let release: (v: unknown) => void = () => undefined;
  const tasks = vi.fn(() => new Promise((r) => (release = r)));
  mocks.set('wall2_tasks_next', tasks);
  await openIt();
  // Opening the drawer already started the one read (no screen has the task list mounted).
  expect(tasks).toHaveBeenCalledTimes(1);
  const retry = screen.getByRole('button', { name: 'Retry Tasks' }) as HTMLButtonElement;
  await flush(500);
  fireEvent.click(retry);
  await flush(1000);
  fireEvent.click(retry);
  await flush(1500);
  fireEvent.click(retry);
  expect(tasks).toHaveBeenCalledTimes(1);
  release([]);
  await flush();
  expect(retry.disabled).toBe(false);
  fireEvent.click(retry);
  await flush();
  expect(tasks).toHaveBeenCalledTimes(2);
});

it('Escape is taken by the drawer, so fullscreen does not also leave', async () => {
  await openIt();
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => {
    document.dispatchEvent(e);
  });
  expect(e.defaultPrevented).toBe(true);
  expect(useToolsStore.getState().open).toBe(false);
  // With the drawer shut, Escape is left alone.
  const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => {
    document.dispatchEvent(again);
  });
  expect(again.defaultPrevented).toBe(false);
});

it('the 2 minute close waits while a browser sign-in is waiting', async () => {
  mocks.set('wall2_meet_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_cancel_sign_in', () => undefined);
  await openIt();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  await flush(AUTO_CLOSE_MS + 5000);
  expect(useToolsStore.getState().open).toBe(true);
  expect(screen.getByText('Waiting for the browser')).toBeTruthy();
});

it('closing on purpose during a calendar sign-in cancels it, and the next open says so', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_cancel_sign_in', (a) => cancel(a));
  await openIt();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  fireEvent.keyDown(document, { key: 'Escape' });
  await flush();
  expect(cancel).toHaveBeenCalled();
  act(() => useToolsStore.getState().openDrawer());
  await flush();
  expect(screen.getByText('Sign-in cancelled')).toBeTruthy();
  expect(screen.queryByText('Waiting for the browser')).toBeNull();
  await flush(7000);
  expect(screen.queryByText('Sign-in cancelled')).toBeNull();
});

it('closing on purpose during a Spotify sign-in cancels it too', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_spotify_status', () => ({ setup: true, signedIn: false }));
  mocks.set('wall2_spotify_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_spotify_cancel_sign_in', (a) => cancel(a));
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [] }));
  await openIt();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  act(() => useToolsStore.getState().close());
  await flush();
  expect(cancel).toHaveBeenCalled();
  expect(useToolsStore.getState().note).toBe('Sign-in cancelled');
});

it('the could not open note clears on the next success and on Reload', async () => {
  mocks.set('wall2_open_keys_file', () => Promise.reject('failed'));
  await openIt();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await flush();
  expect(screen.getByText('Could not open the file')).toBeTruthy();
  mocks.set('wall2_open_keys_file', () => undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await flush();
  expect(screen.queryByText('Could not open the file')).toBeNull();
  mocks.set('wall2_open_keys_file', () => Promise.reject('failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  expect(screen.queryByText('Could not open the file')).toBeNull();
});

it('Reload keeps the last good read for the deck and marks only the drawer line as reading', async () => {
  await openIt();
  await flush();
  keysAnswer = () => new Promise(() => undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  expect(useKeysFeedStore.getState().read.status).toBe('ready');
  expect(screen.getByText('Reading keys.json')).toBeTruthy();
});

// A sign-in that Rust is already running cannot be read from the status commands (neither the
// Spotify status nor the calendar accounts carry it), so the guarantee is the other way round:
// every way of closing the drawer cancels a waiting sign-in, and the idle close holds meanwhile.
const startWaitingCalendarSignIn = async (cancel: ReturnType<typeof vi.fn<(a?: unknown) => unknown>>) => {
  mocks.set('wall2_meet_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_cancel_sign_in', (a) => cancel(a));
  await openIt();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(screen.getByText('Waiting for the browser')).toBeTruthy();
};

it('a click outside cancels a waiting sign-in', async () => {
  const cancel = vi.fn();
  await startWaitingCalendarSignIn(cancel);
  fireEvent.pointerDown(document.body);
  await flush();
  expect(useToolsStore.getState().open).toBe(false);
  expect(cancel).toHaveBeenCalled();
  expect(useToolsStore.getState().note).toBe('Sign-in cancelled');
});

it('the close button cancels a waiting sign-in', async () => {
  const cancel = vi.fn();
  await startWaitingCalendarSignIn(cancel);
  fireEvent.click(screen.getByRole('button', { name: 'Close Tools' }));
  await flush();
  expect(cancel).toHaveBeenCalled();
});

it('the rail Tools button closing the drawer cancels a waiting sign-in', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_cancel_sign_in', (a) => cancel(a));
  render(
    <>
      <Rail />
      <ToolsDrawer />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
  await flush();
  expect(useToolsStore.getState().open).toBe(false);
  expect(cancel).toHaveBeenCalled();
});

it('the Escape close cancels a waiting Spotify sign-in too', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [] }));
  mocks.set('wall2_spotify_status', () => ({ setup: true, signedIn: false }));
  mocks.set('wall2_spotify_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_spotify_cancel_sign_in', (a) => cancel(a));
  await openIt();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  fireEvent.keyDown(document, { key: 'Escape' });
  await flush();
  expect(cancel).toHaveBeenCalled();
});

it('a place change leaves the drawer open with the sign-in still waiting and Cancel reachable, never unseen', async () => {
  const cancel = vi.fn();
  await startWaitingCalendarSignIn(cancel);
  act(() => usePlaceStore.setState({ active: 'home' }));
  await flush();
  expect(useToolsStore.getState().open).toBe(true);
  expect(screen.getByText('Waiting for the browser')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalled();
});

it('unmounting the drawer during a waiting sign-in cancels it (calendar)', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_cancel_sign_in', (a) => cancel(a));
  const view = render(<ToolsDrawer />);
  act(() => useToolsStore.getState().openDrawer());
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  view.unmount();
  await flush();
  expect(cancel).toHaveBeenCalled();
});
