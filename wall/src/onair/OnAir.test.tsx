// @ts-ignore node's own file calls; one test reads the Rust command registration as text.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { mocks } from '../bridge/tauri';
import { useSignalStore } from '../signals/store';
import { resetTip } from '../ui/HoverTip';
import { resetLibIndex } from '../work/keyLibrary';
import { IDLE, type Show } from './model';
import { MODE_STORAGE_KEY } from './modes';
import { OnAir } from './OnAir';
import { useOnAirStore } from './store';

vi.setConfig({ testTimeout: 20_000 });

const lib: string = readFileSync('../src-tauri/src/lib.rs', 'utf8');

let clock = Date.parse('2026-11-13T10:00:00-08:00');
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  // Each test starts a minute later, past the five second floor between reads of the run of show.
  clock += 60_000;
  vi.setSystemTime(clock);
  localStorage.clear();
  useOnAirStore.setState({ saved: IDLE, show: null, showError: null, marks: null, marksDate: null, marksNote: null, showNote: null, marking: false });
  useOnAirStore.getState().cancelPending();
  resetLibIndex();
  mocks.set('wall2_onair_show', () => ({ state: 'missing', title: null, parts: [], skipped: 0, reason: null, readAt: 1 }));
  mocks.set('wall2_onair_marks_today', () => ({ today: 0, last: [] }));
  mocks.set('wall2_onair_mark', () => ({ today: 1, last: ['00:05'] }));
  mocks.set('wall2_onair_open', () => undefined);
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_keys_send_library', () => null);
});
afterEach(() => {
  // Time only moves forward from one test to the next (the store's five second floor reads the clock).
  clock = Math.max(clock, Date.now());
  cleanup();
  resetTip();
  vi.useRealTimers();
  mocks.clear();
  window.history.replaceState(null, '', '/');
  useSignalStore.setState({ known: false, recording: false });
});

it('is the new frame whatever the address says: no ?onair knob', async () => {
  for (const search of ['', '?onair=v1', '?onair=v2', '?onair=today']) {
    window.history.replaceState(null, '', `/${search}`);
    const { container, unmount } = render(<OnAir />);
    await flush();
    expect(container.querySelector('section.oa2')).not.toBeNull();
    expect(container.querySelector('section.onair')).toBeNull();
    expect(container.querySelector('.oa-right')).toBeNull();
    unmount();
  }
});

it('asks Rust only through the four On Air commands, and each of them is registered', async () => {
  const seen = new Set<string>();
  for (const c of ['wall2_onair_show', 'wall2_onair_mark', 'wall2_onair_marks_today', 'wall2_onair_open']) {
    const handler = mocks.get(c);
    mocks.set(c, (args) => (seen.add(c), handler?.(args)));
  }
  useSignalStore.setState({ known: true, recording: true });
  render(<OnAir />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /Mark a moment/ }), { detail: 1 });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Open marks.txt' }));
  await flush();
  expect([...seen].sort()).toEqual(['wall2_onair_mark', 'wall2_onair_marks_today', 'wall2_onair_open', 'wall2_onair_show']);
  for (const c of seen) expect(lib).toContain(`wall2_onair::${c}`);
});

// Behaviours the old page had tests for and the new frame keeps: shown on the Live page, which has the timer and the notes.
const SHOW: Show = { state: 'ok', title: 'Friday stream', parts: [{ name: 'Welcome', minutes: 5, notes: [] }], skipped: 0, reason: null, readAt: 1 };
const many = (n: number): Show => ({ ...SHOW, parts: Array.from({ length: n }, (_, i) => ({ name: `Part ${i + 1}`, minutes: 5, notes: [`Note ${i + 1}`] })) });
const setHidden = (on: boolean) => {
  Object.defineProperty(document, 'hidden', { value: on, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const openLive = (show: Show = SHOW) => {
  localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: 'live' }));
  mocks.set('wall2_onair_show', () => show);
  mocks.set('wall2_ytlive_channel', () => ({ set: false, title: null }));
  mocks.set('wall2_ytlive_status', () => ({ state: 'none', startedAt: null, scheduledAt: null, viewers: null, chat: false, readAt: Date.now(), stale: false, word: null, statusLeft: 1000, chatLeft: 1000 }));
  mocks.set('wall2_ytlive_chat', () => ({ state: 'ok', messages: [], readAt: Date.now(), stale: false, stoppedAt: null, word: null }));
  mocks.set('wall2_signals_report', () => null);
  return render(<OnAir />);
};
afterEach(() => setHidden(false));

it('does no work while the page is hidden and catches up on return', async () => {
  openLive();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  await flush(3100);
  const before = screen.getByRole('timer').textContent;
  expect(before).toMatch(/^00:0[23]$/);
  const seen = () => screen.getByRole('timer').textContent;
  act(() => setHidden(true));
  vi.setSystemTime(Date.now() + 60_000);
  await flush(10_000);
  expect(seen()).toBe(before);
  act(() => setHidden(false));
  expect(seen()).toMatch(/^01:1[2-4]$/);
});

it('reads the marks on coming back only when the date moved on while hidden', async () => {
  vi.setSystemTime(new Date(2026, 10, 13, 22, 0, 0));
  let reads = 0;
  mocks.set('wall2_onair_marks_today', () => (reads++, { today: reads, last: [] }));
  openLive();
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

it('leaves no timer of its own behind when the place closes with Reset half confirmed', async () => {
  const { unmount } = openLive();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByRole('button', { name: /Reset\? Click again/ })).toBeTruthy();
  const withPlace = vi.getTimerCount();
  unmount();
  resetTip();
  await flush();
  expect(vi.getTimerCount()).toBeLessThan(withPlace);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not read the file after the place closed', async () => {
  let reads = 0;
  const { unmount } = openLive();
  mocks.set('wall2_onair_show', () => (reads++, { ...SHOW, state: 'missing', parts: [] }));
  unmount();
  await flush(10_000);
  expect(reads).toBe(0);
});

it('shows a long run of show as one list of notes with no Part line, and a stored part index from an older version is ignored', async () => {
  localStorage.setItem('wall2-onair', JSON.stringify({ running: false, startedAt: null, accumulatedMs: 0, firstStartAt: null, stoppedAt: null, partIndex: 29, partSinceMs: 5 }));
  const show = many(30);
  openLive(show);
  await flush();
  expect(screen.queryByText(/^Part \d+ of \d+/)).toBeNull();
  expect(screen.queryByRole('button', { name: /(Previous|Next) part/ })).toBeNull();
  expect(document.querySelectorAll('.oa2-livenotes .oa-note')).toHaveLength(30);
  expect(useOnAirStore.getState().saved).not.toHaveProperty('partIndex');
});
