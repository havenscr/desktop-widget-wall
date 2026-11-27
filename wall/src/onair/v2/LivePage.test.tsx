import css from '../../styles/onair2.css?raw';
import workCss from '../../styles/work.css?raw';
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
/** The native side stamps readAt and stoppedAt in Unix seconds. */
const sec = (ms: number): number => Math.floor(ms / 1000);
const SHOW: Show = { state: 'ok', title: 'Friday stream', parts: [{ name: 'Load the data', minutes: 5, notes: ['Open the blank file'] }, { name: 'Shape the columns', minutes: 6, notes: [] }], skipped: 0, reason: null, readAt: 1 };
const SECRET = 'zebra-crossing-comment';

let statusReads: number;
let chatReads: number;
let status: LiveStatus;
let chat: LiveChat;
let channelSet: boolean;
let setChannelAnswer: () => unknown;
let show: Show;

const live = (over: Partial<LiveStatus> = {}): LiveStatus => ({ state: 'live', startedAt: Date.now() - 22 * MIN, scheduledAt: null, viewers: 37, chat: true, readAt: sec(Date.now()), stale: false, word: null, statusLeft: 1000, chatLeft: 1000, ...over });
const msgs = (n: number, text = (i: number) => `comment ${i}`) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `Viewer ${i}`, text: text(i), at: Date.now() - (n - i) * 1000, superChat: i === 1 ? '$5.00' : null }));
const okChat = (n = 3): LiveChat => ({ state: 'ok', messages: msgs(n), readAt: sec(Date.now()), stale: false, stoppedAt: null, word: null });

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
  // Comment rows are not buttons: the heading's expand button is the card's only button.
  expect(document.querySelectorAll('.oa2-comments button:not(.oa2-exp)').length).toBe(0);
  expect(document.querySelectorAll('.oa2-comments .oa2-exp').length).toBe(1);
  // No Part line and no part arrows: the run line is hidden and the notes are one list.
  await waitFor(() => expect(document.querySelectorAll('.oa2-livenotes .oa-note').length).toBeGreaterThan(0));
  expect((document.querySelector('.oa2-runline') as HTMLElement).hidden).toBe(true);
  expect(screen.queryByText(/^Part \d+ of \d+/)).toBeNull();
  expect(screen.queryByRole('button', { name: /(Previous|Next) part/ })).toBeNull();
  // The studio keys: eight equal keys; the prompter box holds the pop-out controls and the status block is drawn.
  expect(document.querySelectorAll('.oa2-studiokeys .oa2-skgrid .key-tile').length).toBe(8);
  expect(document.querySelector('.oa2-stagepop')).not.toBeNull();
  expect(document.querySelector('.oa2-empty-live')).toBeNull();
  expect(document.querySelector('.oa2-studiostatus')).not.toBeNull();
});

