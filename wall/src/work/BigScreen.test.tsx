import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetTip } from '../ui/HoverTip';
import { BigScreen } from './BigScreen';
import { arrangedText, arrangeReason, isAbsent, UNDO_SHOW_MS, windowsText } from './deckModel';
import { LATCH_MS } from './useGuard';

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
    return { moved: 3, asked: 3 };
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

it('says how many reached their place when one did not', () => {
  expect(arrangedText({ moved: 3, asked: 3 })).toBe('3 windows arranged');
  expect(arrangedText({ moved: 1, asked: 1 })).toBe('1 window arranged');
  expect(arrangedText({ moved: 2, asked: 3 })).toBe('2 of 3 windows arranged');
  expect(arrangeReason('none moved')).toBe('No window could be moved');
});

it('shows "2 of 3 windows arranged" from the answer', async () => {
  mocks.set('wall2_arrange', () => ({ moved: 2, asked: 3 }));
  render(<BigScreen />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  expect(screen.getByText('2 of 3 windows arranged')).toBeTruthy();
});

it('a double click arranges once, even when the first call finished before the second click', async () => {
  render(<BigScreen />);
  await flush();
  const b = screen.getByRole('button', { name: 'Focus' });
  fireEvent.click(b, { detail: 1 });
  await flush();
  fireEvent.click(b, { detail: 2 });
  await flush();
  expect(calls).toHaveLength(1);
  // Two plain clicks inside the latch are one too; after it, a click works again.
  fireEvent.click(b, { detail: 1 });
  await flush();
  expect(calls).toHaveLength(1);
  await flush(LATCH_MS + 10);
  fireEvent.click(b, { detail: 1 });
  await flush();
  expect(calls).toHaveLength(2);
});

it('a double click on Undo does not undo twice, and a held Enter is ignored', async () => {
  render(<BigScreen />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Thirds' }));
  await flush();
  const undo = screen.getByText('Undo');
  expect(fireEvent.keyDown(undo, { key: 'Enter', repeat: true })).toBe(false);
  fireEvent.click(undo, { detail: 1 });
  fireEvent.click(undo, { detail: 2 });
  await flush();
  expect(calls.filter((c) => c[0] === 'undo')).toHaveLength(1);
});

it('keeps the applied layout outlined while Undo is offered', async () => {
  render(<BigScreen />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Record 16:9' }));
  await flush();
  expect(screen.getByRole('button', { name: 'Record 16:9' }).className).toContain('sel');
  expect(screen.getByRole('button', { name: 'Thirds' }).className).not.toContain('sel');
  await flush(UNDO_SHOW_MS + 100);
  expect(screen.getByRole('button', { name: 'Record 16:9' }).className).not.toContain('sel');
});
