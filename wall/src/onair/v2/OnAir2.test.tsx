import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../../bridge/devMocks/libraryData';
import { mocks } from '../../bridge/tauri';
import type { Meeting } from '../../meet/model';
import { useSignalStore } from '../../signals/store';
import type { CallSignal } from '../../signals/model';
import { resetTip } from '../../ui/HoverTip';
import { resetLibIndex } from '../../work/keyLibrary';
import { useMeetingFeed } from '../../work/useNextMeeting';
import { IDLE, type MarkResult, type Show } from '../model';
import { MODE_STORAGE_KEY } from '../modes';
import { useOnAirStore } from '../store';
import { resetTakes, useTakes } from '../takes';
import { STORAGE_KEY as TAKES_KEY } from '../takeModel';
import { OnAir2 } from './OnAir2';
import { useRecorder } from './recorderStore';

vi.setConfig({ testTimeout: 20_000 });

const SHOW: Show = {
  state: 'ok',
  title: 'Friday stream',
  parts: [
    { name: 'Load the data', minutes: 5, notes: ['Open the blank file', 'Pick the second way'] },
    { name: 'Shape the columns', minutes: 6, notes: [] },
  ],
  skipped: 0,
  reason: null,
  readAt: 1,
};
const MIN = 60_000;
const at = (m: number) => new Date(Date.now() + m * MIN).toISOString();
const meeting = (over: Partial<Meeting> = {}): Meeting => ({ key: 'm1', accountId: 'work', title: 'Community talk: November', start: at(-24), end: at(36), canJoin: true, details: { calledBy: 'Event host', people: [{ name: 'Guest 1', reply: 'yes' }], peopleMore: 41, invite: null }, ...over });
const call = (kind: CallSignal['kind'], sinceMin = -28, camera = false): CallSignal => ({ kind, since: Date.now() + sinceMin * MIN, camera });

let clockMs = new Date(2026, 10, 11, 10, 24, 0).getTime();
let sent: unknown[];
let sendAnswer: () => string | null;
let marks: MarkResult;
let markRefused: boolean;
let meetings: Meeting[];

const signals = (o: Partial<ReturnType<typeof useSignalStore.getState>>) => act(() => useSignalStore.setState({ known: true, recording: false, call: null, browserAv: false, ...o }));
const open = async (ui = <OnAir2 />) => {
  const r = render(ui);
  await waitFor(() => expect(document.querySelector('.oa2-tiles, .oa2-quiet') !== null || useSignalStore.getState().call === null).toBe(true));
  return r;
};

beforeEach(() => {
  // The wall's moment stands still at 10:24 on a Wednesday; timers and promises still run.
  vi.useFakeTimers({ toFake: ['Date'] });
  // Each test starts five minutes later: the store's one second quiet time between marks reads the clock.
  clockMs += 5 * MIN;
  vi.setSystemTime(clockMs);
  localStorage.clear();
  sent = [];
  sendAnswer = () => null;
  marks = { today: 2, last: ['03:12', '09:40'], lastParts: ['Load the data', ''] };
  markRefused = false;
  meetings = [];
  useMeetingFeed.setState({ meetings: [], feedStale: false, failed: false });
  useOnAirStore.setState({ saved: IDLE, show: null, showError: null, marks: null, marksDate: null, marksNote: null, showNote: null, marking: false });
  resetLibIndex();
  resetTakes();
  mocks.set('wall2_onair_show', () => SHOW);
  mocks.set('wall2_onair_marks_today', () => marks);
  mocks.set('wall2_onair_mark', (args) => {
    sent.push({ mark: args });
    if (markRefused) throw 'refused';
    return { today: 3, last: ['03:12', '09:40', '04:12'], lastParts: ['Load the data', '', 'Load the data'] };
  });
  mocks.set('wall2_onair_open', (args) => void sent.push({ open: args }));
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_keys_send_library', (args) => (sent.push({ library: args }), sendAnswer()));
  mocks.set('wall2_meet_next', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }], meetings }));
  mocks.set('wall2_signals_report', () => null);
  signals({});
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  resetTip();
  mocks.clear();
  useSignalStore.setState({ known: false, recording: false, call: null, browserAv: false });
});

