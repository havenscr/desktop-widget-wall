import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { FocusMini, FocusTimer } from './FocusTimer';
import { FOCUS_KEY } from './model';
import { useFocusStore } from './store';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  useFocusStore.getState().dispose();
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0, 0));
  mocks.set('get_do_not_disturb', () => false);
  mocks.set('enable_do_not_disturb', () => undefined);
  mocks.set('disable_do_not_disturb', () => undefined);
});
afterEach(() => {
  useFocusStore.getState().dispose();
  vi.useRealTimers();
  mocks.clear();
});

it('starts, counts down, pauses and resets', async () => {
  render(<FocusTimer />);
  fireEvent.click(screen.getByText('Start'));
  await flush(1000);
  expect(screen.getByRole('img', { name: '25 minutes left' })).toBeTruthy();
  await flush(5 * 60_000);
  expect(screen.getByRole('img', { name: '20 minutes left' })).toBeTruthy();
  fireEvent.click(screen.getByText('Pause'));
  await flush(10 * 60_000);
  expect(screen.getByText('Resume')).toBeTruthy();
  expect(screen.getByRole('img', { name: '20 minutes left' })).toBeTruthy();
  fireEvent.click(screen.getByText('Reset'));
  expect(screen.getByText('Ready to focus')).toBeTruthy();
});

it('shows finished with a glow when the end time passes', async () => {
  const { container } = render(<FocusTimer />);
  fireEvent.click(screen.getByText('Start'));
  await flush(25 * 60_000 + 2000);
  expect(screen.getByText('Focus done')).toBeTruthy();
  expect(container.querySelector('.ring.glow')).toBeTruthy();
});

it('resumes a stored running timer and shows finished for an old one', () => {
  localStorage.setItem(FOCUS_KEY, JSON.stringify({ status: 'running', minutes: 50, endAt: Date.now() + 30 * 60_000 }));
  render(<FocusTimer />);
  expect(screen.getByRole('img', { name: '30 minutes left' })).toBeTruthy();
  cleanup();
  useFocusStore.getState().dispose();
  localStorage.setItem(FOCUS_KEY, JSON.stringify({ status: 'running', minutes: 50, endAt: Date.now() - 1000 }));
  render(<FocusTimer />);
  expect(screen.getByText('Focus done')).toBeTruthy();
});

it('custom length moves in steps of 5 within 5 to 120', () => {
  render(<FocusTimer />);
  fireEvent.click(screen.getByText('Custom'));
  fireEvent.click(screen.getByLabelText('More minutes'));
  expect(screen.getByText('30 min')).toBeTruthy();
  for (let i = 0; i < 30; i++) fireEvent.click(screen.getByLabelText('More minutes'));
  expect(screen.getByText('120 min')).toBeTruthy();
  for (let i = 0; i < 40; i++) fireEvent.click(screen.getByLabelText('Fewer minutes'));
  expect(screen.getByText('5 min')).toBeTruthy();
});

