// @ts-ignore node's own file calls; one test reads the Rust command registration as text.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { mocks } from '../bridge/tauri';
import { useSignalStore } from '../signals/store';
import { resetTip } from '../ui/HoverTip';
import { resetLibIndex } from '../work/keyLibrary';
import { IDLE } from './model';
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
