import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useCardScroll } from '../agents/cardScroll';
import { lane, summary } from '../agents/fixtures';
import { resetSnooze, snooze } from '../agents/snooze';
import { resetAgents } from '../agents/useAgents';
import type { Meeting } from '../meet/model';
import { alarmItem, FLASH_MS, mergeItems, meetingItem, MEETING_LEAD_MS, runForYou, showCard, useForYou, waitingItems } from './forYou';
import { resetMeetingFeed } from './useNextMeeting';

const NOW = new Date(2026, 10, 12, 10, 0).getTime();
const mt = (startMin: number, endMin: number, over: Partial<Meeting> = {}): Meeting => ({
  key: 'm1',
  accountId: 'a',
  title: 'Design review',
  start: new Date(NOW + startMin * 60_000).toISOString(),
  end: new Date(NOW + endMin * 60_000).toISOString(),
  canJoin: true,
  ...over,
});
const sec = (over = {}) => ({
  reachable: true,
  stale: false,
  lastScan: null,
  alerts: 2,
  firewalla: null,
  portalUrl: null,
  topAlerts: [{ text: 'New device on the guest network', severity: 'high' as const, atMs: NOW - 12 * 60_000 }],
  ...over,
});

it('a meeting is for you from 10 minutes before it starts until it ends', () => {
  expect(MEETING_LEAD_MS).toBe(10 * 60_000);
  expect(meetingItem(mt(10, 40), NOW, true)?.reason).toBe('starts in 10 min');
  expect(meetingItem(mt(4, 30), NOW, true)?.reason).toBe('starts in 4 min');
  expect(meetingItem(mt(-5, 25), NOW, true)?.reason).toBe('live, 25 min left');
  expect(meetingItem(mt(11, 40), NOW, true)).toBeNull();
  expect(meetingItem(mt(-40, -10), NOW, true)).toBeNull();
  expect(meetingItem(mt(4, 30, { canJoin: false }), NOW, true)).toBeNull();
  expect(meetingItem(mt(4, 30), NOW, false)).toBeNull();
  expect(meetingItem(undefined, NOW, true)).toBeNull();
  expect(meetingItem(mt(4, 30), NOW, true)).toMatchObject({ kind: 'meeting', action: 'Join', ref: 'm1', title: 'Design review' });
});

it('a waiting session shows its question, else how long it has waited, and skips a snoozed one', () => {
  const s = summary({
    yourMove: { total: 2, first: { sessionId: 'w1', title: 'Social card', kind: 'question', since: null, question: 'which thumbnail' }, ids: ['w1', 'w2'] },
    lanes: [lane({ id: 'w1', title: 'Social card', waiting: true }), lane({ id: 'w2', title: 'Admin pill', waiting: true, waitingSinceS: 600 })],
  });
  const items = waitingItems(s, new Set());
  expect(items.map((i) => [i.title, i.reason, i.action, i.ref])).toEqual([
    ['Social card', 'asks: which thumbnail', 'Open chat', 'w1'],
    ['Admin pill', 'waiting 10 min', 'Open chat', 'w2'],
  ]);
  expect(waitingItems(s, new Set(['w1'])).map((i) => i.ref)).toEqual(['w2']);
  expect(waitingItems(s, new Set(['w1', 'w2']))).toEqual([]);
});

it('a ready pull request is an item with a Show button; one that is failing or running is not', () => {
  const ready = lane({ id: 'p1', title: 'Pill', stage: 'pr', pr: { number: 7, ci: 'passing', ready: true } });
  const items = mergeItems(summary({ lanes: [ready, lane({ id: 'p2', stage: 'pr', pr: { number: 8, ci: 'failing', ready: true } }), lane({ id: 'p3', stage: 'pr', pr: { number: 9, ci: 'pending', ready: false } }), lane()] }));
  expect(items.map((i) => [i.ref, i.reason, i.action])).toEqual([['p1', 'PR 7 ready to merge', 'Show']]);
});

it('an alarm is an item only from a fresh, reachable read with its link available', () => {
  expect(alarmItem(sec(), 'ready', true, NOW)).toMatchObject({ kind: 'alarm', title: 'New device on the guest network', reason: '12m ago, 2 open', action: 'Open' });
  expect(alarmItem(sec({ alerts: 1 }), 'ready', true, NOW)?.reason).toBe('12m ago');
  expect(alarmItem(sec(), 'ready', false, NOW)).toBeNull();
  expect(alarmItem(sec({ stale: true }), 'ready', true, NOW)).toBeNull();
  expect(alarmItem(sec({ reachable: false }), 'ready', true, NOW)).toBeNull();
  expect(alarmItem(sec({ alerts: 0 }), 'ready', true, NOW)).toBeNull();
  expect(alarmItem(sec(), 'error', true, NOW)).toBeNull();
  expect(alarmItem(sec({ topAlerts: [] }), 'ready', true, NOW)).toBeNull();
  expect(alarmItem(null, 'ready', true, NOW)).toBeNull();
});

