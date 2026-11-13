import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The stop rules as they are wired: real Tauri events for the display, Screens off mode and
// input idle drive the hooks, and the frame itself must go (and stay gone).
const handlers = new Map<string, (e: { payload: unknown }) => void>();
const answers: Record<string, unknown> = {};
vi.mock('../../bridge/tauri', () => ({
  isTauri: () => true,
  mocks: new Map(),
  invoke: vi.fn(async (cmd: string) => {
    if (cmd in answers) return answers[cmd];
    throw new Error('not mocked');
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return () => handlers.delete(name);
  }),
}));

import { usePlaceStore } from '../../state/places';
import { useSignalStore } from '../../signals/store';
import { Tabs } from '../Tabs';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { WatchPanel } from './Watch';

const V = 'Ab3dEfGh1jK';
const emit = async (name: string, payload: unknown) => {
  await act(async () => {
    handlers.get(name)?.({ payload });
  });
};
const frame = () => document.querySelector('iframe');

function View() {
  return (
    <>
      <Tabs />
      <WatchPanel />
    </>
  );
}

async function playing(expectFrame = true) {
  localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: V, label: 'Night drive mix' }]));
  resetWatch();
  usePlaceStore.setState({ active: 'unwind', from: 'work', zenDream: false });
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play({ kind: 'video', id: V });
  render(<View />);
  await act(async () => {});
  if (expectFrame) expect(frame()).not.toBeNull();
}

beforeEach(() => {
  handlers.clear();
  localStorage.clear();
  Object.assign(answers, { wall2_display_state: { visible: true }, wall2_monitors_mode: { active: false }, wall2_idle_state: { idle: false } });
  useSignalStore.setState({ call: null });
});
afterEach(() => {
  handlers.clear();
  localStorage.clear();
});

it('keeps playing through input idle (nobody touches the mouse while watching)', async () => {
  await playing();
  await emit('idle-state', { idle: true, idleSecs: 600 });
  expect(frame()).not.toBeNull();
  expect(useWatchStore.getState().playing).not.toBeNull();
});

it('removes the frame when the display goes off or Windows locks, and does not bring it back', async () => {
  await playing();
  await emit('display-state', { visible: false, reason: 'display-off' });
  expect(frame()).toBeNull();
  expect(screen.getByText(/Stopped when the display went off or Windows locked/)).toBeTruthy();
  await emit('display-state', { visible: true });
  expect(frame()).toBeNull();
});

it('removes the frame when Screens off mode turns on, and does not bring it back', async () => {
  await playing();
  await emit('monitors-off-mode', { active: true });
  expect(frame()).toBeNull();
  expect(screen.getByText(/Stopped when the screens went off/)).toBeTruthy();
  await emit('monitors-off-mode', { active: false });
  expect(frame()).toBeNull();
});

it('stops when the display read at start says it is off', async () => {
  answers.wall2_display_state = { visible: false };
  await playing(false);
  await act(async () => {});
  expect(frame()).toBeNull();
  expect(useWatchStore.getState().playing).toBeNull();
});

it('removes the frame on a click on the Dream tab (Zen opens)', async () => {
  await playing();
  await act(async () => screen.getByRole('tab', { name: 'Dream' }).click());
  expect(usePlaceStore.getState().active).toBe('zen');
  expect(frame()).toBeNull();
  usePlaceStore.setState({ active: 'unwind' });
  await act(async () => {});
  expect(frame()).toBeNull();
});

it('a play click in the same tick as a stop ends stopped', async () => {
  await playing();
  await act(async () => useWatchStore.getState().stop());
  expect(frame()).toBeNull();
  await act(async () => {
    screen.getByRole('button', { name: /Play Night drive mix/ }).click();
    handlers.get('display-state')?.({ payload: { visible: false } });
  });
  expect(frame()).toBeNull();
  expect(useWatchStore.getState().playing).toBeNull();
});
