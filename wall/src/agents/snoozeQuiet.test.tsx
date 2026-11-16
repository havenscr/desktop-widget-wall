import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { usePacificTime } from '../ribbon/testZone';
import { StatusLine } from '../unwind/StatusLine';
import { drawnLine } from '../unwind/statusTestUtil';
import { Dream } from '../zen/Dream';
import { lane, summary } from './fixtures';
import { resetSnooze, snooze, SNOOZE_MS, useSnoozed, useSnoozeStore } from './snooze';
import { resetAgents } from './useAgents';

usePacificTime();

const A = 'a1b2c3d4-0001';
const B = 'a1b2c3d4-0002';
const NOW = new Date(2026, 10, 11, 10, 24).toISOString();

const ask = (id: string, question: string) => ({ sessionId: id, title: 'A chat', kind: 'gate' as const, since: null, question });
/** One chat waits (A), or two (A and B). */
const waiting = (both: boolean) =>
  summary({
    now: NOW,
    lanes: [lane({ id: A, waiting: true, state: 'blocked', waitingSinceS: 120 }), ...(both ? [lane({ id: B, waiting: true, state: 'blocked', waitingSinceS: 60 })] : [])],
    yourMove: { total: both ? 2 : 1, first: ask(A, 'Which one?'), ids: both ? [A, B] : [A] },
  });

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 24));
  localStorage.clear();
  resetSnooze();
  resetAgents();
  useFocusStore.setState({ loaded: true });
  mocks.set('wall2_meet_day', () => ({ events: [] }));
});
afterEach(() => {
  cleanup();
  resetSnooze();
  resetAgents();
  mocks.clear();
  vi.useRealTimers();
});

/** The marks as a short word: the pill's words, or `quiet` when no pill is drawn. */
const line = () => drawnLine()?.pill ?? 'quiet';
const dream = () => document.querySelector('.dream-status')?.textContent ?? '';

it('Unwind: a snoozed chat raises no chip and no line; it comes back when the snooze ends', async () => {
  const s = waiting(false);
  mocks.set('wall2_omni_summary', () => s);
  snooze(A, s);
  render(<StatusLine />);
  await flush();
  expect(line()).toBe('quiet');
  expect(document.querySelector('.u-need')).toBeNull();
  await flush(SNOOZE_MS + 1000);
  expect(line()).toBe('One thing needs you');
  expect(document.querySelector('.u-need')).not.toBeNull();
});

it('Unwind: a snoozed chat and an unsnoozed one count only the unsnoozed one, and the chip opens that chat', async () => {
  const s = waiting(true);
  mocks.set('wall2_omni_summary', () => s);
  snooze(A, s);
  render(<StatusLine />);
  await flush();
  expect(line()).toBe('One thing needs you');
  const opened: unknown[] = [];
  mocks.set('wall2_open_session', (a) => void opened.push(a));
  await act(async () => (document.querySelector('.u-need') as HTMLButtonElement).click());
  expect(opened).toEqual([{ id: B }]);
});

it('Dream: a snoozed chat raises no needs-you line; it comes back when the snooze ends', async () => {
  const s = waiting(false);
  mocks.set('wall2_omni_summary', () => s);
  snooze(A, s);
  render(<Dream onWake={() => undefined} />);
  await flush();
  expect(dream()).toContain('No agent needs you');
  expect(dream()).not.toMatch(/(An agent|\d+ agents) need/);
  await flush(SNOOZE_MS + 1000);
  expect(dream()).toContain('An agent needs you');
});

it('Dream: a snoozed chat and an unsnoozed one count only the unsnoozed one', async () => {
  const s = waiting(true);
  mocks.set('wall2_omni_summary', () => s);
  snooze(A, s);
  render(<Dream onWake={() => undefined} />);
  await flush();
  expect(dream()).toContain('An agent needs you');
  expect(dream()).not.toContain('2 agents need you');
});

/** The same request as `waiting(false)`, read `later` ms afterwards: the helper's clock and the waiting counter both moved on. */
const readLater = (later: number, withList = false) => {
  const s = summary({
    now: new Date(Date.parse(NOW) + later).toISOString(),
    lanes: [lane({ id: A, waiting: true, state: 'blocked', waitingSinceS: 120 + later / 1000 })],
    yourMove: { total: 1, first: ask(A, 'Which one?'), ids: [A] },
  });
  return withList ? { ...s, sessionsList: s.lanes } : s;
};

it('Unwind and Dream reading the same request 45 s later do not end a snooze Work still shows', async () => {
  const work = waiting(false);
  snooze(A, work);
  mocks.set('wall2_omni_summary', () => readLater(45_000));
  const r = render(<StatusLine />);
  await flush();
  expect(line()).toBe('quiet');
  expect(useSnoozeStore.getState().entries[A]).toBeDefined();
  r.unmount();
  resetAgents();
  render(<Dream onWake={() => undefined} />);
  await flush();
  expect(dream()).toContain('No agent needs you');
  expect(useSnoozeStore.getState().entries[A]).toBeDefined();
  // Work's own read of the same moment still says snoozed.
  const { result } = renderHook(() => useSnoozed(readLater(45_000)));
  expect(result.current.ids.has(A)).toBe(true);
});

it('a chat that waits only in the session list keeps its snooze on Unwind (no your-move ids)', async () => {
  const mk = (later: number) => {
    const s = readLater(later, true);
    return { ...s, lanes: [], yourMove: { total: 1, first: null } };
  };
  snooze(A, mk(0));
  mocks.set('wall2_omni_summary', () => mk(45_000));
  render(<StatusLine />);
  await flush();
  expect(useSnoozeStore.getState().entries[A]).toBeDefined();
  expect(line()).toBe('quiet');
});
