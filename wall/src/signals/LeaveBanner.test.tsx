import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { useMeetingFeed } from '../work/useNextMeeting';
import { DISMISS_KEY, resetLeaveDismissed } from './leaveDismiss';
import { LeaveBanner } from './LeaveBanner';
import { useChipLayout } from './layout';
import { useSignalStore } from './store';

// Fake timers step through up to a minute here; the stepped span stays short, and the limit is generous for a slow runner.
vi.setConfig({ testTimeout: 20_000 });

const MIN = 60_000;
const NOW = new Date(2026, 10, 12, 9, 40).getTime();
const leaveAt = NOW + 25 * MIN;
const startsAt = leaveAt + 30 * MIN;
const meeting = (key: string, title: string, at = leaveAt) => ({ key, accountId: 'a', title, start: new Date(at).toISOString(), end: new Date(at + 90 * MIN).toISOString(), canJoin: false });

function setSignals(over: Partial<ReturnType<typeof useSignalStore.getState>> = {}) {
  useSignalStore.setState({ known: true, call: null, recording: false, leave: { key: 'doc', leaveAt, startsAt }, ...over });
}
const step = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  resetLeaveDismissed();
  usePlaceStore.setState({ active: 'work', from: 'work', zenDream: false });
  useMeetingFeed.setState({ meetings: [meeting('doc', "Doctor's appointment (10:45 start)")], feedStale: false, failed: false });
  setSignals();
});
afterEach(() => {
  resetTip();
  mocks.clear();
  vi.useRealTimers();
  useSignalStore.setState({ known: false, call: null, recording: false, leave: null });
  useChipLayout.setState({ banner: false, header: false });
  useMeetingFeed.setState({ meetings: [], feedStale: false, failed: false });
});

it('shows nothing when no event is coming', async () => {
  setSignals({ leave: null });
  render(<LeaveBanner />);
  await step(0);
  expect(document.querySelector('.leave-banner')).toBeNull();
  expect(document.documentElement.dataset.leaveBanner).toBeUndefined();
});

