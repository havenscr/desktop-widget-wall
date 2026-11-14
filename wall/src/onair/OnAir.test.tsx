// @ts-ignore node's own file calls; one test reads the Rust command registration as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { RECORDING_KEYS } from '../signals/recordingKeys';
import { resetLibIndex } from '../work/keyLibrary';
import type { LibGroup } from '../work/libraryModel';
import { mocks } from '../bridge/tauri';
import { useSignalStore } from '../signals/store';
import { resetTip } from '../ui/HoverTip';
import { IDLE, type Show } from './model';
import { OnAir } from './OnAir';
import { ONAIR_KEY_IDS } from './RightColumn';
import { useOnAirStore } from './store';

vi.setConfig({ testTimeout: 20_000 });

const lib: string = readFileSync('../src-tauri/src/lib.rs', 'utf8');

const SHOW: Show = {
  state: 'ok',
  title: 'Friday stream',
  parts: [
    { name: 'Welcome', minutes: 5, notes: ['Say hello'] },
    { name: 'Product demo', minutes: 20, notes: ['Point it at the real model first', 'Show the filters'] },
    { name: 'Questions', minutes: 15, notes: [] },
  ],
  skipped: 0,
  reason: null,
  readAt: 1,
};
let show: Show | 'fail';
let sent: unknown[];
let opened: unknown[];
let clock = Date.parse('2026-11-13T10:00:00-08:00');
let libraryData: LibGroup[];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  // Each test starts a minute later, past the five second floor between reads.
  clock += 60_000;
  vi.setSystemTime(clock);
  localStorage.clear();
  show = SHOW;
  sent = [];
  opened = [];
  useOnAirStore.setState({ saved: IDLE, show: null, showError: null, marks: null, marksDate: null, marksNote: null, showNote: null, marking: false });
  useOnAirStore.getState().cancelPending();
  resetLibIndex();
  mocks.set('wall2_onair_show', () => {
    if (show === 'fail') throw 'failed';
    return show;
  });
  mocks.set('wall2_onair_marks_today', () => ({ today: 0, last: [] }));
  mocks.set('wall2_onair_mark', (args) => (sent.push({ mark: args }), { today: 1, last: ['00:05'] }));
  mocks.set('wall2_onair_open', (args) => void opened.push(args));
  libraryData = LIBRARY_DATA;
  mocks.set('wall2_keys_library', () => libraryData);
  mocks.set('wall2_keys_send_library', (args) => (sent.push({ library: args }), args?.id === 'record-169' ? 'layout:record169' : null));
  mocks.set('wall2_arrange', () => ({ moved: 1, asked: 1 }));
});
afterEach(() => {
  resetTip();
  // Time only moves forward from one test to the next (the store's five second floor reads the clock).
  clock = Math.max(clock, Date.now());
  vi.useRealTimers();
  mocks.clear();
  useSignalStore.setState({ known: false, recording: false });
});

it('shows the run of show, the current part\'s notes and what comes next', async () => {
  render(<OnAir />);
  await flush();
  expect(screen.getByText('Run of show · Friday stream')).toBeTruthy();
  expect(screen.getByText('Notes for this part · Welcome')).toBeTruthy();
  expect(screen.getByText('Say hello')).toBeTruthy();
  expect(screen.getByText('Next: Product demo, 20 min')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Next part/ }));
  expect(screen.getByText('Notes for this part · Product demo')).toBeTruthy();
  expect(screen.getByText('Show the filters')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Questions/ }));
  expect(screen.getByText('No notes for this part')).toBeTruthy();
  expect(screen.getByText('This is the last part')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Previous part/ }));
  expect(useOnAirStore.getState().saved.partIndex).toBe(1);
});

it('starts and stops the timer, and Reset needs a second click within three seconds', async () => {
  render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  await flush(65_100);
  expect(screen.getByRole('timer').textContent).toBe('01:05');
  fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }));
  const reset = screen.getByRole('button', { name: 'Reset' });
  fireEvent.click(reset);
  expect(reset.textContent).toBe('Reset? Click again');
  await flush(3100);
  expect(reset.textContent).toBe('Reset');
  expect(screen.getByRole('timer').textContent).toBe('01:05');
  fireEvent.click(reset);
  fireEvent.click(reset);
  expect(screen.getByRole('timer').textContent).toBe('00:00');
});