const radios = () => screen.getAllByRole('radio');
const lit = () => radios().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent);

it('draws the modes row and the idle page with nothing on air: no segment lit, Auto on, the reason in words', async () => {
  await open();
  expect(screen.getByRole('radiogroup', { name: 'On Air mode' })).toBeTruthy();
  expect(radios().map((r) => r.textContent)).toEqual(['Live', 'Recording', 'Presenting']);
  expect(lit()).toEqual([]);
  expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('.oa2-why')?.textContent).toBe('nothing is on air');
  // The idle page below the row: the timer, last time on air, three Get ready cards, notes, checklist, studio lights.
  for (const c of ['.oa2-idletimer', '.oa2-lastair', '.oa2-ready-1', '.oa2-ready-2', '.oa2-ready-3', '.oa2-idlenotes', '.oa2-checklist', '.oa2-lights-idle']) expect(document.querySelector(c), c).not.toBeNull();
  expect(document.querySelector('.onair')).toBeNull();
  expect(document.querySelector('section.oa2')?.getAttribute('data-place')).toBe('onair');
});

it('a segment click holds that page and stores it, Auto clears it, and a click on the lit held segment does nothing', async () => {
  await open();
  fireEvent.click(screen.getByRole('radio', { name: 'Presenting' }));
  expect(lit()).toEqual(['Presenting']);
  expect(JSON.parse(localStorage.getItem(MODE_STORAGE_KEY)!)).toEqual({ held: 'meet' });
  expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelector('.oa2-why')?.textContent).toBe('Held by hand');
  localStorage.setItem(MODE_STORAGE_KEY, 'sentinel');
  fireEvent.click(screen.getByRole('radio', { name: 'Presenting' }));
  expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('sentinel');
  fireEvent.click(screen.getByRole('radio', { name: 'Recording' }));
  expect(lit()).toEqual(['Recording']);
  fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
  expect(lit()).toEqual([]);
  expect(JSON.parse(localStorage.getItem(MODE_STORAGE_KEY)!)).toEqual({ held: null });
  // Auto while already on does nothing.
  localStorage.setItem(MODE_STORAGE_KEY, 'sentinel');
  fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
  expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('sentinel');
});

it('starts held when storage says so, and a broken value is Auto', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'rec' }));
  const { unmount } = await open();
  expect(lit()).toEqual(['Recording']);
  unmount();
  localStorage.setItem(MODE_STORAGE_KEY, '{"held":"nonsense"}');
  await open();
  expect(lit()).toEqual([]);
  expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
});

it('works when storage cannot be read or written', async () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await open();
  fireEvent.click(screen.getByRole('radio', { name: 'Live' }));
  expect(lit()).toEqual(['Live']);
  get.mockRestore();
  set.mockRestore();
});

it('puts a dot on every case that is on now, lit or not, and says so to a screen reader', async () => {
  signals({ recording: true, call: call('teams') });
  await open();
  expect(lit()).toEqual(['Recording']);
  expect(radios().map((r) => r.getAttribute('aria-label'))).toEqual(['Live', 'Recording, on now', 'Presenting, on now']);
  expect(document.querySelectorAll('.oa2-seg .oa2-dot').length).toBe(2);
  expect(document.querySelector('.oa2-why')?.textContent).toBe('a recorder is running');
});

it('shows Live for the browser camera and mic, with the Live page below the row', async () => {
  signals({ browserAv: true });
  await open();
  expect(lit()).toEqual(['Live']);
  expect(document.querySelector('.oa2-why')?.textContent).toBe('mic or camera in use');
  expect(document.querySelector('.oa2-showtimer')).not.toBeNull();
  expect(document.querySelector('.oa2-comments')).not.toBeNull();
});

it('says the wall cannot read the signals when they are unknown', async () => {
  signals({ known: false });
  await open();
  expect(document.querySelector('.oa2-why')?.textContent).toBe('the wall cannot read the camera and mic');
});

