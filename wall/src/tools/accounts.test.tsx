import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { Accounts } from './accounts';
import { resetTools, useToolsStore } from './store';
import type { MeetData } from '../meet/model';

const NOW = Date.parse('2026-11-12T17:00:00Z');
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString().replace('.000Z', 'Z');

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  resetTools();
  resetTip();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  usePlaceStore.setState({ active: 'meet' });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  usePlaceStore.setState({ active: 'work' });
});

/** How many reads Meet made: each one opens with one peek, then asks each account. */
const reads = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.filter((c) => (c[0] as { peek?: boolean } | undefined)?.peek === true).length;

const data: MeetData = {
  accounts: [
    { id: 'work', label: 'Work', state: 'ok' },
    { id: 'second', label: 'Second', state: 'needs-sign-in' },
  ],
  meetings: [
    { key: '1-0', accountId: 'work', title: 'Design review', start: at(3), end: at(33), canJoin: true },
    { key: '1-1', accountId: 'work', title: 'Planning', start: at(60), end: at(90), canJoin: false },
    { key: '1-2', accountId: 'work', title: 'Board prep', start: at(120), end: at(150), canJoin: true },
  ],
};


/** Rest the pointer on an element: the text of the hover card that opens. */
const hoverText = async (el: Element): Promise<string> => {
  fireEvent.mouseEnter(el);
  await flush(300);
  return document.querySelector('.hover-tip')?.textContent ?? '';
};
const peekOnly = (full: MeetData) => (args?: Record<string, unknown>) =>
  args?.peek ? { accounts: full.accounts.map((a) => ({ ...a, state: 'checking' as const })), meetings: [], seq: 1 } : undefined;

const unavailable: MeetData = {
  accounts: [
    { id: 'work', label: 'Work', state: 'ok' },
    { id: 'second', label: 'Second', state: 'unavailable', reason: 'graph-403-ErrorAccessDenied' },
  ],
  meetings: data.meetings.slice(0, 2),
};

it('signing in shows Waiting for the browser and Cancel, which calls cancel', async () => {
  const cancel = vi.fn();
  let finish: () => void = () => undefined;
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_in', () => new Promise<void>((r) => (finish = r)));
  mocks.set('wall2_meet_cancel_sign_in', cancel);
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(screen.getByText('Waiting for the browser')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(screen.queryByText('Waiting for the browser')).toBeNull();
});

it('sign out calls the native side with the id', async () => {
  const out = vi.fn();
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_out', out);
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(out).toHaveBeenCalledWith({ id: 'work' });
});

it('closing the drawer during a sign-in cancels it', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_cancel_sign_in', cancel);
  const { unmount } = render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(cancel).not.toHaveBeenCalled();
  unmount();
  await flush();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('a sign-in that is declined says so and leaves Sign in available', async () => {
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_in', () => Promise.reject(new Error('denied')));
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(screen.getByText('Sign-in was declined')).toBeTruthy();
  expect(screen.queryByText('Waiting for the browser')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
});

it('Spotify: a waiting sign-in shows Cancel, which cancels it; leaving the drawer cancels it too', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [] }));
  mocks.set('wall2_spotify_status', () => ({ setup: true, signedIn: false }));
  mocks.set('wall2_spotify_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_spotify_cancel_sign_in', cancel);
  const first = render(<Accounts />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(screen.getByText('Waiting for the browser')).toBeTruthy();
  expect(useToolsStore.getState().waiting.spotify).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  first.unmount();
  await flush();
  // Unmounting with the sign-in still waiting cancels it again, so the native side is never left waiting.
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(useToolsStore.getState().waiting.spotify).toBe(false);
});

it('a read requested during a read runs once more afterwards', async () => {
  let release: (v: MeetData) => void = () => undefined;
  let calls = 0;
  const next = vi.fn(() => {
    calls += 1;
    if (calls === 4) return new Promise<MeetData>((r) => (release = r));
    return data;
  });
  mocks.set('wall2_meet_next', next);
  mocks.set('wall2_meet_sign_in', () => undefined);
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(reads(next)).toBe(1);
  // The 5 minute poll starts a read that stays open; the sign-in finishes meanwhile.
  await flush(5 * 60_000);
  expect(reads(next)).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(reads(next)).toBe(2);
  release(data);
  await flush();
  expect(reads(next)).toBe(3);
});