it('shows "Leave in 25 min." with the title and the real start, quiet at rest', async () => {
  render(<LeaveBanner />);
  await step(0);
  expect(screen.getByText('Leave in 25 min.')).toBeTruthy();
  expect(screen.getByText("Doctor's appointment starts 10:35")).toBeTruthy();
  expect(screen.getByText('turns amber at 5 minutes')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  expect(document.querySelector('.leave-banner')!.getAttribute('data-phase')).toBe('lead');
  expect(document.documentElement.dataset.leaveBanner).toBe('on');
  expect(useChipLayout.getState().banner).toBe(true);
});

it('is hidden more than 30 minutes ahead and appears when the time comes', async () => {
  setSignals({ leave: { key: 'doc', leaveAt: NOW + 31 * MIN, startsAt: NOW + 61 * MIN } });
  render(<LeaveBanner />);
  await step(0);
  expect(document.querySelector('.leave-banner')).toBeNull();
  vi.setSystemTime(NOW + 2 * MIN);
  await step(5_000);
  expect(screen.getByText(/Leave in 2[89] min\./)).toBeTruthy();
});

it('turns amber with Dismiss at 5 minutes, and Dismiss hides it for that event only, kept in storage', async () => {
  vi.setSystemTime(leaveAt - 4 * MIN);
  render(<LeaveBanner />);
  await step(5_000);
  const banner = document.querySelector('.leave-banner')!;
  expect(banner.getAttribute('data-phase')).toBe('amber');
  expect(screen.getByText('Leave in 4 min.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  await step(0);
  expect(document.querySelector('.leave-banner')).toBeNull();
  expect(JSON.parse(localStorage.getItem(DISMISS_KEY)!)).toEqual([{ key: 'doc', until: startsAt }]);
  expect(document.documentElement.dataset.leaveBanner).toBeUndefined();
  // Another event is not dismissed.
  act(() => setSignals({ leave: { key: 'other', leaveAt, startsAt } }));
  await step(0);
  expect(document.querySelector('.leave-banner')).not.toBeNull();
});

it('a dismissal kept in storage is cleared once the event is over', async () => {
  localStorage.setItem(DISMISS_KEY, JSON.stringify([{ key: 'old', until: NOW - MIN }, { key: 'doc', until: startsAt }]));
  const { readDismissed } = await import('./leaveDismiss');
  expect(readDismissed(NOW)).toEqual([{ key: 'doc', until: startsAt }]);
  // The expired entry is gone from storage itself, not only from what was returned.
  expect(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? 'null')).toEqual([{ key: 'doc', until: startsAt }]);
  localStorage.setItem(DISMISS_KEY, 'not json');
  expect(readDismissed(NOW)).toEqual([]);
});

it('starts no timer for the banner while there is no event to show', async () => {
  setSignals({ leave: null });
  const before = vi.getTimerCount();
  render(<LeaveBanner />);
  await step(0);
  expect(vi.getTimerCount()).toBe(before);
});

it('does not tick while the page is hidden, and refreshes at once when it shows again', async () => {
  render(<LeaveBanner />);
  await step(0);
  expect(screen.getByText('Leave in 25 min.')).toBeTruthy();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  await step(3 * MIN);
  expect(screen.getByText('Leave in 25 min.')).toBeTruthy();
  hidden.mockReturnValue(false);
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  await step(0);
  expect(screen.getByText('Leave in 22 min.')).toBeTruthy();
  hidden.mockRestore();
});

it('reads "Leave now." from the leave time, holds it after the store lets the event go, and hides after 10 minutes', async () => {
  vi.setSystemTime(leaveAt - 20_000);
  render(<LeaveBanner />);
  await step(0);
  vi.setSystemTime(leaveAt + 20_000);
  // The store drops an event once its leave time has passed.
  act(() => setSignals({ leave: null }));
  await step(5_000);
  expect(screen.getByText('Leave now.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  vi.setSystemTime(leaveAt + 10 * MIN + 1_000);
  await step(5_000);
  expect(document.querySelector('.leave-banner')).toBeNull();
});

it('lets an event that was cancelled in the meeting list go at once, even inside its "Leave now" window', async () => {
  vi.setSystemTime(leaveAt - 20_000);
  render(<LeaveBanner />);
  await step(0);
  vi.setSystemTime(leaveAt + 20_000);
  act(() => {
    setSignals({ leave: null });
    useMeetingFeed.setState({ meetings: [] });
  });
  await step(5_000);
  expect(document.querySelector('.leave-banner')).toBeNull();
});

it('never shows while the meeting list is stale or failed, or the signals are unknown', async () => {
  render(<LeaveBanner />);
  await step(0);
  expect(document.querySelector('.leave-banner')).not.toBeNull();
  act(() => useMeetingFeed.setState({ feedStale: true }));
  await step(0);
  expect(document.querySelector('.leave-banner')).toBeNull();
  act(() => useMeetingFeed.setState({ feedStale: false, failed: true }));
  await step(0);
  expect(document.querySelector('.leave-banner')).toBeNull();
  act(() => useMeetingFeed.setState({ failed: false }));
  await step(0);
  expect(document.querySelector('.leave-banner')).not.toBeNull();
  act(() => setSignals({ known: false }));
  await step(0);
  expect(document.querySelector('.leave-banner')).toBeNull();
});

it('shows on every place but Zen', async () => {
  render(<LeaveBanner />);
  for (const place of ['work', 'home', 'unwind', 'meet'] as const) {
    act(() => usePlaceStore.getState().setActive(place));
    await step(0);
    expect(document.querySelector('.leave-banner'), place).not.toBeNull();
  }
  act(() => usePlaceStore.getState().setActive('zen'));
  await step(0);
  expect(document.querySelector('.leave-banner')).toBeNull();
  expect(document.documentElement.dataset.leaveBanner).toBeUndefined();
});

it('the text opens the event by its key, and a failing open is quiet', async () => {
  const calls: unknown[] = [];
  mocks.set('wall2_open_event', (args) => {
    calls.push(args);
    throw 'nope';
  });
  render(<LeaveBanner />);
  await step(0);
  fireEvent.click(screen.getByRole('button', { name: /Leave in 25 min\. Doctor's appointment starts 10:35\. Opens the event/ }));
  await step(0);
  expect(calls).toEqual([{ key: 'doc' }]);
});

it('a long title is cut by the layout and shown whole on hover', async () => {
  const long = 'Annual planning offsite with the whole leadership group and every regional lead, hosted downtown';
  useMeetingFeed.setState({ meetings: [meeting('doc', `${long} (10:45 start)`)] });
  render(
    <>
      <LeaveBanner />
      <HoverTipLayer />
    </>,
  );
  await step(0);
  const rest = document.querySelector('.lb-rest')!;
  expect(rest.textContent).toBe(`${long} starts 10:35`);
  fireEvent.mouseEnter(screen.getByRole('button', { name: /Leave in 25 min/ }));
  await step(600);
  expect(document.querySelector('.hover-tip')?.textContent).toContain(long);
  expect(document.querySelector('.hover-tip')?.textContent).toContain('Leave at 10:05 AM');
});

it('carries the recording chip itself while a recorder runs', async () => {
  setSignals({ recording: true });
  render(<LeaveBanner />);
  await step(0);
  expect(document.querySelector('.leave-banner .rec-chip')).not.toBeNull();
});
