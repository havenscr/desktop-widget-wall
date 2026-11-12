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

  it('the ring opens no sheet while a session runs, and Close shuts it', () => {
    render(<FocusMini />);
    fireEvent.click(screen.getByLabelText('Choose a focus length'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByLabelText('Start'));
    fireEvent.click(screen.getByLabelText('25 minutes left'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
