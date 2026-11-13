import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetTip } from '../ui/HoverTip';
import { BigScreen } from './BigScreen';
import { arrangeReason, isAbsent, UNDO_SHOW_MS, windowsText } from './deckModel';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
let calls: [string, unknown][];
beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  mocks.set('wall2_arrange_status', () => true);
  mocks.set('wall2_arrange', (args) => {
    calls.push(['arrange', args]);
    return 3;
  });
  mocks.set('wall2_arrange_undo', () => {
    calls.push(['undo', undefined]);
    return 2;
  });
});
afterEach(() => {
  resetTip();
  vi.useRealTimers();
  mocks.clear();
});

it('runs a layout on a click, says how many moved, and offers Undo for a minute', async () => {
  render(<BigScreen />);
  await flush();
  expect(screen.queryByText('Undo')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Record 16:9' }));
  await flush();
  expect(calls).toEqual([['arrange', { layout: 'record' }]]);
  expect(screen.getByText('3 windows arranged')).toBeTruthy();
  fireEvent.click(screen.getByText('Undo'));
  await flush();
  expect(screen.getByText('2 windows put back')).toBeTruthy();
  expect(screen.queryByText('Undo')).toBeNull();
});

it('hides Undo after 60 seconds', async () => {
  render(<BigScreen />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  expect(screen.getByText('Undo')).toBeTruthy();
  await flush(UNDO_SHOW_MS + 100);
  expect(screen.queryByText('Undo')).toBeNull();
});

it('disables the buttons with a reason when the wall is the only monitor', async () => {
  mocks.set('wall2_arrange_status', () => false);
  render(<BigScreen />);
  await flush();
  const b = screen.getByRole('button', { name: 'Focus' });
  expect(b.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(b);
  await flush();
  expect(calls).toEqual([]);
});

it('shows a fixed line for a refusal', async () => {
  mocks.set('wall2_arrange', () => {
    throw 'no windows';
  });
  render(<BigScreen />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
  await flush();
  expect(screen.getByText('No windows to arrange on the big screen')).toBeTruthy();
  expect(screen.queryByText('Undo')).toBeNull();
});

it('is not drawn where the commands are missing', async () => {
  mocks.set('wall2_arrange_status', () => {
    throw 'unsupported';
  });
  const { container } = render(<BigScreen />);
  await flush();
  expect(container.textContent).toBe('');
});

it('words', () => {
  expect(windowsText(1, 'arranged')).toBe('1 window arranged');
  expect(windowsText(3, 'arranged')).toBe('3 windows arranged');
  expect(arrangeReason('no big screen')).toBe('No big screen found');
  expect(arrangeReason('x')).toBe('Could not arrange the windows');
  expect(isAbsent('unsupported')).toBe(true);
  expect(isAbsent(new Error('No mock registered for command "x"'))).toBe(true);
  expect(isAbsent('busy')).toBe(false);
});
