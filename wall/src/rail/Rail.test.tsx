import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { Rail } from './Rail';
import { usePlaceStore } from '../state/places';

beforeEach(() => usePlaceStore.setState({ active: 'work' }));

it('has three enabled named buttons', () => {
  render(<Rail />);
  for (const name of ['Work', 'Home', 'Unwind']) {
    const b = screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
  }
  for (const name of ['Meet', 'On air', 'Zen', 'Tools']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
});

it('aria-current follows the store', () => {
  render(<Rail />);
  expect(screen.getByRole('button', { name: 'Work' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  expect(usePlaceStore.getState().active).toBe('home');
  expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: 'Work' }).getAttribute('aria-current')).toBeNull();
});

it('arrow keys move between enabled places', () => {
  render(<Rail />);
  const work = screen.getByRole('button', { name: 'Work' });
  work.focus();
  fireEvent.keyDown(work, { key: 'ArrowDown' });
  expect(usePlaceStore.getState().active).toBe('home');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Home' }), { key: 'ArrowDown' });
  expect(usePlaceStore.getState().active).toBe('unwind');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Unwind' }), { key: 'ArrowUp' });
  expect(usePlaceStore.getState().active).toBe('home');
});
