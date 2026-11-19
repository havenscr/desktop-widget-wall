import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../../bridge/devMocks/libraryData';
import { mocks } from '../../bridge/tauri';
import { useSignalStore } from '../../signals/store';
import { resetTip } from '../../ui/HoverTip';
import { resetLibIndex } from '../../work/keyLibrary';
import { IDLE, type Show } from '../model';
import { MODE_STORAGE_KEY } from '../modes';
import { useOnAirStore } from '../store';
import { resetTakes } from '../takes';
import { CHAT_POLL_MS, STATUS_POLL_MS, type LiveChat, type LiveStatus } from '../ytlive';
import { useYtLive } from '../ytliveStore';
import { OnAir2 } from './OnAir2';

vi.setConfig({ testTimeout: 20_000 });

const MIN = 60_000;
const SHOW: Show = { state: 'ok', title: 'Friday stream', parts: [{ name: 'Load the data', minutes: 5, notes: ['Open the blank file'] }, { name: 'Shape the columns', minutes: 6, notes: [] }], skipped: 0, reason: null, readAt: 1 };
const SECRET = 'zebra-crossing-comment';

let statusReads: number;
let chatReads: number;
let status: LiveStatus;
let chat: LiveChat;
let channelSet: boolean;
let setChannelAnswer: () => unknown;
let show: Show;

const live = (over: Partial<LiveStatus> = {}): LiveStatus => ({ state: 'live', startedAt: Date.now() - 22 * MIN, scheduledAt: null, viewers: 37, chat: true, readAt: Date.now(), stale: false, word: null, statusLeft: 1000, chatLeft: 1000, ...over });
const msgs = (n: number, text = (i: number) => `comment ${i}`) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `Viewer ${i}`, text: text(i), at: Date.now() - (n - i) * 1000, superChat: i === 1 ? '$5.00' : null }));
const okChat = (n = 3): LiveChat => ({ state: 'ok', messages: msgs(n), readAt: Date.now(), stale: false, stoppedAt: null, word: null });

const open = async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'live' }));
  const r = render(<OnAir2 />);
  await waitFor(() => expect(useYtLive.getState().status).not.toBeNull());
  return r;
};

beforeEach(() => {
  localStorage.clear();
  statusReads = 0;
  chatReads = 0;
  status = live();
  chat = okChat();
  channelSet = true;
  show = SHOW;
  setChannelAnswer = () => ({ set: true, title: 'Sample Studio' });
  useYtLive.getState().reset();
  useOnAirStore.setState({ saved: IDLE, show: null, showError: null, marks: null, marksDate: null, marksNote: null, showNote: null, marking: false });
  resetLibIndex();
  resetTakes();
  mocks.set('wall2_onair_show', () => show);
  mocks.set('wall2_onair_marks_today', () => ({ today: 0, last: [], lastParts: [] }));
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_keys_send_library', () => null);
  mocks.set('wall2_signals_report', () => null);
  mocks.set('wall2_ytlive_channel', () => ({ set: channelSet, title: channelSet ? 'Sample Studio' : null }));
  mocks.set('wall2_ytlive_status', () => (statusReads++, status));
  mocks.set('wall2_ytlive_chat', () => (chatReads++, chat));
  mocks.set('wall2_ytlive_set_channel', () => setChannelAnswer());
  mocks.set('wall2_ytlive_forget_channel', () => null);
  act(() => useSignalStore.setState({ known: true, recording: false, call: null, browserAv: false }));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  resetTip();
  mocks.clear();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  useSignalStore.setState({ known: false, recording: false, call: null, browserAv: false });
});