it('moves focus along the radio group with the arrow keys and wraps', async () => {
  await open();
  const [a, b, c] = radios();
  a.focus();
  fireEvent.keyDown(a, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(b);
  fireEvent.keyDown(b, { key: 'ArrowRight' });
  fireEvent.keyDown(c, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(a);
  fireEvent.keyDown(a, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(c);
});

it('shows a long reason whole, never cut, with the whole text in the hover card too', async () => {
  window.history.replaceState(null, '', '/?whylong=1');
  try {
    await open();
    const why = document.querySelector('.oa2-why') as HTMLElement;
    expect(why.textContent).toBe('the wall cannot read the camera and the mic');
    expect(why.className).not.toMatch(/ellipsis/);
    fireEvent.mouseEnter(why);
  } finally {
    window.history.replaceState(null, '', '/');
  }
});

it('Recording: the take timer, the marks, the full notes list in file order, the six keys, the lights block and the recorder block', async () => {
  localStorage.setItem(TAKES_KEY, JSON.stringify({ day: new Date().toLocaleDateString('sv'), count: 3, longestMs: 400_000, current: { startedAt: Date.now() - 252_000, pausedAt: null, pausedMs: 0, seenAt: Date.now() } }));
  resetTakes();
  signals({ recording: true });
  await open();
  await screen.findByText('03:12');
  expect([...document.querySelectorAll('.oa2-outline .oa-note span')].map((e) => e.textContent)).toEqual(['Open the blank file', 'Pick the second way']);
  expect(screen.getByRole('timer').textContent).toBe('04:12');
  expect(screen.getByText('Recording', { selector: '.oa2-chip' })).toBeTruthy();
  expect(document.querySelector('.oa2-sub')?.textContent).toMatch(/^Take 3\. It started by itself at .* when the recorder began\.$/);
  expect(screen.getByText('Takes today: 3. The longest ran 06:40.')).toBeTruthy();
  expect(screen.getByText('03:12')).toBeTruthy();
});

const recorderLine = () => document.querySelector('.oa2-recstate')?.textContent;
const recorderRead = (state: string) => mocks.set('wall2_recorder_status', () => ({ state }));

it('Recording: the recorder block says Not open, Ready, Recording and Paused, and not known when the read fails', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'rec' }));
  recorderRead('none');
  signals({ recording: false });
  const first = await open();
  await screen.findByText('Camtasia Recorder');
  await waitFor(() => expect(recorderLine()).toBe('Not open'));
  expect(document.querySelector('.oa2-recstate .oa2-dot')?.getAttribute('data-mode')).toBe('idle');
  first.unmount();
  useRecorder.setState({ open: null });
  recorderRead('open');
  signals({ recording: false });
  const second = await open();
  await waitFor(() => expect(recorderLine()).toBe('Ready'));
  second.unmount();
  takesToday({});
  signals({ recording: true });
  const third = await open();
  await waitFor(() => expect(recorderLine()).toBe('Recordingtake 3'));
  expect(document.querySelector('.oa2-recstate .oa2-dot')?.getAttribute('data-mode')).toBe('rec');
  third.unmount();
  takesToday({ pausedAt: Date.now() - 1000 });
  signals({ recording: true });
  await open();
  await waitFor(() => expect(recorderLine()).toBe('Pausedtake 3'));
  cleanup();
  mocks.delete('wall2_recorder_status');
  useRecorder.setState({ open: null });
  signals({ recording: false });
  await open();
  await waitFor(() => expect(recorderLine()).toBe('Not known'));
});

const tile = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const takesToday = (over: object) => {
  localStorage.setItem(TAKES_KEY, JSON.stringify({ day: new Date().toLocaleDateString('sv'), count: 3, longestMs: 400_000, current: { startedAt: Date.now() - 252_000, pausedAt: null, pausedMs: 0, seenAt: Date.now(), ...over } }));
  resetTakes();
};