it('an unavailable account shows plain words, the reason line and one action: Try again', async () => {
  mocks.set('wall2_meet_next', () => unavailable);
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(screen.getByText(/^Calendar could not be read/)).toBeTruthy();
  // The code is in the row's hover, never on its face.
  expect(screen.queryByText('graph-403-ErrorAccessDenied')).toBeNull();
  expect(await hoverText(screen.getByText(/^Calendar could not be read/).closest('li')!)).toContain('graph-403-ErrorAccessDenied');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  // The connected account keeps Sign out; the unavailable one has only Try again.
  expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
});

it('Try again on an unavailable account reads once, at once', async () => {
  const next = vi.fn(() => unavailable);
  mocks.set('wall2_meet_next', next);
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(reads(next)).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await flush();
  expect(reads(next)).toBe(2);
});

it('Sign in on a signed-out account starts a sign-in for that account', async () => {
  const signIn = vi.fn(() => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_in', signIn);
  mocks.set('wall2_meet_cancel_sign_in', () => undefined);
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(signIn).toHaveBeenCalledWith({ id: 'second' });
});

it('names a network problem and shows the time of the last try', async () => {
  mocks.set('wall2_meet_next', () => ({
    accounts: [{ id: 'work', label: 'Work', state: 'unavailable', reason: 'graph-network' }],
    meetings: [],
  }));
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(screen.getByText(/^Network problem/)).toBeTruthy();
  const card = await hoverText(screen.getByText(/^Network problem/).closest('li')!);
  expect(card).toMatch(/Last try \d+(:\d\d)? [AP]M/);
  expect(card).toContain('graph-network');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});
it('shows an account as soon as it answers while the other is still being asked', async () => {
  mocks.set('wall2_meet_next', (args) => {
    if (args?.peek) return peekOnly(data)(args);
    if (args?.only === 'work') return { ...data, accounts: [data.accounts[0], { ...data.accounts[1], state: 'checking' }], meetings: data.meetings.slice(0, 2), seq: 2 };
    return new Promise(() => undefined);
  });
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(screen.queryByText('Loading meetings')).toBeNull();
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.getByText('Checking')).toBeTruthy();
});

it('an account that has not answered in 12 seconds shows as not answering, with Try again', async () => {
  mocks.set('wall2_meet_next', (args) => {
    if (args?.peek) return peekOnly(data)(args);
    if (args?.only === 'work') return { ...data, accounts: [data.accounts[0], { ...data.accounts[1], state: 'checking' }], meetings: data.meetings.slice(0, 2), seq: 2 };
    return new Promise(() => undefined);
  });
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush(11_000);
  expect(screen.getByText('Checking')).toBeTruthy();
  await flush(1_500);
  expect(screen.queryByText('Checking')).toBeNull();
  expect(screen.getByText(/^Microsoft is not answering/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

it('two quick manual Try again taps leave the 30 s retry scheduled', async () => {
  const next = vi.fn(() => unavailable);
  mocks.set('wall2_meet_next', next);
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await flush(100);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await flush(100);
  expect(reads(next)).toBe(3);
  await flush(29_000);
  expect(reads(next)).toBe(3);
  await flush(1_000);
  expect(reads(next)).toBe(4);
  // The schedule continues with the 60 s step, not past it.
  await flush(60_000);
  expect(reads(next)).toBe(5);
  await flush(100_000);
  expect(reads(next)).toBe(5);
});

it('a needs-sign-in account with a reason explains itself', async () => {
  mocks.set('wall2_meet_next', () => ({
    ...unavailable,
    accounts: [unavailable.accounts[0], { id: 'second', label: 'Second', state: 'needs-sign-in', reason: 'token-400-65001' }],
  }));
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(screen.queryByText(/token-400-65001/)).toBeNull();
  expect(await hoverText(screen.getByText('Sign-in expired').closest('li')!)).toContain('Sign-in was not accepted (token-400-65001)');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
});

it('a late answer after the 12 second limit corrects the row at once', async () => {
  let late: (v: MeetData) => void = () => undefined;
  mocks.set('wall2_meet_next', (args) => {
    if (args?.peek) return peekOnly(data)(args);
    if (args?.only === 'work') return { ...data, accounts: [data.accounts[0], { ...data.accounts[1], state: 'checking' }], meetings: data.meetings.slice(0, 2), seq: 2 };
    return new Promise<MeetData>((r) => (late = r));
  });
  render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush(12_500);
  expect(screen.getByText(/^Microsoft is not answering/)).toBeTruthy();
  late({ ...data, seq: 9 });
  await flush();
  expect(screen.queryByText(/^Microsoft is not answering/)).toBeNull();
  expect(screen.getByText('Sign-in expired')).toBeTruthy();
});