it('draws the Live page: chip, comments newest at the bottom, the foot, and the run line', async () => {
  chat = { ...okChat(3), messages: msgs(3, (i) => (i === 2 ? SECRET : `comment ${i}`)) };
  await open();
  await waitFor(() => expect(screen.getByText(SECRET)).toBeTruthy());
  expect(screen.getByText(/^Live, 37 watching, since/)).toBeTruthy();
  const rows = [...document.querySelectorAll('.oa2-cm-t')].map((e) => e.textContent);
  expect(rows[rows.length - 1]).toBe(SECRET);
  expect(screen.getByText('YouTube only, read every 10 seconds.')).toBeTruthy();
  expect(screen.getByText('$5.00')).toBeTruthy();
  // Comment rows are not buttons.
  expect(document.querySelectorAll('.oa2-cms button').length).toBe(0);
  await waitFor(() => expect(screen.getByText(/^Part 1 of 2: Load the data/)).toBeTruthy());
  // Row 2 of the studio keys: three tiles; the prompter and status boxes stay empty.
  expect(document.querySelectorAll('.oa2-studiokeys .key-tile').length).toBe(3);
  expect(document.querySelector('.oa2-empty-live')?.children.length).toBe(0);
  expect(document.querySelector('.oa2-empty-status')?.children.length).toBe(0);
});

it('the run line is not drawn without parts', async () => {
  show = { ...SHOW, state: 'missing', parts: [] };
  await open();
  await waitFor(() => expect(document.querySelector('.oa2-runline')).not.toBeNull());
  expect((document.querySelector('.oa2-runline') as HTMLElement).hidden).toBe(true);
});