it('the run line says why there are no parts, and Open file asks for the file, in all three cases', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_onair_open', (args) => void opened.push(args));
  const line = () => document.querySelector('.oa2-runline') as HTMLElement;
  // The store is set directly: the five second floor between reads would skip a second read of the file here.
  const put = (patch: Partial<ReturnType<typeof useOnAirStore.getState>>) => act(() => useOnAirStore.setState({ show: null, showError: null, showNote: null, ...patch }));
  await open();
  // A refused file: the reason itself.
  put({ show: { ...SHOW, state: 'refused', parts: [], reason: 'run-of-show.txt is over 32 KB' } });
  expect(line().hidden).toBe(false);
  expect(line().textContent).toContain('run-of-show.txt is over 32 KB');
  fireEvent.click(line().querySelector('button') as HTMLElement);
  await waitFor(() => expect(opened).toEqual([{ which: 'show' }]));
  // No file.
  put({ show: { ...SHOW, state: 'missing', parts: [], reason: null } });
  expect(line().textContent).toContain('No run-of-show.txt yet');
  // A failed read, and a failed Open file.
  put({ showError: 'Could not read run-of-show.txt' });
  expect(line().textContent).toContain('Could not read run-of-show.txt');
  put({ showNote: 'Could not open run-of-show.txt' });
  expect(line().textContent).toContain('Could not open run-of-show.txt');
  // Nothing wrong and nothing read yet: hidden.
  put({});
  expect(line().hidden).toBe(true);
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

it('the channel chips: a tap sends that handle, the lit chip follows the saved channel, no text field', async () => {
  channelSet = false;
  status = live({ state: 'not-set-up', chat: false });
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Name channel' }));
  expect(document.querySelector('.oa2-chf input')).toBeNull();
  expect(screen.queryByLabelText('YouTube channel')).toBeNull();
  const ae = screen.getByRole('button', { name: 'Analytic Endeavors' });
  const hc = screen.getByRole('button', { name: 'Havens Consulting' });
  expect(ae.getAttribute('data-lit')).toBe('false');
  const sent: unknown[] = [];
  mocks.set('wall2_ytlive_set_channel', (args) => {
    sent.push((args as { text: string }).text);
    return setChannelAnswer();
  });
  setChannelAnswer = () => ({ set: true, title: 'Havens Consulting' });
  status = live({ state: 'none', chat: false });
  fireEvent.click(hc);
  await waitFor(() => expect(screen.getByText('Channel: Havens Consulting')).toBeTruthy());
  expect(sent).toEqual(['@HavensConsulting']);
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  expect(screen.getByRole('button', { name: 'Havens Consulting' }).getAttribute('data-lit')).toBe('true');
  expect(screen.getByRole('button', { name: 'Analytic Endeavors' }).getAttribute('data-lit')).toBe('false');
  setChannelAnswer = () => ({ set: true, title: 'Analytic Endeavors' });
  fireEvent.click(screen.getByRole('button', { name: 'Analytic Endeavors' }));
  await waitFor(() => expect(screen.getByText('Channel: Analytic Endeavors')).toBeTruthy());
  expect(sent).toEqual(['@HavensConsulting', '@AnalyticEndeavors']);
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Analytic Endeavors' }), { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Havens Consulting' })).toBeNull();
  expect(document.querySelector('.oa2-comments')).not.toBeNull();
});

it('a refused chip shows the fixed words, and a failure shows the generic line', async () => {
  channelSet = false;
  status = live({ state: 'not-set-up', chat: false });
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Name channel' }));
  setChannelAnswer = () => {
    throw 'not found';
  };
  fireEvent.click(screen.getByRole('button', { name: 'Analytic Endeavors' }));
  await waitFor(() => expect(screen.getByText('YouTube has no channel with that handle')).toBeTruthy());
  setChannelAnswer = () => {
    throw 'boom';
  };
  fireEvent.click(screen.getByRole('button', { name: 'Havens Consulting' }));
  await waitFor(() => expect(screen.getByText('Could not check the channel')).toBeTruthy());
});

it('the lit chip follows the stored handle, then falls back to the name inside a longer title', async () => {
  const { litChip, HANDLE_KEY } = await import('./ChannelField');
  expect(litChip('Analytic Endeavors LLC', null)).toBe(0);
  expect(litChip('HAVENS CONSULTING | Power BI', null)).toBe(1);
  expect(litChip('Sample Studio', null)).toBe(-1);
  expect(litChip('Sample Studio', '@HavensConsulting')).toBe(1);
  expect(litChip('Havens Consulting', '@analyticendeavors')).toBe(0);
  expect(litChip(null, '@other')).toBe(-1);
  // Stored handle wins in the card, even when the YouTube title names neither chip.
  localStorage.setItem(HANDLE_KEY, '@AnalyticEndeavors');
  channelSet = true;
  status = live({ state: 'none', chat: false });
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
  expect(screen.getByRole('button', { name: 'Analytic Endeavors' }).getAttribute('data-lit')).toBe('true');
  expect(screen.getByRole('button', { name: 'Havens Consulting' }).getAttribute('data-lit')).toBe('false');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Analytic Endeavors' }));
});

it('a title with extra words lights its chip when nothing is stored, and the picker focuses the first chip when none is lit', async () => {
  mocks.set('wall2_ytlive_channel', () => ({ set: true, title: 'Havens Consulting | Power BI' }));
  status = live({ state: 'none', chat: false });
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
  expect(screen.getByRole('button', { name: 'Havens Consulting' }).getAttribute('data-lit')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Havens Consulting' }));
  cleanup();
  useYtLive.getState().reset();
  mocks.set('wall2_ytlive_channel', () => ({ set: false, title: null }));
  status = live({ state: 'not-set-up', chat: false });
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Name channel' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Analytic Endeavors' }));
});

