import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const handlers = new Map<string, (e: { payload: unknown }) => void>();
const calls: string[] = [];
let modeNow = false;

vi.mock('../bridge/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    if (cmd === 'wall2_monitors_mode') return { active: modeNow };
    return undefined;
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return () => handlers.delete(name);
  }),
}));

import { FAILURE_MS, PENDING_MS, ScreensOff } from './ScreensOff';

const emit = async (payload: unknown) => {
  await act(async () => {
    handlers.get('monitors-off-mode')?.({ payload });
  });
};
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const button = () => screen.getByRole('button') as HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  calls.length = 0;
  modeNow = false;
});
afterEach(() => vi.useRealTimers());

it('taps through to the command and shows a pending state until the helper answers', async () => {
  render(<ScreensOff />);
  await flush();
  expect(button().getAttribute('aria-label')).toBe('Screens off');
  fireEvent.click(button());
  await flush();
  expect(calls).toContain('wall2_monitors_off');
  expect(button().getAttribute('aria-label')).toBe('Turning off');
  await emit({ active: true });
  expect(button().getAttribute('aria-label')).toBe('Cancel screens off');
  expect(button().getAttribute('aria-pressed')).toBe('true');
});

it('drops the pending look after a while if nothing answers', async () => {
  render(<ScreensOff />);
  await flush();
  fireEvent.click(button());
  await flush(PENDING_MS + 10);
  expect(button().getAttribute('aria-label')).toBe('Screens off');
});

it('reads the current mode on mount', async () => {
  modeNow = true;
  render(<ScreensOff />);
  await flush();
  expect(button().getAttribute('aria-pressed')).toBe('true');
});

it('cancels with a second tap', async () => {
  render(<ScreensOff />);
  await flush();
  await emit({ active: true });
  fireEvent.click(button());
  await flush();
  expect(calls.filter((c) => c === 'wall2_monitors_off').length).toBe(1);
  expect(button().getAttribute('aria-label')).toBe('Cancel screens off'); // no pending look while cancelling
  await emit({ active: false, reason: 'cancelled' });
  expect(button().getAttribute('aria-label')).toBe('Screens off');
  expect(screen.queryByRole('status')).toBeNull();
});

it('says it could not watch input, for 5 seconds', async () => {
  render(<ScreensOff />);
  await flush();
  fireEvent.click(button());
  await emit({ active: false, reason: 'input-unavailable' });
  expect(screen.getByRole('status').textContent).toBe('Could not watch input');
  expect(button().getAttribute('aria-label')).toBe('Screens off');
  await flush(FAILURE_MS + 10);
  expect(screen.queryByRole('status')).toBeNull();
});

it('is an icon alone, with the words as its tooltip and accessible name', async () => {
  render(<ScreensOff />);
  await flush();
  expect(button().textContent).toBe('');
  expect(button().getAttribute('title')).toBe('Screens off');
  expect(screen.getByRole('button', { name: 'Screens off' })).toBe(button());
  await emit({ active: true });
  expect(button().getAttribute('title')).toBe('Cancel screens off');
});