it('each action calls the command that already exists, with the right id, and answers one line', async () => {
  const calls: [string, unknown][] = [];
  for (const c of ['wall2_meet_join', 'wall2_focus_omnigent', 'wall2_open_link']) mocks.set(c, (a) => void calls.push([c, a]));
  const item = (kind: 'meeting' | 'waiting' | 'merge' | 'alarm', ref: string | null) => ({ key: 'k', kind, title: '', reason: '', action: '', actionTip: '', ref });
  expect(await runForYou(item('meeting', 'm1'))).toBe('Joining the meeting');
  expect(await runForYou(item('waiting', 'w1'))).toBe('Opened the chat');
  expect(await runForYou(item('alarm', null))).toBe('Opened the alarms');
  const before = useCardScroll.getState().n;
  expect(await runForYou(item('merge', 'p1'))).toBe('Showing the card');
  expect(calls).toEqual([
    ['wall2_meet_join', { key: 'm1' }],
    ['wall2_focus_omnigent', { id: 'w1' }],
    ['wall2_open_link', { kind: 'security' }],
  ]);
  expect(useCardScroll.getState()).toMatchObject({ id: 'p1', n: before + 1 });
  mocks.set('wall2_meet_join', () => {
    throw 'gone';
  });
  await expect(runForYou(item('meeting', 'm1'))).rejects.toThrow('Could not open the meeting');
  mocks.set('wall2_open_link', () => {
    throw 'x';
  });
  await expect(runForYou(item('alarm', null))).rejects.toThrow('Could not open the alarms');
  mocks.clear();
});

it('Show twice within the flash keeps the second flash whole', () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div class="lane" data-id="p1"></div>';
  const el = document.querySelector('.lane')!;
  showCard('p1');
  vi.advanceTimersByTime(1);
  expect(el.classList.contains('deck-flash')).toBe(true);
  vi.advanceTimersByTime(1_000);
  showCard('p1');
  vi.advanceTimersByTime(1);
  // The first flash's end (1.4 s after the first click) must not cut the second one short.
  vi.advanceTimersByTime(FLASH_MS - 1_000);
  expect(el.classList.contains('deck-flash')).toBe(true);
  vi.advanceTimersByTime(1_000);
  expect(el.classList.contains('deck-flash')).toBe(false);
  vi.useRealTimers();
  document.body.innerHTML = '';
});

it('Show scrolls to the card and flashes its ring once, then stops', () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div class="lane" data-id="p1"></div>';
  showCard('p1');
  vi.advanceTimersByTime(1);
  const el = document.querySelector('.lane')!;
  expect(el.classList.contains('deck-flash')).toBe(true);
  vi.advanceTimersByTime(FLASH_MS + 1);
  expect(el.classList.contains('deck-flash')).toBe(false);
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// The whole hook, over the real stores and the mocked commands.
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const agentsAnswer = (over = {}) =>
  summary({
    yourMove: { total: 1, first: { sessionId: 'w1', title: 'Social card', kind: 'question', since: null, question: '' }, ids: ['w1'] },
    lanes: [lane({ id: 'w1', title: 'Social card', waiting: true, waitingSinceS: 180 }), lane({ id: 'p1', title: 'Pill', stage: 'pr', pr: { number: 7, ci: 'passing', ready: true } })],
    ...over,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetAgents();
  resetMeetingFeed();
  resetSnooze();
  mocks.set('wall2_omni_summary', () => agentsAnswer({ now: new Date(NOW).toISOString() }));
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [mt(4, 30)] }));
  mocks.set('wall2_home_security', () => sec());
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
});
afterEach(() => {
  resetAgents();
  resetMeetingFeed();
  resetSnooze();
  vi.useRealTimers();
  mocks.clear();
});

it('lists a meeting, then agents waiting, then a ready pull request, then an alarm', async () => {
  const { result } = renderHook(() => useForYou());
  await flush(50);
  expect(result.current.map((i) => i.kind)).toEqual(['meeting', 'waiting', 'merge', 'alarm']);
});

it('leaves out a snoozed session, and every agent item when the helper is down, but keeps the rest', async () => {
  const { result, unmount } = renderHook(() => useForYou());
  await flush(50);
  act(() => snooze('w1', agentsAnswer({ now: new Date(NOW).toISOString() }), NOW));
  await flush(0);
  expect(result.current.map((i) => i.kind)).toEqual(['meeting', 'merge', 'alarm']);
  unmount();
  resetAgents();
  resetSnooze();
  mocks.set('wall2_omni_summary', () => {
    throw new Error('down');
  });
  const down = renderHook(() => useForYou());
  await flush(50);
  expect(down.result.current.map((i) => i.kind)).toEqual(['meeting', 'alarm']);
});

it('shows nothing from a stale source: an old meeting list, an old security read, a stale agents answer', async () => {
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [mt(4, 30)], stale: true }));
  mocks.set('wall2_home_security', () => sec({ stale: true }));
  mocks.set('wall2_omni_summary', () => agentsAnswer({ now: new Date(NOW).toISOString(), stale: true }));
  const { result } = renderHook(() => useForYou());
  await flush(50);
  expect(result.current).toEqual([]);
});

it('hides the alarm when Home has no link for it', async () => {
  mocks.set('wall2_links', () => ({ security: false, portal: false }));
  const { result } = renderHook(() => useForYou());
  await flush(50);
  expect(result.current.map((i) => i.kind)).toEqual(['meeting', 'waiting', 'merge']);
});

it('reads the link availability again with each security poll, so a link set up later shows without a restart', async () => {
  let linked = false;
  mocks.set('wall2_links', () => ({ security: linked, portal: false }));
  const { result } = renderHook(() => useForYou());
  await flush(50);
  expect(result.current.map((i) => i.kind)).not.toContain('alarm');
  linked = true;
  await flush(5 * 60_000 + 100);
  expect(result.current.map((i) => i.kind)).toContain('alarm');
});