it('says so when the comments cannot be read: no channel, signed out, refused', async () => {
  channelSet = false;
  status = live({ state: 'not-set-up', chat: false });
  const a = await open();
  await waitFor(() => expect(screen.getByText('Name your YouTube channel to show its comments here.')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Name channel' })).toBeTruthy();
  a.unmount();
  useYtLive.getState().reset();
  status = live({ state: 'signed-out', chat: false });
  const b = await open();
  await waitFor(() => expect(screen.getByText('Sign in to YouTube to show comments here.')).toBeTruthy());
  b.unmount();
  useYtLive.getState().reset();
  channelSet = true;
  status = live();
  chat = { state: 'off', messages: [], readAt: null, stale: false, stoppedAt: null, word: 'refused' };
  await open();
  await waitFor(() => expect(screen.getByText('YouTube would not let the wall read this chat.')).toBeTruthy());
});

it('the channel field: empty, an unknown name, a good name, and Escape closes the field only', async () => {
  channelSet = false;
  status = live({ state: 'not-set-up', chat: false });
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Name channel' }));
  const field = screen.getByLabelText('YouTube channel') as HTMLInputElement;
  expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
  setChannelAnswer = () => {
    throw 'not found';
  };
  fireEvent.change(field, { target: { value: '@nobody' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('YouTube has no channel with that handle')).toBeTruthy());
  setChannelAnswer = () => ({ set: true, title: 'Sample Studio' });
  status = live({ state: 'none', chat: false });
  fireEvent.change(field, { target: { value: '@sample' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('Channel: Sample Studio')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  fireEvent.keyDown(screen.getByLabelText('YouTube channel'), { key: 'Escape' });
  expect(screen.queryByLabelText('YouTube channel')).toBeNull();
  expect(document.querySelector('.oa2-comments')).not.toBeNull();
});

it('an invalid channel text shows the fixed words, and a failure shows the generic line', async () => {
  channelSet = false;
  status = live({ state: 'not-set-up', chat: false });
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Name channel' }));
  fireEvent.change(screen.getByLabelText('YouTube channel'), { target: { value: 'hello' } });
  setChannelAnswer = () => {
    throw 'invalid';
  };
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('That is not a handle or a channel link')).toBeTruthy());
  setChannelAnswer = () => {
    throw 'boom';
  };
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('Could not check the channel')).toBeTruthy());
});

it('starts the timer from the broadcast start once, only when idle, and never again after a Reset', async () => {
  await open();
  await waitFor(() => expect(useOnAirStore.getState().saved.running).toBe(true));
  const started = useOnAirStore.getState().saved.startedAt!;
  expect(Math.abs(started - (Date.now() - 22 * MIN))).toBeLessThan(5000);
  expect(await screen.findByText(/when the broadcast went live\./)).toBeTruthy();
  act(() => useOnAirStore.getState().stop());
  act(() => useOnAirStore.getState().reset());
  await act(async () => {
    await useYtLive.getState().readStatus(true);
  });
  expect(useOnAirStore.getState().saved.running).toBe(false);
});

it('leaves a stopped timer alone', async () => {
  useOnAirStore.setState({ saved: { ...IDLE, running: false, accumulatedMs: 5 * MIN, firstStartAt: Date.now() - 9 * MIN, stoppedAt: Date.now() - MIN } });
  await open();
  await act(async () => {
    await useYtLive.getState().readStatus(true);
  });
  expect(useOnAirStore.getState().saved.running).toBe(false);
  expect(useOnAirStore.getState().saved.accumulatedMs).toBe(5 * MIN);
});

it('the stale and quota lines', async () => {
  status = live({ readAt: Date.now() - 14 * MIN, stale: true });
  chat = { ...okChat(), readAt: Date.now() - 14 * MIN, stale: true };
  const a = await open();
  await waitFor(() => expect(screen.getByText('YouTube has not answered for 14 min. These are the last comments read.')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  expect(screen.getByText(/^Live, as of/)).toBeTruthy();
  a.unmount();
  useYtLive.getState().reset();
  status = live();
  chat = { ...okChat(), state: 'quota', stoppedAt: Date.now() - 43 * MIN, word: 'quota' };
  await open();
  await waitFor(() => expect(screen.getByText(/^Today's YouTube reads are used up\. Comments stopped here at/)).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
});

it('live with no comments yet says when they come', async () => {
  chat = { ...okChat(0) };
  await open();
  await waitFor(() => expect(screen.getByText('No comments yet. They show here within about 10 seconds of being posted.')).toBeTruthy());
});

it('the list holds its place while the pointer is on it', async () => {
  chat = okChat(3);
  await open();
  await waitFor(() => expect(document.querySelectorAll('.oa2-cm').length).toBe(3));
  const list = document.querySelector('.oa2-cms[role="log"]') as HTMLElement;
  fireEvent.pointerEnter(list);
  chat = { ...okChat(5) };
  await act(async () => {
    await useYtLive.getState().readChat();
  });
  expect(document.querySelectorAll('.oa2-cm').length).toBe(3);
  fireEvent.pointerLeave(list);
  expect(document.querySelectorAll('.oa2-cm').length).toBe(5);
});

it('polls the status every 60 s and the chat every 10 s only while live; nothing while hidden or with no live broadcast', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'live' }));
  render(<OnAir2 />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(statusReads).toBe(1);
  expect(chatReads).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHAT_POLL_MS * 3);
  });
  expect(chatReads).toBe(4);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);
  });
  expect(statusReads).toBe(2);
  // Hidden: nothing is read.
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  const s = statusReads;
  const c = chatReads;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 2);
  });
  expect(statusReads).toBe(s);
  expect(chatReads).toBe(c);
});

it('reads no chat when the status is not live', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  status = live({ state: 'none', chat: false });
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'live' }));
  render(<OnAir2 />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHAT_POLL_MS * 4);
  });
  expect(chatReads).toBe(0);
});

it('writes no chat text, name or channel to storage or the console', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  chat = { ...okChat(2), messages: msgs(2, () => SECRET) };
  await open();
  await waitFor(() => expect(screen.getAllByText(SECRET).length).toBeGreaterThan(0));
  const stored = JSON.stringify({ ...localStorage });
  for (const needle of [SECRET, 'Viewer 0', 'Sample Studio']) {
    expect(stored.includes(needle)).toBe(false);
    for (const spy of [log, warn, err]) expect(JSON.stringify(spy.mock.calls).includes(needle)).toBe(false);
  }
  log.mockRestore();
  warn.mockRestore();
  err.mockRestore();
});