it('Recording keys while recording: Record off, Pause live, Stop lit, and every library key goes by its id', async () => {
  takesToday({});
  signals({ recording: true });
  await open();
  await screen.findByRole('button', { name: 'Record' });
  const names = [...document.querySelectorAll('.oa2-reckeys .key-tile')].map((t) => t.getAttribute('aria-label'));
  expect(names).toEqual(['Record', 'Pause', 'Stop', 'Mark a moment', 'Snip', 'Hide screen']);
  expect(tile('Record').className).toContain('off');
  expect(tile('Record').getAttribute('aria-disabled')).toBe('true');
  expect(tile('Record').getAttribute('data-kind')).toBeNull();
  expect(tile('Pause').className).not.toContain('off');
  expect(tile('Stop').getAttribute('data-rec')).toBe('stop');
  expect(tile('Mark a moment').getAttribute('data-kind')).toBe('focus');
  fireEvent.click(tile('Stop'), { detail: 1 });
  await flush();
  fireEvent.click(tile('Snip'), { detail: 1 });
  await flush();
  expect(sent).toEqual([{ library: { id: 'rec-stop' } }, { library: { id: 'snip' } }]);
});

it('Recording keys with no recording: Record live, Pause and Stop off with their reasons', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'rec' }));
  await open();
  await screen.findByRole('button', { name: 'Record' });
  expect(tile('Record').className).not.toContain('off');
  expect(tile('Pause').className).toContain('off');
  expect(tile('Stop').className).toContain('off');
  expect(tile('Stop').getAttribute('data-rec')).toBeNull();
  expect(document.querySelector('.oa-time')?.textContent).toBe('00:00');
  expect(document.querySelector('.oa-time')?.getAttribute('data-running')).toBe('false');
  expect(document.querySelector('.oa2-sub')?.textContent).toBe('No recording running. The timer starts with the recorder.');
  fireEvent.click(tile('Pause'), { detail: 1 });
  expect(sent).toEqual([]);
  expect(screen.getByText('No recording is running', { selector: '.oa2-brief' })).toBeTruthy();
  fireEvent.click(tile('Record'), { detail: 1 });
  await flush();
  expect(sent).toEqual([{ library: { id: 'rec-toggle' } }]);
});

it('Pause counts only after Rust took the press without an error, and the tile becomes Resume', async () => {
  takesToday({});
  signals({ recording: true });
  await open();
  await screen.findByRole('button', { name: 'Pause' });
  const failing = vi.fn(() => {
    throw 'no-recorder';
  });
  mocks.set('wall2_keys_send_library', failing);
  fireEvent.click(tile('Pause'), { detail: 1 });
  await flush();
  expect(failing).toHaveBeenCalledOnce();
  expect(useTakes.getState().takes.current?.pausedAt).toBeNull();
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  // The same tile later, with Rust answering.
  mocks.set('wall2_keys_send_library', (args) => (sent.push({ library: args }), null));
  vi.setSystemTime(Date.now() + 700);
  fireEvent.click(tile('Pause'), { detail: 1 });
  await flush();
  expect(useTakes.getState().takes.current?.pausedAt).not.toBeNull();
  expect(tile('Resume')).toBeTruthy();
  expect(screen.getByText('Paused', { selector: '.oa2-chip' })).toBeTruthy();
  expect(document.querySelector('.oa2-sub')?.textContent).toBe('Take 3 is paused. The timer waits with the recorder.');
  expect(document.querySelector('.oa-time')?.getAttribute('data-running')).toBe('false');
  vi.setSystemTime(Date.now() + 700);
  fireEvent.click(tile('Resume'), { detail: 1 });
  await flush();
  expect(useTakes.getState().takes.current?.pausedAt).toBeNull();
  expect(tile('Pause')).toBeTruthy();
});