it('says when there is no file and Open file asks Rust for the starter by name', async () => {
  show = { ...SHOW, state: 'missing', parts: [], title: null };
  render(<OnAir />);
  await flush();
  expect(screen.getByText('No run-of-show.txt yet')).toBeTruthy();
  expect(screen.getByText(/starts a part planned for 10 minutes/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Open file' })[0]);
  await flush();
  expect(opened).toEqual([{ which: 'show' }]);
});

it('shows a refused file\'s reason and a failed read in one line', async () => {
  show = { ...SHOW, state: 'refused', parts: [], reason: 'run-of-show.txt is over 32 KB' };
  const { unmount } = render(<OnAir />);
  await flush();
  expect(screen.getByText('run-of-show.txt is over 32 KB')).toBeTruthy();
  unmount();
  show = 'fail';
  useOnAirStore.setState({ show: null });
  vi.setSystemTime(Date.now() + 6000);
  render(<OnAir />);
  await flush();
  expect(screen.getAllByText('Could not read run-of-show.txt').length).toBeGreaterThan(0);
});

it('marks a moment and shows today\'s count', async () => {
  render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /Mark a moment/ }), { detail: 1 });
  await flush();
  expect(sent).toEqual([{ mark: { showMs: 0, part: 'Welcome' } }]);
  expect(screen.getByText('1 marked: 00:05. Saved to marks.txt')).toBeTruthy();
});

// Two guards stand between a double click and a second line: the page ignores the second click of a
// pair (its click count is above one), and the store ignores any mark within a second of the last.
it('counts two clicks 200 ms apart once, by the store\'s one second floor alone', async () => {
  render(<OnAir />);
  await flush();
  const mark = screen.getByRole('button', { name: /Mark a moment/ });
  fireEvent.click(mark, { detail: 1 });
  await flush(200);
  fireEvent.click(mark, { detail: 1 });
  await flush();
  expect(sent).toHaveLength(1);
});

it('counts two clicks 1.2 s apart twice, and never counts the second click of a double click, however late it lands', async () => {
  render(<OnAir />);
  await flush();
  const mark = screen.getByRole('button', { name: /Mark a moment/ });
  fireEvent.click(mark, { detail: 1 });
  await flush(1200);
  fireEvent.click(mark, { detail: 1 });
  await flush(1200);
  expect(sent).toHaveLength(2);
  // The page's own guard: a click that is the second of a pair is dropped even past the floor.
  fireEvent.click(mark, { detail: 2 });
  await flush();
  expect(sent).toHaveLength(2);
});

it('sends the recording keys through the deck\'s library path, and Stop agrees with recording mode', async () => {
  useSignalStore.setState({ known: true, recording: false });
  render(<OnAir />);
  await flush();
  const stop = screen.getByRole('button', { name: 'Stop' });
  expect(stop.className).toContain('off');
  act(() => useSignalStore.setState({ known: true, recording: true }));
  expect(stop.className).not.toContain('off');
  expect(stop.getAttribute('data-rec')).toBe('stop');
  fireEvent.click(screen.getByRole('button', { name: 'Record 16:9' }), { detail: 1 });
  await flush(600);
  fireEvent.click(screen.getByRole('button', { name: 'Snip' }), { detail: 1 });
  await flush(600);
  expect(sent).toEqual([{ library: { id: 'record-169' } }, { library: { id: 'snip' } }]);
});

