import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LaterSwitch, resetShowLaterOverride } from './showLater';

afterEach(() => {
  vi.restoreAllMocks();
  resetShowLaterOverride();
  localStorage.clear();
});

it('when a write throws but reads work, the switch still flips and stays flipped', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  render(<LaterSwitch />);
  const sw = () => screen.getByRole('switch');
  expect(sw().getAttribute('aria-checked')).toBe('false');
  act(() => {
    fireEvent.click(sw());
  });
  expect(sw().getAttribute('aria-checked')).toBe('true');
  act(() => {
    fireEvent.click(sw());
  });
  expect(sw().getAttribute('aria-checked')).toBe('false');
});