it('a tap while the channel is being checked is ignored', async () => {
  channelSet = false;
  status = live({ state: 'not-set-up', chat: false });
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Name channel' }));
  let release: () => void = () => {};
  const sent: unknown[] = [];
  mocks.set('wall2_ytlive_set_channel', (args) => {
    sent.push((args as { text: string }).text);
    return new Promise((r) => {
      release = () => r({ set: true, title: 'Analytic Endeavors' });
    });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Analytic Endeavors' }));
  await waitFor(() => expect(screen.getByText('Checking the channel')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Havens Consulting' }));
  fireEvent.click(screen.getByRole('button', { name: 'Analytic Endeavors' }));
  expect(sent).toEqual(['@AnalyticEndeavors']);
  status = live({ state: 'none', chat: false });
  await act(async () => release());
  await waitFor(() => expect(screen.getByText('Channel: Analytic Endeavors')).toBeTruthy());
});

const norm = (t: string) => t.replace(/\r\n/g, '\n');

it('the comments card is solid in every state: no dashed attribute and no transparent rule, with the panel background present', async () => {
  const sheet = norm(css);
  const work = norm(workCss);
  expect(sheet).toMatch(/\.oa2 \.oa2-comments \{[^}]*left: 676px/);
  expect(work).toMatch(/\n\.panel \{[^}]*background: linear-gradient/);
  expect(sheet).not.toMatch(/oa2-comments\[data-dashed/);
  expect(sheet).not.toMatch(/\.oa2-comments[^{]*\{[^}]*(transparent|dashed)/);
  const states: [LiveStatus, boolean][] = [
    [live({ state: 'not-set-up', chat: false }), false],
    [live({ state: 'live' }), true],
  ];
  for (const [st, set] of states) {
    channelSet = set;
    status = st;
    useYtLive.getState().reset();
    const r = await open();
    await waitFor(() => expect(document.querySelector('.oa2-comments')).not.toBeNull());
    const card = document.querySelector('.oa2-comments') as HTMLElement;
    expect(card.hasAttribute('data-dashed')).toBe(false);
    expect(card.style.background).toBe('');
    r.unmount();
  }
  // The reading state: before the first status answer.
  useYtLive.getState().reset();
  mocks.set('wall2_ytlive_status', () => new Promise(() => {}));
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'live' }));
  render(<OnAir2 />);
  await waitFor(() => expect(document.querySelector('.oa2-comments')?.getAttribute('data-view')).toBe('reading'));
  expect(document.querySelector('.oa2-comments')?.hasAttribute('data-dashed')).toBe(false);
});

it('the chip CSS is 16 px or more and never wraps', () => {
  const sheet = norm(css);
  const rule = /\.oa2 \.oa2-chip \{([^}]*)\}/.exec(sheet)?.[1] ?? '';
  expect(rule).toMatch(/white-space: nowrap/);
  const px = Number(/font: \d+ (\d+)px/.exec(rule)?.[1]);
  expect(px).toBeGreaterThanOrEqual(16);
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
  status = live({ readAt: sec(Date.now() - 14 * MIN), stale: true });
  chat = { ...okChat(), readAt: sec(Date.now() - 14 * MIN), stale: true };
  const a = await open();
  await waitFor(() => expect(screen.getByText('YouTube has not answered for 14 min. These are the last comments read.')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  expect(screen.getByText(/^Live, as of/)).toBeTruthy();
  a.unmount();
  useYtLive.getState().reset();
  status = live();
  chat = { ...okChat(), state: 'quota', stoppedAt: sec(Date.now() - 43 * MIN), word: 'quota' };
  await open();
  await waitFor(() => expect(screen.getByText(/^Today's YouTube reads are used up\. Comments stopped here at/)).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
});

it('a read 14 minutes old in native seconds shows the stale foot even when native says fresh', async () => {
  status = live({ readAt: sec(Date.now() - 14 * MIN) });
  chat = { ...okChat(), readAt: sec(Date.now() - 14 * MIN) };
  await open();
  await waitFor(() => expect(screen.getByText('YouTube has not answered for 14 min. These are the last comments read.')).toBeTruthy());
});

it('a fresh read in native seconds does not show the stale foot', async () => {
  await open();
  await waitFor(() => expect(screen.getByText('comment 0')).toBeTruthy());
  expect(screen.queryByText(/YouTube has not answered/)).toBeNull();
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

it('shows a long handle and a long unbroken link in full, with no clamp or ellipsis on the row', async () => {
  const handle = '@SampleViewerWithAVeryLongHandleName2026';
  const link = 'https://www.example.com/r/sample/comments/abc123/a_very_long_unbroken_link_that_goes_on_and_on_with_no_spaces_at_all';
  chat = { ...okChat(2), messages: [{ id: 'a', name: handle, text: link, at: Date.now() - 2000, superChat: null }, { id: 'b', name: 'Viewer', text: 'Thanks', at: Date.now() - 1000, superChat: null }] };
  await open();
  await waitFor(() => expect(screen.getByText(link)).toBeTruthy());
  expect(screen.getByText(handle).textContent).toBe(handle);
  const sheet = css.replace(/\r\n/g, '\n');
  const rule = (sel: string) => {
    const m = new RegExp(`^\\${sel}\\s*\\{([^}]*)\\}`, 'm').exec(sheet);
    expect(m).not.toBeNull();
    return m![1];
  };
  for (const sel of ['.oa2-cm-n', '.oa2-cm-t']) {
    const body = rule(sel);
    expect(body).toContain('overflow-wrap: anywhere');
    expect(body).not.toMatch(/text-overflow|line-clamp|nowrap|overflow: hidden/);
  }
  expect(rule('.oa2-cm-b')).toContain('flex-wrap: wrap');
});

const PIC = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';

it('shows a commenter picture as a 40 px lazy round image with no referrer and no alt text', async () => {
  chat = { ...okChat(1), messages: [{ id: 'a', name: '@Sample', text: 'hi there', at: Date.now() - 2000, superChat: null, avatar: PIC }] };
  await open();
  await waitFor(() => expect(screen.getByText('hi there')).toBeTruthy());
  const img = document.querySelector('.oa2-cm img') as HTMLImageElement;
  expect(img.getAttribute('src')).toBe(PIC);
  expect(img.getAttribute('alt')).toBe('');
  expect(img.getAttribute('decoding')).toBe('async');
  expect(img.getAttribute('loading')).toBe('lazy');
  expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(img.getAttribute('width')).toBe('40');
  expect(img.getAttribute('data-loaded')).toBe('false');
  fireEvent.load(img);
  expect(img.getAttribute('data-loaded')).toBe('true');
  const sheet = css.replace(/\r\n/g, '\n');
  expect(sheet).toMatch(/\.oa2-cm-av img \{[^}]*opacity: 0;[^}]*transition: opacity/);
  expect(sheet).toMatch(/\.oa2-cm-av \{[^}]*width: 40px;[^}]*height: 40px;[^}]*border-radius: 50%/);
});

it('shows a round letter tile when there is no picture or the picture fails to load', async () => {
  chat = {
    ...okChat(2),
    messages: [
      { id: 'a', name: '@marlo_sample', text: 'no picture here', at: Date.now() - 2000, superChat: null },
      { id: 'b', name: 'Zed', text: 'broken picture here', at: Date.now() - 1000, superChat: null, avatar: PIC },
    ],
  };
  await open();
  await waitFor(() => expect(screen.getByText('broken picture here')).toBeTruthy());
  let tiles = [...document.querySelectorAll('.oa2-cm-tile')].map((t) => t.textContent);
  expect(tiles).toEqual(['M']);
  fireEvent.error(document.querySelector('.oa2-cm img') as HTMLImageElement);
  await waitFor(() => expect(document.querySelectorAll('.oa2-cm img').length).toBe(0));
  tiles = [...document.querySelectorAll('.oa2-cm-tile')].map((t) => t.textContent);
  expect(tiles).toEqual(['M', 'Z']);
  expect((document.querySelector('.oa2-cm-tile') as HTMLElement).style.background).toMatch(/^(hsl|rgb)/);
});
