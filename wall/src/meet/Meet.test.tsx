import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { MEET_LEFT_PX, Meet } from './Meet';
import type { MeetData } from './model';

const NOW = Date.parse('2026-11-12T17:00:00Z');
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString().replace('.000Z', 'Z');

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
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
    { key: '1-2', accountId: 'second', title: 'Board prep', start: at(120), end: at(150), canJoin: true },
  ],
};

it('shows Not set up when meet.json is missing', async () => {
  mocks.set('wall2_meet_next', () => Promise.reject(new Error('not-configured')));
  render(<Meet />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
  expect(screen.getByText(/Meet section/)).toBeTruthy();
});

it('shows Calendar unavailable when the first read fails', async () => {
  mocks.set('wall2_meet_next', () => Promise.reject(new Error('failed')));
  render(<Meet />);
  await flush();
  expect(screen.getByText('Calendar unavailable')).toBeTruthy();
});

it('renders the next meeting, the countdown, the list and the accounts', async () => {
  mocks.set('wall2_meet_next', () => data);
  const { container } = render(<Meet />);
  await flush();
  expect(screen.getByText('Design review')).toBeTruthy();
  expect(screen.getByText('In 3 min')).toBeTruthy();
  expect(container.querySelector('.meet-count.soon')).toBeTruthy();
  expect(screen.getByText('Planning')).toBeTruthy();
  expect(screen.getByText('Board prep')).toBeTruthy();
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.getByText('Sign in again')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
});

it('shows Join only when canJoin, and sends the key only', async () => {
  const join = vi.fn();
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_join', join);
  render(<Meet />);
  await flush();
  expect(screen.getAllByRole('button', { name: /^Join/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Join: Planning' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Join: Design review' }));
  expect(join).toHaveBeenCalledTimes(1);
  expect(join).toHaveBeenCalledWith({ key: '1-0' });
});

it('signing in shows Finish in your browser and Cancel, which calls cancel', async () => {
  const cancel = vi.fn();
  let finish: () => void = () => undefined;
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_in', () => new Promise<void>((r) => (finish = r)));
  mocks.set('wall2_meet_cancel_sign_in', cancel);
  render(<Meet />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(screen.getByText('Finish in your browser')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(screen.queryByText('Finish in your browser')).toBeNull();
});

it('sign out calls the native side with the id', async () => {
  const out = vi.fn();
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_out', out);
  render(<Meet />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(out).toHaveBeenCalledWith({ id: 'work' });
});

it('reads again every 5 minutes and keeps the list after a failed read', async () => {
  let fail = false;
  const next = vi.fn(() => (fail ? Promise.reject(new Error('failed')) : data));
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  expect(reads(next)).toBe(1);
  fail = true;
  await flush(5 * 60_000);
  expect(reads(next)).toBe(2);
  expect(screen.getByText('Planning')).toBeTruthy();
  expect(screen.getByText(/updated \d+ min ago/)).toBeTruthy();
});

it('the countdown ticks without calling the native side', async () => {
  const next = vi.fn(() => data);
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  await flush(60_000);
  expect(reads(next)).toBe(1);
  expect(screen.getByText('In 2 min')).toBeTruthy();
});

it('stops polling when another place is active', async () => {
  const next = vi.fn(() => data);
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  expect(reads(next)).toBe(1);
  act(() => usePlaceStore.setState({ active: 'work' }));
  await flush(20 * 60_000);
  expect(reads(next)).toBe(1);
});

it('keeps the list and shows the updated hint when the native side marks it stale', async () => {
  let stale = false;
  mocks.set('wall2_meet_next', () => ({ ...data, stale }));
  render(<Meet />);
  await flush();
  expect(screen.queryByText(/updated \d+ min ago/)).toBeNull();
  stale = true;
  await flush(5 * 60_000);
  expect(screen.getByText('Planning')).toBeTruthy();
  expect(screen.getByText(/updated \d+ min ago/)).toBeTruthy();
});

it('Calendar unavailable offers Try again, which reads again', async () => {
  let fail = true;
  const next = vi.fn(() => (fail ? Promise.reject(new Error('failed')) : data));
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  expect(screen.getByText('Calendar unavailable')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await flush();
  expect(reads(next)).toBe(2);
  expect(screen.getByText('Design review')).toBeTruthy();
});

it('does not offer Try again when the problem is not set up', async () => {
  mocks.set('wall2_meet_next', () => Promise.reject(new Error('not-configured')));
  render(<Meet />);
  await flush();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

it('leaving Meet during a sign-in cancels it', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_cancel_sign_in', cancel);
  const { unmount } = render(<Meet />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(cancel).not.toHaveBeenCalled();
  act(() => usePlaceStore.setState({ active: 'work' }));
  await flush();
  expect(cancel).toHaveBeenCalledTimes(1);
  unmount();
});

it('unmounting during a sign-in cancels it', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_meet_cancel_sign_in', cancel);
  const { unmount } = render(<Meet />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('does not cancel when no sign-in is pending', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_cancel_sign_in', cancel);
  const { unmount } = render(<Meet />);
  await flush();
  unmount();
  expect(cancel).not.toHaveBeenCalled();
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
  render(<Meet />);
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

it('keeps its panels out of the clock area: they sit in .meet-body (CSS: left 482px, first panel edge of Work)', async () => {
  mocks.set('wall2_meet_next', () => data);
  const { container } = render(<Meet />);
  await flush(10);
  const body = container.querySelector('.meet-body')!;
  expect(body).not.toBeNull();
  for (const label of ['Next meeting', 'Later meetings', 'Accounts']) {
    expect(body.contains(screen.getByLabelText(label))).toBe(true);
  }
  expect(container.querySelectorAll('.meet > .panel')).toHaveLength(0);
  // The body starts at the Work tab's first panel edge (482 px), clear of the clock; moving it left fails here.
  expect(MEET_LEFT_PX).toBe(482);
  expect((body as HTMLElement).style.left).toBe(`${MEET_LEFT_PX}px`);
});

const unavailable: MeetData = {
  accounts: [
    { id: 'work', label: 'Work', state: 'ok' },
    { id: 'second', label: 'Second', state: 'unavailable', reason: 'graph-403-ErrorAccessDenied' },
  ],
  meetings: data.meetings.slice(0, 2),
};

it('an unavailable account shows plain words, the reason line and one action: Try again', async () => {
  mocks.set('wall2_meet_next', () => unavailable);
  render(<Meet />);
  await flush();
  expect(screen.getByText('Calendar could not be read')).toBeTruthy();
  expect(screen.getByText('Calendar refused the request (graph-403-ErrorAccessDenied)')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  // The connected account keeps Sign out; the unavailable one has only Try again.
  expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
});

it('an unavailable account with an unknown code shows no reason line', async () => {
  mocks.set('wall2_meet_next', () => ({
    ...unavailable,
    accounts: [unavailable.accounts[0], { id: 'second', label: 'Second', state: 'unavailable', reason: 'user@example.test' }],
  }));
  const { container } = render(<Meet />);
  await flush();
  expect(container.querySelector('.meet-reason')).toBeNull();
});

it('Try again on an unavailable account reads once, at once', async () => {
  const next = vi.fn(() => unavailable);
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
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
  render(<Meet />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(signIn).toHaveBeenCalledWith({ id: 'second' });
});

it('retries an unavailable read after 30 s, then 60 s, then waits for the 5 minute poll', async () => {
  const next = vi.fn(() => unavailable);
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  expect(reads(next)).toBe(1);
  await flush(29_000);
  expect(reads(next)).toBe(1);
  await flush(1_000);
  expect(reads(next)).toBe(2);
  await flush(59_000);
  expect(reads(next)).toBe(2);
  await flush(1_000);
  expect(reads(next)).toBe(3);
  // No third fast retry: nothing until the 5 minute poll (at 300 s).
  await flush(200_000);
  expect(reads(next)).toBe(3);
  await flush(10_000);
  expect(reads(next)).toBe(4);
});

it('stops the fast retries once the account recovers', async () => {
  let bad = true;
  const next = vi.fn(() => (bad ? unavailable : data));
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  bad = false;
  await flush(30_000);
  expect(reads(next)).toBe(2);
  await flush(120_000);
  expect(reads(next)).toBe(2);
});

it('does not retry while hidden', async () => {
  const next = vi.fn(() => unavailable);
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  act(() => usePlaceStore.setState({ active: 'work' }));
  await flush(120_000);
  expect(reads(next)).toBe(1);
});

it('shows one centred message with the last read time when nothing is scheduled', async () => {
  mocks.set('wall2_meet_next', () => ({
    accounts: [
      { id: 'work', label: 'Work', state: 'ok' },
      { id: 'second', label: 'Second', state: 'ok' },
    ],
    meetings: [],
  }));
  const { container } = render(<Meet />);
  await flush();
  expect(screen.getByText('Nothing scheduled in the next 24 hours')).toBeTruthy();
  expect(screen.getByText(/Last checked at \d+(:\d\d)? [AP]M/)).toBeTruthy();
  expect(container.querySelector('.meet-empty')).toBeTruthy();
  expect(screen.queryByLabelText('Later meetings')).toBeNull();
  expect(screen.getByLabelText('Accounts')).toBeTruthy();
});

it('says which account could not be read when nothing is scheduled', async () => {
  mocks.set('wall2_meet_next', () => ({ ...unavailable, meetings: [] }));
  const { container } = render(<Meet />);
  await flush();
  expect(container.querySelector('.meet-empty')).toBeTruthy();
  expect(screen.getByText('Second could not be read')).toBeTruthy();
  expect(screen.getByLabelText('Accounts')).toBeTruthy();
});

it('says Calendar not available when no account can be read', async () => {
  mocks.set('wall2_meet_next', () => ({
    accounts: [
      { id: 'work', label: 'Work', state: 'signed-out' },
      { id: 'second', label: 'Second', state: 'unavailable', reason: 'graph-503-UnknownError' },
    ],
    meetings: [],
  }));
  render(<Meet />);
  await flush();
  expect(screen.getByText('Calendar not available')).toBeTruthy();
  expect(screen.getByText('Microsoft is not answering')).toBeTruthy();
  expect(screen.getByText('Signed out')).toBeTruthy();
});

it('names a network problem and shows the time of the last try', async () => {
  mocks.set('wall2_meet_next', () => ({
    accounts: [{ id: 'work', label: 'Work', state: 'unavailable', reason: 'graph-network' }],
    meetings: [],
  }));
  render(<Meet />);
  await flush();
  expect(screen.getByText('Network problem')).toBeTruthy();
  expect(screen.getByText(/^Last try \d+(:\d\d)? [AP]M$/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

const peekOnly = (full: MeetData) => (args?: Record<string, unknown>) =>
  args?.peek ? { accounts: full.accounts.map((a) => ({ ...a, state: 'checking' })), meetings: [], seq: 1 } : undefined;

it('shows an account as soon as it answers while the other is still being asked', async () => {
  mocks.set('wall2_meet_next', (args) => {
    if (args?.peek) return peekOnly(data)(args);
    if (args?.only === 'work') return { ...data, accounts: [data.accounts[0], { ...data.accounts[1], state: 'checking' }], meetings: data.meetings.slice(0, 2), seq: 2 };
    return new Promise(() => undefined);
  });
  render(<Meet />);
  await flush();
  expect(screen.queryByText('Loading meetings')).toBeNull();
  expect(screen.getByText('Design review')).toBeTruthy();
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.getByText('Checking')).toBeTruthy();
});

it('an account that has not answered in 12 seconds shows as not answering, with Try again', async () => {
  mocks.set('wall2_meet_next', (args) => {
    if (args?.peek) return peekOnly(data)(args);
    if (args?.only === 'work') return { ...data, accounts: [data.accounts[0], { ...data.accounts[1], state: 'checking' }], meetings: data.meetings.slice(0, 2), seq: 2 };
    return new Promise(() => undefined);
  });
  render(<Meet />);
  await flush(11_000);
  expect(screen.getByText('Checking')).toBeTruthy();
  await flush(1_500);
  expect(screen.queryByText('Checking')).toBeNull();
  expect(screen.getByText('Microsoft is not answering')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  expect(screen.getByText('Design review')).toBeTruthy();
});

it('Loading meetings ends after 12 seconds even when the native side never answers', async () => {
  mocks.set('wall2_meet_next', () => new Promise(() => undefined));
  render(<Meet />);
  await flush(100);
  expect(screen.getByText('Loading meetings')).toBeTruthy();
  await flush(12_000);
  expect(screen.queryByText('Loading meetings')).toBeNull();
  expect(screen.getByText('Calendar unavailable')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

it('drops an answer that is older than one already shown', async () => {
  mocks.set('wall2_meet_next', (args) => {
    if (args?.peek) return peekOnly(data)(args);
    if (args?.only === 'work') return { ...data, meetings: data.meetings.slice(0, 1), seq: 5 };
    return { ...data, meetings: [], seq: 3 };
  });
  render(<Meet />);
  await flush();
  expect(screen.getByText('Design review')).toBeTruthy();
});

it('two quick manual Try again taps leave the 30 s retry scheduled', async () => {
  const next = vi.fn(() => unavailable);
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
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
  render(<Meet />);
  await flush();
  expect(screen.getByText('Sign-in was not accepted (token-400-65001)')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
});

it('a signed-out account with no reason shows no reason line', async () => {
  mocks.set('wall2_meet_next', () => data);
  const { container } = render(<Meet />);
  await flush();
  expect(container.querySelector('.meet-reason')).toBeNull();
});

it('a hostile reason string never reaches the page', async () => {
  const hostile = 'graph-403-https://example.test/join?x=1 someone@example.test Bearer abc.def';
  for (const state of ['unavailable', 'needs-sign-in'] as const) {
    mocks.set('wall2_meet_next', () => ({
      ...unavailable,
      accounts: [unavailable.accounts[0], { id: 'second', label: 'Second', state, reason: hostile }],
    }));
    const { container, unmount } = render(<Meet />);
    await flush();
    const text = container.textContent ?? '';
    for (const bad of ['example.test', '@', 'Bearer', 'https', 'abc.def', 'graph-403']) {
      expect(text.includes(bad), `${state}: ${bad}`).toBe(false);
    }
    expect(container.querySelector('.meet-reason')).toBeNull();
    unmount();
  }
});
