import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../../bridge/devMocks/libraryData';
import { mocks } from '../../bridge/tauri';
import type { Preset } from '../../studio/home';
import { useHome } from '../../studio/homeStore';
import { resetTip } from '../../ui/HoverTip';
import { resetLibIndex } from '../../work/keyLibrary';
import { IDLE } from '../model';
import { useRecorder } from './recorderStore';
import { useOnAirStore } from '../store';
import { findPreset, IdlePage } from './IdlePage';

const p = (id: string, label: string): Preset => ({ id, label, line: null, active: false, setsKeyLights: false });

beforeEach(() => {
  localStorage.clear();
  resetLibIndex();
  useOnAirStore.setState({ saved: IDLE, show: null, showError: null, showNote: null, marks: null, marksNote: null });
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_onair_marks_today', () => ({ today: 0, last: [] }));
  mocks.set('wall2_onair_show', () => ({ state: 'missing', title: null, parts: [], skipped: 0, reason: null, readAt: 1 }));
});
afterEach(() => {
  cleanup();
  resetTip();
  mocks.clear();
  vi.restoreAllMocks();
});

it('finds a preset by its shown name only: an internal id that matches a different name is no match', () => {
  expect(findPreset([p('onair', 'Evening')], 'live')).toBeUndefined();
  expect(findPreset([p('recording', 'Late night')], 'rec')).toBeUndefined();
});

it('finds a preset by its name, ignoring case and spacing, and none for a name the home app does not list', () => {
  const list = [p('onAir', 'On air'), p('x', 'Recording'), p('y', 'Evening')];
  expect(findPreset(list, 'live')?.id).toBe('onAir');
  expect(findPreset(list, 'rec')?.id).toBe('x');
  expect(findPreset(list, 'meet')).toBeUndefined();
  expect(findPreset(undefined, 'live')).toBeUndefined();
});

it('draws a Get ready button only on the cards whose preset the home app lists', async () => {
  const studio = { stale: false, presets: [p('onAir', 'On air'), p('r', 'Recording')], changed: false, groups: [], keys: null, looks: [], canNormal: false, normalLine: null, canWrite: true, writeBlock: null };
  vi.spyOn(useHome, 'getState');
  useHome.setState({ studio, readWord: null, readDone: true } as never);
  render(<IdlePage now={Date.parse('2026-11-12T10:00:00-08:00')} last={null} onHold={() => undefined} />);
  await act(async () => undefined);
  expect(screen.getAllByRole('button', { name: 'Get ready' }).length).toBe(2);
  expect(screen.getByText('Needs a home app preset named Presenting.')).toBeTruthy();
  expect(screen.getByText('Sets the lights to On air.')).toBeTruthy();
  expect(screen.getByText('Not started. It starts with a broadcast, a recording or a call.')).toBeTruthy();
  expect(screen.getByText('Nothing yet. It fills in when a show ends.')).toBeTruthy();
  useHome.setState({ studio: null } as never);
});

it('shows the last time on air', async () => {
  const now = Date.parse('2026-11-12T10:00:00-08:00');
  render(<IdlePage now={now} last={{ endedAt: now - 3_600_000, mode: 'live', lengthMs: 3_492_000, marks: 4 }} onHold={() => undefined} />);
  await act(async () => undefined);
  expect(screen.getByText('Live for 58:12')).toBeTruthy();
  expect(screen.getByText('4 marks saved')).toBeTruthy();
});

it('the Recording card says if the Camtasia Recorder is open, not open or not known', async () => {
  const now = Date.parse('2026-11-12T10:00:00-08:00');
  mocks.set('wall2_recorder_status', () => ({ state: 'open' }));
  const first = render(<IdlePage now={now} last={null} onHold={() => undefined} />);
  expect(await screen.findByText('Camtasia Recorder is open')).toBeTruthy();
  first.unmount();
  mocks.set('wall2_recorder_status', () => ({ state: 'none' }));
  useRecorder.setState({ open: null });
  const second = render(<IdlePage now={now} last={null} onHold={() => undefined} />);
  expect(await screen.findByText('Camtasia Recorder is not open')).toBeTruthy();
  second.unmount();
  mocks.set('wall2_recorder_status', () => ({ state: 'unknown' }));
  useRecorder.setState({ open: true });
  render(<IdlePage now={now} last={null} onHold={() => undefined} />);
  expect(await screen.findByText('Recorder not known')).toBeTruthy();
});

const SHOW_OK = { state: 'ok', title: 'Friday stream', parts: [{ name: 'Welcome', minutes: 5, notes: ['First note'] }, { name: 'Demo', minutes: 10, notes: ['Later note'] }], skipped: 0, reason: null, readAt: 1 } as const;

it('names the first part and its notes even when the saved part is a later one', async () => {
  useOnAirStore.setState({ saved: { ...IDLE, partIndex: 1 }, show: SHOW_OK as never });
  render(<IdlePage now={Date.parse('2026-11-12T10:00:00-08:00')} last={null} onHold={() => undefined} />);
  await act(async () => undefined);
  expect(screen.getByText('Next show notes \u00b7 Welcome')).toBeTruthy();
  expect(screen.getByText('First note')).toBeTruthy();
  expect(screen.queryByText('Later note')).toBeNull();
});

it('says why there are no parts and Open file asks for the file: refused, failed read, failed open', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_onair_open', (args) => void opened.push(args));
  const now = Date.parse('2026-11-12T10:00:00-08:00');
  useOnAirStore.setState({ show: { ...SHOW_OK, state: 'refused', parts: [], reason: 'run-of-show.txt is over 32 KB' } as never });
  const a = render(<IdlePage now={now} last={null} onHold={() => undefined} />);
  await act(async () => undefined);
  expect(screen.getByText('run-of-show.txt is over 32 KB')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
  await act(async () => undefined);
  expect(opened).toEqual([{ which: 'show' }]);
  a.unmount();
  useOnAirStore.setState({ show: null, showError: 'Could not read run-of-show.txt' });
  const b = render(<IdlePage now={now} last={null} onHold={() => undefined} />);
  expect(screen.getByText('Could not read run-of-show.txt')).toBeTruthy();
  b.unmount();
  useOnAirStore.setState({ show: null, showError: null, showNote: 'Could not open run-of-show.txt' });
  render(<IdlePage now={now} last={null} onHold={() => undefined} />);
  expect(screen.getByText('Could not open run-of-show.txt')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open file' })).toBeTruthy();
});
