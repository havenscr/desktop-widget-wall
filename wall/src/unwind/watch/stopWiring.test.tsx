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
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { WatchStageLayer } from './StageLayer';
import { WatchPanel } from './Watch';

const V = 'Ab3dEfGh1jK';
const emit = async (name: string, payload: unknown) => {
  await act(async () => {
    handlers.get(name)?.({ payload });
  });
};
const frame = () => document.querySelector('iframe');

// Only Watch's own panel: leaving Watch goes through the stores (the Listen switch sets the Watch
// store's tab; Zen is a place), so the test does not depend on how Unwind draws its switch.
function View() {
  return (
    <>
      <WatchStageLayer />
      <WatchPanel />
    </>
  );
}

async function playing(expectFrame = true) {
  localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: V, label: 'Night drive mix' }]));
  resetWatch();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
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

it('keeps the same frame when Watch is left for Listen and when Zen opens, and the stop rules still hold there', async () => {
  await playing();
  const el = frame()!;
  const parent = el.parentElement;
  await act(async () => useWatchStore.getState().setTab('listen'));
  expect(frame()).toBe(el);
  expect(el.parentElement).toBe(parent);
  await act(async () => usePlaceStore.getState().setActive('zen'));
  expect(frame()).toBe(el);
  expect(el.parentElement).toBe(parent);
  // Out of sight, a call still removes it.
  await act(async () => useSignalStore.setState({ call: { kind: 'teams', since: 0, camera: false } as never }));
  expect(frame()).toBeNull();
  expect(useWatchStore.getState().stopped).toBe('Stopped for your call.');
  await act(async () => useSignalStore.setState({ call: null }));
  usePlaceStore.setState({ active: 'unwind' });
  await act(async () => useWatchStore.getState().setTab('watch'));
  expect(frame()).toBeNull();
});

it('out of sight, the display going off still removes the frame', async () => {
  await playing();
  await act(async () => usePlaceStore.getState().setActive('work'));
  expect(frame()).not.toBeNull();
  await emit('display-state', { visible: false, reason: 'display-off' });
  expect(frame()).toBeNull();
  expect(useWatchStore.getState().stopped).toBe('Stopped when the display went off or Windows locked.');
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
