// @ts-ignore node's own file calls; this test reads the Rust module and the library as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { mocks } from '../bridge/tauri';
import { useSignalStore } from '../signals/store';
import { resetTip } from '../ui/HoverTip';
import { IDLE, type Show } from './model';
import { OnAir } from './OnAir';
import { ONAIR_KEYS } from './RightColumn';
import { useOnAirStore } from './store';

vi.setConfig({ testTimeout: 20_000 });

const rust: string = readFileSync('../src-tauri/src/wall2_onair.rs', 'utf8');
const lib: string = readFileSync('../src-tauri/src/lib.rs', 'utf8');
const keylib: string = readFileSync('../src-tauri/src/wall2_keylib.rs', 'utf8');

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
  useOnAirStore.setState({ saved: IDLE, show: null, showError: null, marks: null, note: null, marking: false });
  mocks.set('wall2_onair_show', () => {
    if (show === 'fail') throw 'failed';
    return show;
  });
  mocks.set('wall2_onair_marks_today', () => ({ today: 0, last: [] }));
  mocks.set('wall2_onair_mark', (args) => (sent.push({ mark: args }), { today: 1, last: ['00:05'] }));
  mocks.set('wall2_onair_open', (args) => void opened.push(args));
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_keys_send_library', (args) => (sent.push({ library: args }), args?.id === 'record-169' ? 'layout:record169' : null));
  mocks.set('wall2_arrange', () => ({ moved: 1, asked: 1 }));
});
afterEach(() => {
  resetTip();
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

it('marks a moment once for a double click and shows today\'s count', async () => {
  render(<OnAir />);
  await flush();
  const mark = screen.getByRole('button', { name: /Mark a moment/ });
  fireEvent.click(mark, { detail: 1 });
  fireEvent.click(mark, { detail: 2 });
  await flush();
  expect(sent).toEqual([{ mark: { showMs: 0, part: 'Welcome' } }]);
  expect(screen.getByText('1 marked: 00:05. Saved to marks.txt')).toBeTruthy();
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

it('uses library keys that exist, with the actions Rust gives them', () => {
  for (const k of ONAIR_KEYS) {
    const row = new RegExp(`id: "${k.id}", label: "([^"]+)"[^\\n]*spec: "([^"]+)"`).exec(keylib);
    expect(row, k.id).not.toBeNull();
    if (k.action) expect(row?.[2]).toBe(k.action);
  }
  expect(ONAIR_KEYS.map((k) => k.label)).toEqual(['Record 16:9', 'Stop', 'Snip', 'Hide screen']);
});

it('calls only the four commands the Rust module registers', () => {
  for (const c of ['wall2_onair_show', 'wall2_onair_mark', 'wall2_onair_marks_today', 'wall2_onair_open']) {
    expect(rust).toContain(`pub async fn ${c}(`);
    expect(lib).toContain(`wall2_onair::${c}`);
  }
});