it('draws its four keys from the key library by id, and follows a change to a library definition', async () => {
  const { unmount } = render(<OnAir />);
  await flush();
  expect(ONAIR_KEY_IDS).toEqual(['record-169', 'rec-stop', 'snip', 'strip-dark']);
  const def = (id: string) => LIBRARY_DATA.flatMap((g) => g.keys).find((k) => k.id === id);
  const tiles = [...document.querySelectorAll('.oa-keys .key-tile')];
  expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(ONAIR_KEY_IDS.map((id) => def(id)?.label));
  unmount();
  // The library changes: Hide screen gets another label and a focus action, and Record 16:9 another label and action.
  resetLibIndex();
  libraryData = LIBRARY_DATA.map((g) => ({
    ...g,
    keys: g.keys.map((k) => (k.id === 'strip-dark' ? { ...k, label: 'Blank the wall', action: 'focus:start' } : k.id === 'record-169' ? { ...k, label: 'Record wide', action: 'layout:thirds' } : k)),
  }));
  render(<OnAir />);
  await flush();
  expect(screen.queryByRole('button', { name: 'Hide screen' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Blank the wall' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Record wide' })).toBeTruthy();
  // The colour follows the library action (a focus key now), not a copy of the old definition.
  expect(screen.getByRole('button', { name: 'Blank the wall' }).getAttribute('data-kind')).toBe('focus');
});

it('uses the recording mode\'s shared definitions for the recorder keys', async () => {
  render(<OnAir />);
  await flush();
  const stop = RECORDING_KEYS.find((r) => r.id === 'rec-stop');
  expect(stop?.to).toBe('the recorder');
  expect(screen.getByRole('button', { name: 'Stop' }).getAttribute('data-kind')).toBe('capture');
});

it('shows a disabled tile with its reason for a key the library does not have, and never guesses', async () => {
  libraryData = LIBRARY_DATA.map((g) => ({ ...g, keys: g.keys.filter((k) => k.id !== 'snip') }));
  render(<OnAir />);
  await flush();
  const gone = screen.getByRole('button', { name: 'snip' });
  expect(gone.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(gone, { detail: 1 });
  await flush(600);
  expect(sent).toEqual([]);
  expect(screen.getByText(/has no runnable key "snip"/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Record 16:9' })).toBeTruthy();
});

it('asks Rust only through the four On Air commands, and each of them is registered', async () => {
  const seen = new Set<string>();
  for (const c of ['wall2_onair_show', 'wall2_onair_mark', 'wall2_onair_marks_today', 'wall2_onair_open']) {
    const handler = mocks.get(c);
    mocks.set(c, (args) => (seen.add(c), handler?.(args)));
  }
  render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /Mark a moment/ }), { detail: 1 });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Open marks.txt' }));
  await flush();
  expect([...seen].sort()).toEqual(['wall2_onair_mark', 'wall2_onair_marks_today', 'wall2_onair_open', 'wall2_onair_show']);
  // The one thing a page test cannot reach: the command names are in the generate_handler! list.
  for (const c of seen) expect(lib).toContain(`wall2_onair::${c}`);
});

it('follows the file when it shrinks: the last part is current, a click on it changes nothing, and growing back does not jump', async () => {
  const many = (n: number): Show => ({ ...SHOW, parts: Array.from({ length: n }, (_, i) => ({ name: `Part ${i + 1}`, minutes: 5, notes: [`Note ${i + 1}`] })) });
  show = many(30);
  render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /^Part 30/ }));
  expect(screen.getByText('Notes for this part · Part 30')).toBeTruthy();
  show = many(3);
  await flush(6000);
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await flush();
  expect(screen.getByText('Notes for this part · Part 3')).toBeTruthy();
  expect(useOnAirStore.getState().saved.partIndex).toBe(2);
  const since = useOnAirStore.getState().saved.partSinceMs;
  fireEvent.click(screen.getByRole('button', { name: /^Part 3/ }));
  expect(useOnAirStore.getState().saved.partSinceMs).toBe(since);
  show = many(30);
  await flush(6000);
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await flush();
  expect(screen.getByText('Notes for this part · Part 3')).toBeTruthy();
});