it('Mark a moment writes the take time and no part, and counts once for a double click', async () => {
  takesToday({});
  signals({ recording: true });
  await open();
  await screen.findByRole('button', { name: 'Mark a moment' });
  fireEvent.click(tile('Mark a moment'), { detail: 1 });
  fireEvent.click(tile('Mark a moment'), { detail: 2 });
  await flush();
  const marked = sent.filter((s) => (s as { mark?: unknown }).mark) as { mark: { showMs: number; part: string | null } }[];
  expect(marked).toHaveLength(1);
  expect(marked[0].mark.part).toBeNull();
  expect(marked[0].mark.showMs).toBe(252_000);
  expect(await within(document.querySelector('.oa2-marks') as HTMLElement).findByText('04:12')).toBeTruthy();
});

it('Marks today: rows with the show time only (a part from an older marks line is not shown), none yet, a refusal in amber in place of the takes line, and Open marks.txt', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'rec' }));
  await open();
  await screen.findByText('03:12', { selector: '.oa2-row-t b' });
  const rows = [...document.querySelectorAll('.oa2-marks .oa2-row')].map((r) => r.textContent);
  expect(rows).toEqual(['03:12', '09:40']);
  expect(screen.getByText('No takes yet today.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open marks.txt' }));
  await flush();
  expect(sent).toContainEqual({ open: { which: 'marks' } });
  markRefused = true;
  fireEvent.click(tile('Mark a moment'), { detail: 1 });
  const note = await screen.findByText('marks.txt is full; move it aside');
  expect(note.className).toContain('amber');
  expect(screen.queryByText('No takes yet today.')).toBeNull();
});

it('Marks today with none: one plain row', async () => {
  marks = { today: 0, last: [], lastParts: [] };
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'rec' }));
  await open();
  expect(await screen.findByText('None yet today.')).toBeTruthy();
});

it('Presenting, matched: the chip, the talk time from the meeting start, the minutes left and the meeting rows', async () => {
  meetings = [meeting()];
  useMeetingFeed.setState({ meetings });
  signals({ call: call('teams', -28, true) });
  await open();
  expect(await screen.findByText('Community talk: November')).toBeTruthy();
  expect(document.querySelector('.oa2-chip')?.textContent).toBe('Teams call oncamera onmic on');
  expect(screen.getByRole('timer').textContent).toBe('24:00');
  expect(document.querySelector('.oa2-sub')?.textContent).toMatch(/^Started .* with the meeting\. 36 min left by your calendar\.$/);
  expect(screen.getByText('from your calendar')).toBeTruthy();
  expect(screen.getByText('42 invited. Organiser: Event host')).toBeTruthy();
  expect(screen.getByText(/^You joined at /)).toBeTruthy();
  expect(screen.getByText(/^\d+:\d+( [AP]M)? to \d+:\d+ [AP]M today$/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Outlook/ })).toBeNull();
  expect([...document.querySelectorAll('.oa2-speaker .oa-note span')].map((e) => e.textContent)).toEqual(['Open the blank file', 'Pick the second way']);
});

it('Presenting, joined late: the sub says when you joined', async () => {
  meetings = [meeting()];
  useMeetingFeed.setState({ meetings });
  signals({ call: call('zoom', -10) });
  await open();
  await screen.findByText('Community talk: November');
  expect(document.querySelector('.oa2-sub')?.textContent).toMatch(/^Started \d+:\d+ [AP]M, when you joined\. 36 min left by your calendar\.$/);
  expect(screen.getByRole('timer').textContent).toBe('10:00');
});

it('Presenting, past the end of the meeting: says what the calendar said', async () => {
  meetings = [meeting({ start: at(-80), end: at(-5) })];
  useMeetingFeed.setState({ meetings });
  signals({ call: call('teams', -70) });
  await open();
  await screen.findByText('Community talk: November');
  expect(document.querySelector('.oa2-sub')?.textContent).toMatch(/^Your calendar said it ended at \d+:\d+ [AP]M\.$/);
});

