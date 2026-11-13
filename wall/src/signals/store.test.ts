import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Event, EventCallback, EventName, UnlistenFn } from '@tauri-apps/api/event';
import { mocks } from '../bridge/tauri';
import { useMeetingFeed } from '../work/useNextMeeting';
import { EMPTY_USE, type SignalPayload } from './model';
import { createSignalStore } from './store';

const known = (): SignalPayload => ({ known: true, mic: { ...EMPTY_USE, teams: true }, camera: { ...EMPTY_USE } });
const setTauri = () => Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  mocks.clear();
  vi.restoreAllMocks();
});

describe('signal store lifecycle', () => {
  it('registers the event listener before reading the fresh snapshot', async () => {
    setTauri();
    const order: string[] = [];
    const store = createSignalStore({
      now: () => 1,
      zone: () => 'UTC',
      listen: async <T,>(_name: EventName, _handler: EventCallback<T>): Promise<UnlistenFn> => { order.push('listen'); return () => {}; },
      invoke: async <T,>() => { order.push('invoke'); return known() as T; },
    });
    const dispose = store.getState().init();
    await vi.waitFor(() => expect(store.getState().known).toBe(true));
    expect(order).toEqual(['listen', 'invoke']);
    dispose();
  });

  it('immediately removes a listener that resolves after disposal', async () => {
    setTauri();
    let resolve!: (stop: () => void) => void;
    const stopped = vi.fn();
    const store = createSignalStore({
      now: () => 1,
      zone: () => 'UTC',
      listen: async <T,>(_name: EventName, _handler: EventCallback<T>): Promise<UnlistenFn> => new Promise((r) => { resolve = r; }),
      invoke: async <T,>() => known() as T,
    });
    store.getState().init()();
    resolve(stopped);
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
  });

  it('clears call, recording and leave on an unknown event', async () => {
    setTauri();
    useMeetingFeed.setState({ meetings: [{ key: 'opaque', accountId: 'a', title: 'Trip (11:00 start)', start: '2026-11-12T18:30:00Z', end: '2026-11-12T20:00:00Z', canJoin: true }], feedStale: false, failed: false });
    let event!: (event: Event<SignalPayload>) => void;
    const store = createSignalStore({
      now: () => Date.parse('2026-11-12T18:00:00Z'),
      zone: () => 'America/Los_Angeles',
      listen: async <T,>(_name: EventName, handler: EventCallback<T>): Promise<UnlistenFn> => { event = handler as EventCallback<SignalPayload>; return () => {}; },
      invoke: async <T,>() => ({ ...known(), camera: { ...EMPTY_USE, recorder: true } }) as T,
    });
    const dispose = store.getState().init();
    await vi.waitFor(() => expect(store.getState().leave?.key).toBe('opaque'));
    event({ payload: { known: false, mic: { ...EMPTY_USE }, camera: { ...EMPTY_USE } } } as Event<SignalPayload>);
    expect(store.getState()).toMatchObject({ known: false, call: null, recording: false, leave: null });
    dispose();
  });
});
