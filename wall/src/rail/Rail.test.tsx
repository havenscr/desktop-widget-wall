import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { Rail } from './Rail';
import { usePlaceStore } from '../state/places';

beforeEach(() => usePlaceStore.setState({ active: 'work' }));

it('has five enabled named buttons and two disabled', () => {
  render(<Rail />);
  for (const name of ['Work', 'Home', 'Unwind', 'Meet', 'Zen']) {
    const b = screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
  }
  for (const name of ['On air', 'Tools']) {
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

it('Meet opens the Meet place and carries aria-current', () => {
  render(<Rail />);
  fireEvent.click(screen.getByRole('button', { name: 'Meet' }));
  expect(usePlaceStore.getState().active).toBe('meet');
  expect(screen.getByRole('button', { name: 'Meet' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: 'Work' }).getAttribute('aria-current')).toBeNull();
});

it('Zen opens the Zen place', () => {
  render(<Rail />);
  fireEvent.click(screen.getByRole('button', { name: 'Zen' }));
  expect(usePlaceStore.getState().active).toBe('zen');
  expect(screen.getByRole('button', { name: 'Zen' }).getAttribute('aria-current')).toBe('page');
});

it('arrow keys go Work, Home, Unwind, Meet, Zen and wrap, skipping the disabled buttons', () => {
  render(<Rail />);
  const key = (name: string, k: 'ArrowDown' | 'ArrowUp') => {
    const b = screen.getByRole('button', { name });
    b.focus();
    fireEvent.keyDown(b, { key: k });
    return usePlaceStore.getState().active;
  };
  expect(key('Work', 'ArrowDown')).toBe('home');
  expect(key('Home', 'ArrowDown')).toBe('unwind');
  expect(key('Unwind', 'ArrowDown')).toBe('meet');
  expect(key('Meet', 'ArrowDown')).toBe('zen');
  expect(key('Zen', 'ArrowDown')).toBe('work');
  expect(key('Work', 'ArrowUp')).toBe('zen');
  expect(key('Zen', 'ArrowUp')).toBe('meet');
  expect(key('Meet', 'ArrowUp')).toBe('unwind');
  expect(key('Unwind', 'ArrowUp')).toBe('home');
});
