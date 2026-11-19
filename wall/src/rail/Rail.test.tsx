import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Rail } from './Rail';
import { usePlaceStore } from '../state/places';
import { resetWatch, useWatchStore } from '../unwind/watch/store';

beforeEach(() => usePlaceStore.setState({ active: 'work' }));

it('has seven enabled named buttons', () => {
  render(<Rail />);
  for (const name of ['Work', 'Home', 'Unwind', 'Meet', 'On air', 'Zen', 'Tools']) {
    const b = screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
  }
});

it('On air opens the On Air place and carries aria-current', () => {
  render(<Rail />);
  fireEvent.click(screen.getByRole('button', { name: 'On air' }));
  expect(usePlaceStore.getState().active).toBe('onair');
  expect(screen.getByRole('button', { name: 'On air' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: 'Work' }).getAttribute('aria-current')).toBeNull();
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

it('arrow keys go Work, Home, Unwind, Meet, On air, Shelf, Zen and wrap', () => {
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
  expect(key('Meet', 'ArrowDown')).toBe('onair');
  expect(key('On air', 'ArrowDown')).toBe('shelf');
  expect(key('Shelf', 'ArrowDown')).toBe('zen');
  expect(key('Zen', 'ArrowDown')).toBe('work');
  expect(key('Work', 'ArrowUp')).toBe('zen');
  expect(key('Zen', 'ArrowUp')).toBe('shelf');
  expect(key('Shelf', 'ArrowUp')).toBe('onair');
  expect(key('On air', 'ArrowUp')).toBe('meet');
  expect(key('Meet', 'ArrowUp')).toBe('unwind');
  expect(key('Unwind', 'ArrowUp')).toBe('home');
});

describe('the Unwind mark for a video playing away from Watch', () => {
  beforeEach(() => {
    resetWatch();
    usePlaceStore.setState({ active: 'work' });
  });
  const mark = () => document.querySelector('.rb-play');
  const unwind = () => screen.getByRole('button', { name: 'Unwind' });

  it('a YouTube video that needs a click shows as paused', () => {
    useWatchStore.setState({ playing: { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive' }, tab: 'watch' });
    useWatchStore.getState().setNeedsClick(true);
    render(<Rail />);
    expect(mark()!.className).toContain('rb-paused');
    expect(unwind().getAttribute('aria-description')).toContain('is paused');
  });

  it('a Twitch channel that needs a click does not show as paused', () => {
    useWatchStore.setState({ playing: { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' }, tab: 'watch' });
    useWatchStore.getState().setNeedsClick(true);
    render(<Rail />);
    expect(mark()!.className).not.toContain('rb-paused');
    expect(unwind().getAttribute('aria-description')).toContain('is playing');
  });

  it('a paused Twitch channel still shows as paused', () => {
    useWatchStore.setState({ playing: { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' }, tab: 'watch' });
    useWatchStore.getState().setPaused(true);
    render(<Rail />);
    expect(mark()!.className).toContain('rb-paused');
  });
});