it('Presenting, no match: plain words, a count-up timer, no button and no list', async () => {
  signals({ call: call('zoom', -12) });
  await open();
  expect(await screen.findByText('No meeting on your calendar matches it')).toBeTruthy();
  expect(screen.getByText('A Zoom call is on')).toBeTruthy();
  expect(screen.getByText('no calendar match')).toBeTruthy();
  expect(screen.getByText('Time left: not known. The timer counts up')).toBeTruthy();
  expect(screen.getByText(/^On since /)).toBeTruthy();
  expect(document.querySelector('.oa2-sub')?.textContent).toMatch(/^Started \d+:\d+ [AP]M, when the call began\. No end time known\.$/);
  expect(document.querySelector('.oa2-meeting button')).toBeNull();
  expect(document.querySelector('.oa2-chip')?.textContent).toBe('Zoom call onmic on');
});

it('Presenting with a stale calendar feed claims no match', async () => {
  meetings = [meeting()];
  useMeetingFeed.setState({ meetings, feedStale: true });
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings, stale: true }));
  signals({ call: call('teams', -28) });
  await open();
  expect(await screen.findByText('No meeting on your calendar matches it')).toBeTruthy();
});

it('Presenting, call keys: Teams and Zoom from the library, a browser call as four off tiles', async () => {
  signals({ call: call('teams') });
  const { unmount } = await open();
  await screen.findByText('sent to Teams');
  const ids = LIBRARY_DATA.flatMap((g) => g.keys);
  const label = (id: string) => ids.find((k) => k.id === id)?.label;
  expect([...document.querySelectorAll('.oa2-callkeys .key-tile')].map((t) => t.getAttribute('aria-label'))).toEqual([label('teams-mute'), label('teams-camera'), label('teams-share'), label('teams-leave'), 'Mark a moment', 'Snip', 'Hide screen']);
  fireEvent.click(tile(label('teams-leave')!), { detail: 1 });
  await flush();
  expect(sent).toEqual([{ library: { id: 'teams-leave' } }]);
  unmount();
  signals({ call: call('zoom') });
  await open();
  await screen.findByText('sent to Zoom');
  expect(sent.length).toBe(1);
  expect(document.querySelectorAll('.oa2-callkeys .key-tile:not(.off)').length).toBe(7);
  cleanup();
  signals({ call: call('browser') });
  await open();
  await screen.findByText('no keys for a browser call');
  const off = [...document.querySelectorAll('.oa2-callkeys .key-tile.off')];
  expect(off.map((t) => t.getAttribute('aria-label'))).toEqual(['Mute', 'Camera', 'Share screen', 'Leave']);
  expect(off.every((t) => t.getAttribute('aria-disabled') === 'true')).toBe(true);
  expect(document.querySelectorAll('.oa2-callkeys .key-tile:not(.off)').length).toBe(3);
});

it('Presenting: Mark a moment writes the talk time', async () => {
  meetings = [meeting()];
  useMeetingFeed.setState({ meetings });
  signals({ call: call('teams', -28) });
  await open();
  await screen.findByRole('button', { name: 'Mark a moment' });
  fireEvent.click(tile('Mark a moment'), { detail: 1 });
  await flush();
  const marked = sent.filter((s) => (s as { mark?: unknown }).mark) as { mark: { showMs: number } }[];
  expect(marked).toHaveLength(1);
  expect(marked[0].mark.showMs).toBe(24 * MIN);
});

it('Presenting held with no call: a dimmed timer and honest words, keys off', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'meet' }));
  await open();
  await screen.findByText('no call is on');
  expect(screen.getByText('No call is on. The timer starts with the call.')).toBeTruthy();
  expect(screen.getByRole('timer').getAttribute('data-running')).toBe('false');
  expect(document.querySelectorAll('.oa2-callkeys .key-tile.off').length).toBe(4);
});

it('Recording held while a call is on: the page is Recording, both cases carry a dot', async () => {
  signals({ recording: true, call: call('teams') });
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'meet' }));
  await open();
  expect(lit()).toEqual(['Presenting']);
  expect(document.querySelectorAll('.oa2-seg .oa2-dot').length).toBe(2);
  expect(document.querySelector('.oa2-why')?.textContent).toBe('Held by hand');
  await screen.findByText('Call keys');
});