describe('FocusMini (the Work row)', () => {
  it('starts from the round button, counts down in the ring, pauses and resumes', async () => {
    render(<FocusMini />);
    expect(screen.getByText('Ready to focus')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Start'));
    await flush(5 * 60_000);
    expect(screen.getByRole('img', { name: '20 minutes left' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(screen.getByText('Focus, paused')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Resume'));
    expect(useFocusStore.getState().state.status).toBe('running');
  });

  it('shows the task label of a session started from a task', () => {
    useFocusStore.getState().startLabeled('RFQ response');
    render(<FocusMini />);
    expect(screen.getByText('RFQ response')).toBeTruthy();
    expect(screen.getByRole('img', { name: '25 minutes left' })).toBeTruthy();
  });

  it('tapping the ring opens the sheet with 25, 50 and Custom, and Start uses the choice', () => {
    render(<FocusMini />);
    fireEvent.click(screen.getByLabelText('Choose a focus length'));
    const sheet = screen.getByRole('dialog', { name: 'Focus length' });
    expect(sheet.textContent).toContain('Custom');
    fireEvent.click(screen.getByText('50'));
    fireEvent.click(screen.getByText('Start 50 min'));
    expect(screen.queryByRole('dialog')).toBeNull();
    const s = useFocusStore.getState().state;
    expect(s.status).toBe('running');
    expect(s.minutes).toBe(50);
  });

  it('Close shuts the length sheet at once (no longer a dialog) and it leaves after the fade', async () => {
    render(<FocusMini />);
    fireEvent.click(screen.getByLabelText('Choose a focus length'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await flush(300);
    expect(document.querySelector('.focus-sheet')).toBeNull();
  });

  it('while a session runs the ring opens the controls sheet with a header, time left and three buttons', async () => {
    useFocusStore.getState().startLabeled('Review the draft');
    render(<FocusMini />);
    const ring = screen.getByLabelText('Focus controls, 25 min left');
    expect(ring.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(ring);
    expect(ring.getAttribute('aria-expanded')).toBe('true');
    const sheet = screen.getByRole('dialog', { name: 'Focus controls' });
    expect(sheet.textContent).toContain('Focus, 25 min left');
    expect(sheet.textContent).toContain('5 minutes a tap');
    expect(sheet.textContent).toContain('Pause');
    expect(sheet.textContent).toContain('Restart 25 min');
    expect(sheet.textContent).toContain('Stop');
    fireEvent.click(screen.getByLabelText('5 minutes less'));
    expect(sheet.textContent).toContain('Focus, 20 min left');
    expect(useFocusStore.getState().state.minutes).toBe(25);
    fireEvent.click(screen.getByText('Pause'));
    expect(screen.getByRole('dialog').textContent).toContain('Focus, paused, 20 min left');
    expect(screen.getByText('Resume')).toBeTruthy();
  });

  it('Stop ends the session, closes the sheet and offers Undo until it lapses', async () => {
    useFocusStore.getState().startLabeled('Review the draft');
    render(<FocusMini />);
    await flush(60_000);
    fireEvent.click(screen.getByLabelText('Focus controls, 24 min left'));
    fireEvent.click(screen.getByText('Stop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useFocusStore.getState().state.status).toBe('idle');
    expect(useFocusStore.getState().state.minutes).toBe(25);
    expect(screen.getByText('Focus stopped')).toBeTruthy();
    await flush(5900);
    expect(screen.getByText('Undo')).toBeTruthy();
    await flush(400);
    expect(screen.queryByText('Undo')).toBeNull();
    expect(screen.getByText('Ready to focus')).toBeTruthy();
  });

  it('Undo after Stop puts the running session back as if it never stopped', async () => {
    useFocusStore.getState().startLabeled('Review the draft');
    render(<FocusMini />);
    const before = useFocusStore.getState().state;
    fireEvent.click(screen.getByLabelText('Focus controls, 25 min left'));
    fireEvent.click(screen.getByText('Stop'));
    await flush(3000);
    fireEvent.click(screen.getByText('Undo'));
    expect(useFocusStore.getState().state).toEqual(before);
    expect(screen.getByText('Review the draft')).toBeTruthy();
  });

  it('Restart shows Restarted and Undo brings back the old session', async () => {
    useFocusStore.getState().startLabeled('Review the draft');
    useFocusStore.getState().adjustLeft(-1);
    render(<FocusMini />);
    const before = useFocusStore.getState().state;
    fireEvent.click(screen.getByLabelText('Focus controls, 20 min left'));
    fireEvent.click(screen.getByText('Restart 25 min'));
    expect(screen.getByText('Restarted')).toBeTruthy();
    expect(minutesLeftNow()).toBe(25);
    fireEvent.click(screen.getByText('Undo'));
    expect(useFocusStore.getState().state).toEqual(before);
  });

  it('Escape closes the sheet and returns focus to the ring; a press outside closes it too', async () => {
    useFocusStore.getState().startLabeled('x');
    render(
      <div>
        <FocusMini />
        <button type="button">elsewhere</button>
      </div>,
    );
    const ring = screen.getByLabelText('Focus controls, 25 min left');
    fireEvent.click(ring);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(ring);
    fireEvent.click(ring);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

function minutesLeftNow() {
  const s = useFocusStore.getState().state;
  return s.status === 'running' ? Math.ceil((s.endAt - Date.now()) / 60_000) : -1;
}

it('FocusMini closes the length sheet when a session starts elsewhere', () => {
  render(<FocusMini />);
  fireEvent.click(screen.getByLabelText('Choose a focus length'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => useFocusStore.getState().startLabeled('From a task'));
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => useFocusStore.getState().reset());
  expect(screen.queryByRole('dialog')).toBeNull();
});
