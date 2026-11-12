import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const handlers = new Map<string, (e: { payload: unknown }) => void>();
let idleNow = false;
let displayVisible = true;
let idleGate: Promise<void> | null = null;

vi.mock('../bridge/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'wall2_idle_state') {
      await idleGate;
      return { idle: idleNow, idleSecs: 0 };
    }
    if (cmd === 'wall2_display_state') return { visible: displayVisible, reason: displayVisible ? null : 'display-off' };
    return undefined;
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return () => handlers.delete(name);
  }),
}));

import { useIdle } from './useIdle';

function Probe() {
  return <i data-testid="v">{String(useIdle())}</i>;
}
const emit = async (name: string, payload: unknown) => {
  await act(async () => {
    handlers.get(name)?.({ payload });
  });
};

beforeEach(() => {
  handlers.clear();
  idleNow = false;
  displayVisible = true;
  idleGate = null;
});
afterEach(() => handlers.clear());

it('follows idle-state edges', async () => {
  const { getByTestId } = render(<Probe />);
  await act(async () => {});
  expect(getByTestId('v').textContent).toBe('false');
  await emit('idle-state', { idle: true, idleSecs: 241 });
  expect(getByTestId('v').textContent).toBe('true');
  await emit('idle-state', { idle: false, idleSecs: 0 });
  expect(getByTestId('v').textContent).toBe('false');
});

it('counts a dark display as idle', async () => {
  const { getByTestId } = render(<Probe />);
  await act(async () => {});
  await emit('display-state', { visible: false, reason: 'display-off' });
  expect(getByTestId('v').textContent).toBe('true');
  await emit('display-state', { visible: true, reason: null });
  expect(getByTestId('v').textContent).toBe('false');
});

it('starts idle when the first read says so, and stops listening on unmount', async () => {
  idleNow = true;
  const { getByTestId, unmount } = render(<Probe />);
  await act(async () => {});
  expect(getByTestId('v').textContent).toBe('true');
  unmount();
  expect(handlers.size).toBe(0);
});

it('ignores a late first read that was overtaken by a back-from-idle event', async () => {
  idleNow = true;
  let release!: () => void;
  idleGate = new Promise<void>((r) => (release = r));
  const { getByTestId } = render(<Probe />);
  await act(async () => {});
  await emit('idle-state', { idle: false, idleSecs: 0 });
  expect(getByTestId('v').textContent).toBe('false');
  await act(async () => {
    release();
  });
  expect(getByTestId('v').textContent).toBe('false');
});

it('starts idle when the page loads while the display is off', async () => {
  displayVisible = false;
  const { getByTestId } = render(<Probe />);
  await act(async () => {});
  expect(getByTestId('v').textContent).toBe('true');
  await emit('display-state', { visible: true, reason: null });
  expect(getByTestId('v').textContent).toBe('false');
});