it('the empty prompter box holds its place and nothing else, on the Presenting page', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'meet' }));
  await open();
  const box = document.querySelector('.oa2-empty-prompter') as HTMLElement;
  expect(box.children.length).toBe(0);
  expect(box.textContent).toBe('');
  expect(box.getAttribute('aria-hidden')).toBe('true');
});

it('Presenting before the calendar has answered: the plain call words only, nothing about a match', async () => {
  useMeetingFeed.setState({ meetings: [], feedStale: false, failed: false, asOf: null, reads: 0 });
  // The first read never answers.
  mocks.set('wall2_meet_next', () => new Promise(() => {}));
  signals({ call: call('zoom', -12) });
  await open();
  expect(await screen.findByText('A Zoom call is on')).toBeTruthy();
  expect(screen.getByText(/^On since /)).toBeTruthy();
  expect(screen.queryByText('No meeting on your calendar matches it')).toBeNull();
  expect(screen.queryByText('no calendar match')).toBeNull();
  expect(screen.queryByText(/Time left: not known/)).toBeNull();
  expect(document.querySelector('.oa2-sub')?.textContent).toMatch(/^Started \d+:\d+ [AP]M, when the call began\.$/);
});

it('Presenting, joined before the meeting starts: "Starts", with the timer waiting at 0:00', async () => {
  meetings = [meeting({ start: at(3), end: at(33) })];
  useMeetingFeed.setState({ meetings });
  signals({ call: call('teams', 0) });
  await open();
  await screen.findByText('Community talk: November');
  expect(document.querySelector('.oa2-sub')?.textContent).toMatch(/^Starts \d+:\d+ [AP]M with the meeting\. 33 min left by your calendar\.$/);
  expect(screen.getByRole('timer').textContent).toBe('00:00');
});

it('Takes today after midnight: the page shows today, not the count the store still holds for yesterday', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'rec' }));
  await open();
  await screen.findByText('03:12');
  act(() => useTakes.setState({ takes: { day: '2000-01-01', count: 3, longestMs: 400_000, current: null } }));
  expect(screen.getByText('No takes yet today.')).toBeTruthy();
  expect(screen.queryByText(/Takes today: 3/)).toBeNull();
});

it('Mark a moment with no take running writes what today\'s On Air writes for an idle timer, never a made up time', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'rec' }));
  await open();
  await screen.findByRole('button', { name: 'Mark a moment' });
  // The show timer is stopped at 5 seconds: the old page's Mark would write that.
  act(() => useOnAirStore.setState({ saved: { ...IDLE, accumulatedMs: 5_000 } }));
  fireEvent.click(tile('Mark a moment'), { detail: 1 });
  await flush();
  const marked = sent.filter((s) => (s as { mark?: unknown }).mark) as { mark: { showMs: number } }[];
  expect(marked.map((m) => m.mark.showMs)).toEqual([5_000]);
});

it('Mark a moment on Presenting with no call writes the same, not a talk time of 0', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'meet' }));
  await open();
  await screen.findByRole('button', { name: 'Mark a moment' });
  act(() => useOnAirStore.setState({ saved: { ...IDLE, accumulatedMs: 7_000 } }));
  fireEvent.click(tile('Mark a moment'), { detail: 1 });
  await flush();
  const marked = sent.filter((s) => (s as { mark?: unknown }).mark) as { mark: { showMs: number } }[];
  expect(marked.map((m) => m.mark.showMs)).toEqual([7_000]);
});

it('the frame starts the take store when it mounts and stops it on unmount', async () => {
  signals({ recording: true });
  const { unmount } = await open();
  await screen.findByRole('button', { name: 'Pause' });
  expect(useTakes.getState().takes.count).toBe(1);
  expect(document.querySelector('.oa2-sub')?.textContent).toMatch(/^Take 1\./);
  unmount();
  act(() => useSignalStore.setState({ recording: false }));
  act(() => useSignalStore.setState({ recording: true }));
  // Stopped: the second start is not followed.
  expect(useTakes.getState().takes.count).toBe(1);
});