it('stops itself at 24 hours and says so under the timer until Reset', async () => {
  render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  vi.setSystemTime(Date.now() + 24 * 3_600_000 + 5000);
  await flush(2000);
  expect(screen.getByRole('timer').textContent).toBe('24:00:00');
  expect(screen.getByText(/^Stopped at 24 hours\./)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Stop timer' })).toBeNull();
  const start = screen.getByRole('button', { name: 'Start timer' });
  expect(start.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(start);
  expect(screen.queryByRole('button', { name: 'Stop timer' })).toBeNull();
  const reset = screen.getByRole('button', { name: 'Reset' });
  fireEvent.click(reset);
  fireEvent.click(reset);
  expect(screen.getByRole('timer').textContent).toBe('00:00');
  expect(screen.queryByText(/^Stopped at 24 hours/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  expect(screen.getByRole('button', { name: 'Stop timer' })).toBeTruthy();
});

it('keeps a note for each file: a failed Open file never covers the marks line', async () => {
  mocks.set('wall2_onair_open', (args) => {
    if (args?.which === 'show') throw 'failed';
  });
  render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
  await flush();
  expect(screen.getByText('Could not open run-of-show.txt')).toBeTruthy();
  expect(screen.getByText('None yet today. Saved to marks.txt')).toBeTruthy();
});

const setHidden = (on: boolean) => {
  Object.defineProperty(document, 'hidden', { value: on, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

it('does no work while the page is hidden and catches up on return', async () => {
  render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  await flush(3100);
  const before = screen.getByRole('timer').textContent;
  expect(before).toMatch(/^00:0[23]$/);
  act(() => setHidden(true));
  expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(Date.now() + 60_000);
  await flush(10_000);
  expect(screen.getByRole('timer').textContent).toBe(before);
  act(() => setHidden(false));
  expect(screen.getByRole('timer').textContent).toMatch(/^01:1[2-4]$/);
});

it('reads today\'s marks again after local midnight, once, and leaves no timer behind', async () => {
  vi.setSystemTime(new Date(2026, 10, 13, 23, 59, 30));
  let reads = 0;
  mocks.set('wall2_onair_marks_today', () => (reads++, new Date().getDate() === 13 ? { today: 3, last: ['10:00'] } : { today: 0, last: [] }));
  const { unmount } = render(<OnAir />);
  await flush();
  expect(reads).toBe(1);
  expect(screen.getByText('3 marked: 10:00. Saved to marks.txt')).toBeTruthy();
  await flush(31_000);
  expect(reads).toBe(2);
  expect(screen.getByText('None yet today. Saved to marks.txt')).toBeTruthy();
  await flush(120_000);
  expect(reads).toBe(2);
  unmount();
  resetTip();
  expect(vi.getTimerCount()).toBe(0);
});

it('reads the marks on coming back only when the date moved on while hidden', async () => {
  vi.setSystemTime(new Date(2026, 10, 13, 22, 0, 0));
  let reads = 0;
  mocks.set('wall2_onair_marks_today', () => (reads++, { today: reads, last: [] }));
  render(<OnAir />);
  await flush();
  expect(reads).toBe(1);
  act(() => setHidden(true));
  vi.setSystemTime(new Date(2026, 10, 14, 0, 30, 0));
  await flush(5000);
  expect(reads).toBe(1);
  act(() => setHidden(false));
  await flush();
  expect(reads).toBe(2);
  act(() => setHidden(true));
  act(() => setHidden(false));
  await flush();
  expect(reads).toBe(2);
});

it('leaves no timer behind when the place closes with Reset half confirmed', async () => {
  const { unmount } = render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByRole('button', { name: /Reset\? Click again/ })).toBeTruthy();
  unmount();
  resetTip();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not read the starter after the place closed', async () => {
  show = { ...SHOW, state: 'missing', parts: [], title: null };
  let reads = 0;
  mocks.set('wall2_onair_show', () => (reads++, show));
  const { unmount } = render(<OnAir />);
  await flush();
  fireEvent.click(screen.getAllByRole('button', { name: 'Open file' })[0]);
  await flush();
  unmount();
  await flush(10_000);
  expect(reads).toBe(1);
});
