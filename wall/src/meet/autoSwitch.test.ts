import { afterEach, beforeEach, expect, it } from 'vitest';
import { usePlaceStore, type PlaceId } from '../state/places';
import { useSignalStore } from '../signals/store';
import type { CallSignal } from '../signals/model';
import { startAutoSwitch } from './autoSwitch';

const call = (since: number, over: Partial<CallSignal> = {}): CallSignal => ({ kind: 'teams', since, camera: false, ...over });
let stop: () => void;
let visible = true;

beforeEach(() => {
  visible = true;
  useSignalStore.setState({ known: true, call: null, recording: false, leave: null });
  usePlaceStore.setState({ active: 'work', from: 'work' });
  stop = startAutoSwitch(() => visible);
});
afterEach(() => {
  stop();
  useSignalStore.setState({ known: false, call: null });
  usePlaceStore.setState({ active: 'work', from: 'work' });
});

const startFrom = (place: PlaceId, since = 1) => {
  usePlaceStore.setState({ active: place });
  useSignalStore.setState({ call: call(since) });
  return usePlaceStore.getState().active;
};

it('opens Meet when a call starts from Work, Home, Unwind or Shelf', () => {
  for (const place of ['work', 'home', 'unwind', 'shelf'] as const) {
    useSignalStore.setState({ call: null });
    expect(startFrom(place, 100 + place.length)).toBe('meet');
  }
});

it('stays on Meet when it is already there, and never leaves On Air or Zen', () => {
  expect(startFrom('meet')).toBe('meet');
  useSignalStore.setState({ call: null });
  expect(startFrom('onair', 2)).toBe('onair');
  useSignalStore.setState({ call: null });
  expect(startFrom('zen', 3)).toBe('zen');
});

it('does nothing while the page is hidden, and does not switch later in the same call', () => {
  visible = false;
  expect(startFrom('work', 5)).toBe('work');
  visible = true;
  // The call is already running: a change inside it (camera, a second tick) is not a start.
  useSignalStore.setState({ call: call(5, { camera: true }) });
  expect(usePlaceStore.getState().active).toBe('work');
});

it('switches once for a call: leaving Meet during it does not bring Meet back', () => {
  expect(startFrom('work', 7)).toBe('meet');
  usePlaceStore.setState({ active: 'work' });
  useSignalStore.setState({ call: call(7, { camera: true }) });
  useSignalStore.setState({ call: call(7, { camera: false }) });
  expect(usePlaceStore.getState().active).toBe('work');
});

it('a new call opens Meet again, and it never switches back when the call ends', () => {
  expect(startFrom('work', 10)).toBe('meet');
  useSignalStore.setState({ call: null });
  expect(usePlaceStore.getState().active).toBe('meet');
  usePlaceStore.setState({ active: 'home' });
  useSignalStore.setState({ call: call(20) });
  expect(usePlaceStore.getState().active).toBe('meet');
  useSignalStore.setState({ call: null });
  expect(usePlaceStore.getState().active).toBe('meet');
});

it('a call that was running before the switch started is not a start, and stopping unsubscribes', () => {
  stop();
  useSignalStore.setState({ call: call(30) });
  stop = startAutoSwitch(() => visible);
  usePlaceStore.setState({ active: 'work' });
  useSignalStore.setState({ call: call(30, { camera: true }) });
  expect(usePlaceStore.getState().active).toBe('work');
  stop();
  useSignalStore.setState({ call: null });
  useSignalStore.setState({ call: call(31) });
  expect(usePlaceStore.getState().active).toBe('work');
});
