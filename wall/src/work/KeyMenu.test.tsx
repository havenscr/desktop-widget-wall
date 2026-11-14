import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetTip } from '../ui/HoverTip';
import { KeyMenu, MENU_CLOSE_MS, type KeyMenuAction } from './KeyMenu';

const actions: KeyMenuAction[] = [
  { id: 'pin', label: 'Pin to Always here' },
  { id: 'file', label: 'Edit keys file' },
];

let closed: number;
let chosen: string[];

/** A key tile with its menu, as the rows draw them. Inline callbacks on purpose. */
function Harness({ byKeyboard = false }: { byKeyboard?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="key-tile-wrap">
      <button type="button" className="key-tile">
        Tile
      </button>
      {open && (
        <KeyMenu
          title="Tile"
          actions={actions}
          byKeyboard={byKeyboard}
          onChoose={(id) => chosen.push(id)}
          onClose={() => {
            closed += 1;
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const menu = () => screen.queryByRole('menu');
const items = () => screen.getAllByRole('menuitem');

beforeEach(() => {
  vi.useFakeTimers();
  closed = 0;
  chosen = [];
});
afterEach(() => {
  resetTip();
  vi.useRealTimers();
});

it('keeps focus and its countdown when the parent re-renders', async () => {
  const { rerender } = render(<Harness />);
  expect(document.activeElement).toBe(items()[0]);
  act(() => items()[1].focus());
  await flush(4_000);
  for (let n = 0; n < 3; n++) rerender(<Harness />);
  expect(document.activeElement).toBe(items()[1]);
  // The countdown was not restarted by the re-renders: it still ends 5 seconds after it began.
  await flush(MENU_CLOSE_MS - 4_000 + 1);
  expect(menu()).toBeNull();
  expect(closed).toBe(1);
});

it('stays open while the pointer is over it, and closes 5 seconds after the pointer leaves', async () => {
  render(<Harness />);
  fireEvent.pointerEnter(menu() as HTMLElement);
  await flush(10_000);
  expect(menu()).not.toBeNull();
  fireEvent.pointerLeave(menu() as HTMLElement);
  await flush(MENU_CLOSE_MS - 1);
  expect(menu()).not.toBeNull();
  await flush(2);
  expect(menu()).toBeNull();
});

it('a pointer that comes back cancels the countdown', async () => {
  render(<Harness />);
  fireEvent.pointerLeave(menu() as HTMLElement);
  await flush(3_000);
  fireEvent.pointerEnter(menu() as HTMLElement);
  await flush(10_000);
  expect(menu()).not.toBeNull();
  fireEvent.pointerLeave(menu() as HTMLElement);
  await flush(MENU_CLOSE_MS + 1);
  expect(menu()).toBeNull();
});

it('a menu opened from the keyboard stays while focus is inside it, and counts down once focus leaves', async () => {
  render(<Harness byKeyboard />);
  expect(document.activeElement).toBe(items()[0]);
  await flush(20_000);
  expect(menu()).not.toBeNull();
  act(() => (screen.getByRole('button', { name: 'Tile' }) as HTMLElement).focus());
  await flush(MENU_CLOSE_MS - 1);
  expect(menu()).not.toBeNull();
  await flush(2);
  expect(menu()).toBeNull();
});

it('a key press inside the menu cancels the countdown while focus stays inside', async () => {
  render(<Harness />);
  await flush(3_000);
  fireEvent.keyDown(items()[0], { key: 'ArrowDown' });
  await flush(20_000);
  expect(menu()).not.toBeNull();
});

it('a press on the key, which is how a right-click begins, closes the open menu', () => {
  render(<Harness />);
  const tile = screen.getByRole('button', { name: 'Tile' });
  fireEvent.pointerDown(tile);
  expect(menu()).toBeNull();
});

it('a press elsewhere closes the menu and does not move focus back to the key', () => {
  render(<Harness />);
  fireEvent.pointerDown(document.body);
  expect(menu()).toBeNull();
  expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Tile' }));
});

it('Escape and a choice return focus to the key', () => {
  const { unmount } = render(<Harness />);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tile' }));
  unmount();
  render(<Harness />);
  fireEvent.click(items()[0]);
  expect(chosen).toEqual(['pin']);
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tile' }));
});

it('does not run its timer after it is gone', async () => {
  const { unmount } = render(<Harness />);
  unmount();
  await flush(MENU_CLOSE_MS * 2);
  expect(closed).toBe(0);
});
