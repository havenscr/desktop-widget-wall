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
  expect(screen.getByText('Sign in needed')).toBeTruthy();
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
  expect(next).toHaveBeenCalledTimes(1);
  fail = true;
  await flush(5 * 60_000);
  expect(next).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Planning')).toBeTruthy();
  expect(screen.getByText(/updated \d+ min ago/)).toBeTruthy();
});

it('the countdown ticks without calling the native side', async () => {
  const next = vi.fn(() => data);
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  await flush(60_000);
  expect(next).toHaveBeenCalledTimes(1);
  expect(screen.getByText('In 2 min')).toBeTruthy();
});

it('stops polling when another place is active', async () => {
  const next = vi.fn(() => data);
  mocks.set('wall2_meet_next', next);
  render(<Meet />);
  await flush();
  expect(next).toHaveBeenCalledTimes(1);
  act(() => usePlaceStore.setState({ active: 'work' }));
  await flush(20 * 60_000);
  expect(next).toHaveBeenCalledTimes(1);
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
  expect(next).toHaveBeenCalledTimes(2);
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
    if (calls === 2) return new Promise<MeetData>((r) => (release = r));
    return data;
  });
  mocks.set('wall2_meet_next', next);
  mocks.set('wall2_meet_sign_in', () => undefined);
  render(<Meet />);
  await flush();
  expect(next).toHaveBeenCalledTimes(1);
  // The 5 minute poll starts a read that stays open; the sign-in finishes meanwhile.
  await flush(5 * 60_000);
  expect(next).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(next).toHaveBeenCalledTimes(2);
  release(data);
  await flush();
  expect(next).toHaveBeenCalledTimes(3);
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
