import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from './fixtures';
import type { OmniSummary } from './model';
import { MAX_SNOOZES, resetSnooze, snooze, SNOOZE_MS, useSnoozeStore, useSnoozed } from './snooze';

const ID = 'a1b2c3d4-0001';
const asking = (question: string, waitingSinceS = 120): OmniSummary =>
  summary({
    lanes: [lane({ id: ID, waiting: true, state: 'blocked', waitingSinceS })],
    yourMove: { total: 1, first: { sessionId: ID, title: 'Voice fix', kind: 'gate', since: null, question }, ids: [ID] },
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 24));
  localStorage.clear();
  resetSnooze();
});
afterEach(() => {
  resetSnooze();
  vi.useRealTimers();
});

it('a new question from the same session ends the snooze at once', () => {
  const first = asking('Which thumbnail?');
  const { result, rerender } = renderHook(({ s }) => useSnoozed(s), { initialProps: { s: first } });
  act(() => snooze(ID, first));
  expect(result.current.ids.has(ID)).toBe(true);
  // Same question a little later (the helper's wait counter grew): still snoozed.
  vi.setSystemTime(new Date(2026, 10, 11, 10, 25));
  rerender({ s: asking('Which thumbnail?', 180) });
  expect(result.current.ids.has(ID)).toBe(true);
  // A different question: awake again, and the snooze is forgotten.
  rerender({ s: asking('Merge it?', 10) });
  expect(result.current.ids.has(ID)).toBe(false);
  expect(useSnoozeStore.getState().entries[ID]).toBeUndefined();
});

it('a new request with the same question text but a later waiting-since time ends the snooze', () => {
  const first = asking('Go ahead?', 600);
  const { result, rerender } = renderHook(({ s }) => useSnoozed(s), { initialProps: { s: first } });
  act(() => snooze(ID, first));
  expect(result.current.ids.has(ID)).toBe(true);
  rerender({ s: asking('Go ahead?', 5) });
  expect(result.current.ids.has(ID)).toBe(false);
});

it('a new request with identical text 30 seconds later ends the snooze, one 10 seconds later does not', () => {
  const first = asking('Go ahead?', 600);
  const { result, rerender } = renderHook(({ s }) => useSnoozed(s), { initialProps: { s: first } });
  act(() => snooze(ID, first));
  // Waiting 10 s longer than before at the same helper time: inside the 20 s tolerance.
  rerender({ s: asking('Go ahead?', 590) });
  expect(result.current.ids.has(ID)).toBe(true);
  // Began waiting 30 s later: a new request.
  rerender({ s: asking('Go ahead?', 570) });
  expect(result.current.ids.has(ID)).toBe(false);
});

it('a changed question ends the snooze even when the waiting-since time is the same', () => {
  const first = asking('Go ahead?', 600);
  const { result, rerender } = renderHook(({ s }) => useSnoozed(s), { initialProps: { s: first } });
  act(() => snooze(ID, first));
  rerender({ s: asking('Delete it instead?', 600) });
  expect(result.current.ids.has(ID)).toBe(false);
});

it('a session that stops waiting loses its snooze', () => {
  const first = asking('Which thumbnail?');
  const { result, rerender } = renderHook(({ s }) => useSnoozed(s), { initialProps: { s: first } });
  act(() => snooze(ID, first));
  rerender({ s: summary({ lanes: [lane({ id: ID })] }) });
  expect(result.current.ids.size).toBe(0);
  expect(useSnoozeStore.getState().entries[ID]).toBeUndefined();
});

it('the snooze ends by itself at its time: only the clock moves, nothing polls', () => {
  const s = asking('Which thumbnail?');
  const { result } = renderHook(() => useSnoozed(s));
  act(() => snooze(ID, s));
  expect(result.current.ids.has(ID)).toBe(true);
  expect(result.current.until[ID]).toBe(Date.now() + SNOOZE_MS);
  // Just before the end it is still snoozed; the timer fires a moment after the end.
  act(() => {
    vi.advanceTimersByTime(SNOOZE_MS - 1000);
  });
  expect(result.current.ids.has(ID)).toBe(true);
  act(() => {
    vi.advanceTimersByTime(1100);
  });
  expect(result.current.ids.has(ID)).toBe(false);
});

it('drops malformed, expired, over-long and over-count stored values on read', async () => {
  const now = Date.now();
  const good = { until: now + 60_000, since: null, question: 'ok' };
  const raw: Record<string, unknown> = {
    [ID]: good,
    'bad id with spaces': good,
    expired: { ...good, until: now - 1 },
    forever: { ...good, until: 9e15 },
    noQuestion: { until: now + 1000, since: null },
    longQuestion: { ...good, question: 'x'.repeat(5000) },
    notAnObject: 5,
  };
  for (let i = 0; i < 40; i++) raw[`many-${i}`] = good;
  localStorage.setItem('wall2-agent-snooze', JSON.stringify(raw));
  vi.resetModules();
  const fresh = await import('./snooze');
  const kept = Object.keys(fresh.useSnoozeStore.getState().entries);
  expect(kept).toContain(ID);
  expect(kept).not.toContain('bad id with spaces');
  expect(kept).not.toContain('expired');
  expect(kept).not.toContain('forever');
  expect(kept).not.toContain('noQuestion');
  expect(kept).not.toContain('longQuestion');
  expect(kept).not.toContain('notAnObject');
  expect(kept.length).toBeLessThanOrEqual(MAX_SNOOZES);
  localStorage.setItem('wall2-agent-snooze', '{not json');
  vi.resetModules();
  expect(Object.keys((await import('./snooze')).useSnoozeStore.getState().entries)).toEqual([]);
});

it('keeps at most 20 snoozes when saving', () => {
  const s = asking('q');
  for (let i = 0; i < 30; i++) snooze(`s-${i}`, s);
  expect(Object.keys(useSnoozeStore.getState().entries).length).toBeLessThanOrEqual(MAX_SNOOZES);
});