it('live without a chat clears the old chat, reads no chat, and says the chat is off', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'live' }));
  render(<OnAir2 />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(useYtLive.getState().chat).not.toBeNull();
  expect(document.querySelectorAll('.oa2-cm').length).toBe(3);
  const before = chatReads;
  status = live({ chat: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS + 50);
  });
  expect(useYtLive.getState().chat).toBeNull();
  expect(screen.getByText('Chat is off for this broadcast')).toBeTruthy();
  expect(document.querySelectorAll('.oa2-cm').length).toBe(0);
  const after = chatReads;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHAT_POLL_MS * 6);
  });
  expect(chatReads).toBe(after);
  expect(after).toBeGreaterThanOrEqual(before);
});

const KEY = 'wall2-onair-split';
const handle = () => screen.getByRole('separator') as HTMLElement;
const cw = () => (document.querySelector('.oa2-comments') as HTMLElement).style.width;
const nw = () => (document.querySelector('.oa2-livenotes') as HTMLElement).style.width;
const ptr = (el: Element, type: string, x: number) => fireEvent(el, new MouseEvent(type, { clientX: x, bubbles: true }));

it('the split: starts 620 / 436, a drag clamps, a double click resets, arrows move 20 px', async () => {
  await open();
  await waitFor(() => expect(cw()).toBe('620px'));
  expect(nw()).toBe('436px');
  ptr(handle(), 'pointerdown', 1000);
  ptr(handle(), 'pointermove', 900);
  expect(cw()).toBe('520px');
  expect(nw()).toBe('536px');
  ptr(handle(), 'pointermove', -5000);
  expect(cw()).toBe('360px');
  ptr(handle(), 'pointermove', 9000);
  expect(cw()).toBe('756px');
  expect(nw()).toBe('300px');
  ptr(handle(), 'pointerup', 9000);
  fireEvent.doubleClick(handle());
  expect(cw()).toBe('620px');
  fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
  expect(cw()).toBe('600px');
  fireEvent.keyDown(handle(), { key: 'ArrowRight' });
  fireEvent.keyDown(handle(), { key: 'ArrowRight' });
  expect(cw()).toBe('640px');
});

it('the split: folding the notes and the comments, and restoring from the rail', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: /Fill the space with the comments/ }));
  expect(document.querySelector('.oa2-rail-notes')).not.toBeNull();
  expect(cw()).toBe('984px');
  expect(screen.queryByRole('separator')).toBeNull();
  fireEvent.click(document.querySelector('.oa2-rail-notes') as HTMLElement);
  expect(cw()).toBe('620px');
  fireEvent.click(screen.getByRole('button', { name: /Fill the space with the notes/ }));
  const rail = document.querySelector('.oa2-rail-comments') as HTMLElement;
  expect(rail).not.toBeNull();
  expect(nw()).toBe('984px');
  expect(rail.querySelector('.oa2-rail-n')?.textContent).toBe('0');
  chat = { ...okChat(5), messages: msgs(5) };
  await act(async () => {
    await useYtLive.getState().readChat();
  });
  await waitFor(() => expect(rail.querySelector('.oa2-rail-n')?.textContent).toBe('2'));
  fireEvent.click(rail);
  expect(cw()).toBe('620px');
});

it('the split: a reload in the same show keeps it, a new show resets it', async () => {
  const a = await open();
  fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
  expect(cw()).toBe('600px');
  const stored = localStorage.getItem(KEY) as string;
  expect(JSON.parse(stored).comments).toBe(600);
  a.unmount();
  useYtLive.getState().reset();
  await open();
  await waitFor(() => expect(cw()).toBe('600px'));
  cleanup();
  useYtLive.getState().reset();
  status = live({ startedAt: Date.now() - 3 * 60 * MIN });
  await open();
  await waitFor(() => expect(cw()).toBe('620px'));
});

it('the split: a storage that throws does not stop it', async () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string) {
    if (k === KEY) throw new Error('blocked');
  });
  await open();
  fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
  expect(cw()).toBe('600px');
  spy.mockRestore();
});
