import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { HEALTH_EVERY_MS } from './askModel';
import { useBriefAsk } from './useBriefAsk';

const flush = () => act(async () => {});
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

let asks: { key: unknown; q: unknown; turns: unknown }[] = [];
let healths = 0;
let reply: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;
let mode: 'hang' | 'ok' = 'ok';

beforeEach(() => {
  vi.useFakeTimers();
  asks = [];
  healths = 0;
  reply = null;
  mode = 'ok';
  usePlaceStore.setState({ active: 'meet' });
  mocks.set('wall2_meet_brief_health', () => {
    healths += 1;
    return { ask: { state: 'ready', name: 'Sonnet' } };
  });
  mocks.set('wall2_meet_brief_ask', (args) => {
    asks.push({ key: args?.key, q: args?.q, turns: args?.turns });
    if (mode === 'ok') return { a: `answer to ${String(args?.q)}`, model: 'Sonnet' };
    return new Promise((resolve, reject) => {
      reply = { resolve, reject };
    });
  });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  usePlaceStore.setState({ active: 'work' });
});

const mount = (k: string | null = 'k1', ready = true, onAir = false) => renderHook(({ k, r, a }) => useBriefAsk(k, r, a), { initialProps: { k, r: ready, a: onAir } });

describe('useBriefAsk', () => {
  it('reads health on show and every 60 s, and sends nothing by itself', async () => {
    const { result } = mount();
    await flush();
    expect(healths).toBe(1);
    expect(result.current.gate.enabled).toBe(true);
    await tick(HEALTH_EVERY_MS);
    expect(healths).toBe(2);
    expect(asks).toEqual([]);
  });

  it('reads no health while Meet is hidden, the brief is not ready or On Air is live', async () => {
    usePlaceStore.setState({ active: 'work' });
    const hidden = mount();
    await tick(HEALTH_EVERY_MS * 2);
    expect(healths).toBe(0);
    hidden.unmount();
    usePlaceStore.setState({ active: 'meet' });
    mount('k1', false);
    mount('k1', true, true);
    await tick(HEALTH_EVERY_MS);
    expect(healths).toBe(0);
  });

  it('sends one question at a time with the earlier turns, capped at three', async () => {
    const { result } = mount();
    await flush();
    for (const q of ['one', 'two', 'three', 'four']) {
      let sent = false;
      act(() => {
        sent = result.current.send(q);
      });
      expect(sent).toBe(true);
      await flush();
      expect(result.current.view?.phase).toBe('done');
      act(() => result.current.back());
    }
    expect(asks.map((a) => a.q)).toEqual(['one', 'two', 'three', 'four']);
    expect((asks[3].turns as { q: string }[]).map((t) => t.q)).toEqual(['one', 'two', 'three']);
    expect(asks[0]).toEqual({ key: 'k1', q: 'one', turns: [] });
    expect(result.current.hasTurns).toBe(true);
  });

  it('a second question while one is on its way is refused', async () => {
    mode = 'hang';
    const { result } = mount();
    await flush();
    act(() => void result.current.send('first'));
    expect(result.current.view?.phase).toBe('asking');
    let second = true;
    act(() => {
      second = result.current.send('second');
    });
    expect(second).toBe(false);
    expect(asks).toHaveLength(1);
  });

  it('counts seconds, and cancel drops the answer when it arrives', async () => {
    mode = 'hang';
    const { result } = mount();
    await flush();
    act(() => void result.current.send('first'));
    await tick(12_000);
    expect(Math.floor((result.current.view as { seconds: number }).seconds)).toBe(12);
    act(() => result.current.back());
    expect(result.current.view).toBeNull();
    await act(async () => reply?.resolve({ a: 'late', model: 'Sonnet' }));
    expect(result.current.view).toBeNull();
    expect(result.current.hasTurns).toBe(false);
  });

  it('a failed ask shows one fixed word and keeps no turn', async () => {
    mode = 'hang';
    const { result } = mount();
    await flush();
    act(() => void result.current.send('first'));
    await act(async () => reply?.reject('limit'));
    expect(result.current.view).toEqual({ q: 'first', phase: 'error', word: 'Hourly limit' });
    expect(result.current.hasTurns).toBe(false);
  });

  it('clears on a key change, on Clear, on hide and on On Air', async () => {
    const { result, rerender } = mount();
    await flush();
    act(() => void result.current.send('one'));
    await flush();
    expect(result.current.hasTurns).toBe(true);
    rerender({ k: 'k2', r: true, a: false });
    expect(result.current.view).toBeNull();
    expect(result.current.hasTurns).toBe(false);

    act(() => void result.current.send('two'));
    await flush();
    act(() => result.current.clear());
    expect(result.current.view).toBeNull();
    expect(result.current.hasTurns).toBe(false);

    act(() => void result.current.send('three'));
    await flush();
    act(() => usePlaceStore.setState({ active: 'work' }));
    expect(result.current.view).toBeNull();
    expect(result.current.hasTurns).toBe(false);

    act(() => usePlaceStore.setState({ active: 'meet' }));
    await flush();
    act(() => void result.current.send('four'));
    await flush();
    rerender({ k: 'k2', r: true, a: true });
    expect(result.current.view).toBeNull();
    expect(result.current.gate).toEqual({ enabled: false, reason: 'Hidden on air' });
  });

  it('sends nothing when the box says ask is off or the question is empty', async () => {
    mocks.set('wall2_meet_brief_health', () => ({ ask: { state: 'off', name: 'Claude' } }));
    const { result } = mount();
    await flush();
    let sent = true;
    act(() => {
      sent = result.current.send('hello');
    });
    expect(sent).toBe(false);
    expect(asks).toEqual([]);
    mocks.set('wall2_meet_brief_health', () => ({ ask: { state: 'ready', name: 'Sonnet' } }));
    const b = mount();
    await flush();
    act(() => {
      sent = b.result.current.send('   ');
    });
    expect(sent).toBe(false);
  });
});
