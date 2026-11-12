import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlaceStore } from '../state/places';
import { FLAMES, Flames } from './Flames';
import { Zen } from './Zen';
import zenSource from './Zen.tsx?raw';
import { Dream } from './Dream';
import { FLAME_ROTATE_MS } from './model';

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

const DAY = new Date(2026, 10, 11, 14, 0, 0).getTime();
const NIGHT = new Date(2026, 10, 11, 23, 0, 0).getTime();

/** A clock tied to the fake timers, shifted so it reads `base` at the moment of the call. */
function clockAt(base: number) {
  const offset = base - Date.now();
  return () => Date.now() + offset;
}

beforeEach(() => {
  setReducedMotion(false);
  vi.useFakeTimers();
  usePlaceStore.setState({ active: 'zen' });
});
afterEach(() => vi.useRealTimers());

it('shows the guide by day with 3, 5 and 10 minute choices', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(screen.getByText('Breathe in')).toBeTruthy();
  for (const m of ['3 min', '5 min', '10 min']) expect(screen.getByRole('radio', { name: m })).toBeTruthy();
  expect(screen.getByRole('radio', { name: '5 min' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByLabelText('Wake')).toBeNull();
});

it('the guide follows the 12 second cycle', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  act(() => void vi.advanceTimersByTime(4500));
  expect(screen.getByText('Hold')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(2000));
  expect(screen.getByText('Breathe out')).toBeTruthy();
});

it('a session counts down, then fades the guide and falls into Dream; a tap wakes', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('radio', { name: '3 min' }));
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(100));
  expect(screen.getByText('3:00 left')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(60_000));
  expect(screen.getByText('2:00 left')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(120_000 + 300));
  expect(document.querySelector('.zen-guide.ending')).not.toBeNull();
  expect(screen.queryByLabelText('Wake')).toBeNull();
  act(() => void vi.advanceTimersByTime(1300));
  expect(screen.getByLabelText('Wake')).toBeTruthy();
  expect(document.querySelector('.zen-guide')).toBeNull();
  expect(document.querySelector('.flames')!.getAttribute('data-dim')).toBe('true');
  fireEvent.click(screen.getByLabelText('Wake'));
  expect(screen.getByText(/Breathe|Hold/)).toBeTruthy();
  expect(document.querySelector('.flames')!.getAttribute('data-dim')).toBe('false');
});

it('Stop ends the session without going to Dream', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(100));
  fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
  expect(screen.getByRole('button', { name: /Start/ })).toBeTruthy();
  expect(screen.queryByLabelText('Wake')).toBeNull();
});

it('opens in Dream at night, shows Watt asleep and a small clock; a tap wakes and it stays awake', () => {
  render(<Zen nowMs={clockAt(NIGHT)} />);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
  expect(screen.getByText('PM')).toBeTruthy();
  const watt = document.querySelector<HTMLElement>('.dream-watt')!;
  expect(watt.style.left).toBe('1226px');
  expect(watt.querySelector('svg')).not.toBeNull();
  fireEvent.click(screen.getByLabelText('Wake'));
  expect(screen.getByText('Breathe in')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(120_000));
  expect(screen.queryByLabelText('Wake')).toBeNull();
});

it('Leave returns to Work', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Leave Zen' }));
  expect(usePlaceStore.getState().active).toBe('work');
});

it('flames: two layers, rotating pair with a cross-fade, dimmed to 35 percent in Dream', () => {
  const { container, rerender } = render(<Flames />);
  expect(container.querySelectorAll('.fl-pair')).toHaveLength(1);
  expect(container.querySelectorAll('.fl')).toHaveLength(2);
  expect(container.querySelector('.fl.b')).not.toBeNull();
  const bg = () => Array.from(container.querySelectorAll<HTMLElement>('.fl')).map((e) => e.style.backgroundImage.replace(/"/g, ''));
  expect(bg()).toEqual([`url(${FLAMES[0]})`, `url(${FLAMES[1]})`]);
  act(() => void vi.advanceTimersByTime(FLAME_ROTATE_MS));
  expect(container.querySelectorAll('.fl-pair')).toHaveLength(2); // old pair stays while fading
  expect(container.querySelector('.fl-pair:nth-child(2)')!.querySelector<HTMLElement>('.fl')!.style.backgroundImage).toBe(
    `url("${FLAMES[1]}")`,
  );
  act(() => void vi.advanceTimersByTime(31_000));
  expect(container.querySelectorAll('.fl-pair')).toHaveLength(1);
  expect((container.firstElementChild as HTMLElement).style.opacity).toBe('1');
  rerender(<Flames dim />);
  expect((container.firstElementChild as HTMLElement).style.opacity).toBe('0.35');
});

it('reduced motion: flames are still and change without a cross-fade', () => {
  setReducedMotion(true);
  const { container } = render(<Flames />);
  expect(container.querySelector('.flames')!.classList.contains('still')).toBe(true);
  act(() => void vi.advanceTimersByTime(FLAME_ROTATE_MS));
  expect(container.querySelectorAll('.fl-pair')).toHaveLength(1);
});

it('keeps the running state with Stop disabled while the guide fades after a session', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('radio', { name: '3 min' }));
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(180_000 + 400));
  expect(document.querySelector('.zen-guide.ending')).not.toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
  expect((screen.getByRole('button', { name: /Stop/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('0:00 left')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(1300));
  expect(screen.getByLabelText('Wake')).toBeTruthy();
});

it('falls into Dream when the clock passes 9:30 PM while Zen is open', () => {
  render(<Zen nowMs={clockAt(new Date(2026, 10, 11, 21, 29, 0).getTime())} />);
  expect(screen.queryByLabelText('Wake')).toBeNull();
  act(() => void vi.advanceTimersByTime(90_000));
  expect(screen.getByLabelText('Wake')).toBeTruthy();
});

it('a session ending just before 9:30 PM falls into Dream and stays there through the night ticks', () => {
  const base = clockAt(new Date(2026, 10, 11, 21, 26, 59, 900).getTime());
  render(<Zen nowMs={base} />);
  fireEvent.click(screen.getByRole('radio', { name: '3 min' }));
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(180_000 + 400));
  expect(document.querySelector('.zen-guide.ending')).not.toBeNull();
  act(() => void vi.advanceTimersByTime(1300));
  expect(screen.getByLabelText('Wake')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(120_000));
  expect(screen.getByLabelText('Wake')).toBeTruthy();
  expect(document.querySelector('.zen-guide')).toBeNull();
});

it('the night check effect lists ending among its dependencies', () => {
  // `ending` is only ever true while a session runs, so no timing test can tell a stale read from a
  // fresh one; the dependency list is what keeps the effect honest, so pin it in the source.
  const effect = /Night starting while Zen is open[\s\S]*?\n  \}, \[([^\]]*)\]\);/.exec(zenSource);
  expect(effect).not.toBeNull();
  const deps = effect![1].split(',').map((d) => d.trim());
  expect(deps).toEqual(expect.arrayContaining(['startedAt', 'ending', 'nowMs']));
});

it('Leave goes back to the place Zen was opened from, Work if none', () => {
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  usePlaceStore.getState().setActive('zen');
  const { unmount } = render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Leave Zen' }));
  expect(usePlaceStore.getState().active).toBe('unwind');
  unmount();
  usePlaceStore.setState({ active: 'zen', from: 'work' });
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Leave Zen' }));
  expect(usePlaceStore.getState().active).toBe('work');
});

it('moves focus into Zen and arrow keys there do not change the place', () => {
  render(
    <>
      <button type="button">rail</button>
      <Zen nowMs={clockAt(DAY)} />
    </>,
  );
  const focused = document.activeElement as HTMLElement;
  expect(focused.closest('.zen')).not.toBeNull();
  fireEvent.keyDown(focused, { key: 'ArrowDown' });
  expect(usePlaceStore.getState().active).toBe('zen');
});

it('Dream: Space wakes and the key press is default-prevented', () => {
  const onWake = vi.fn();
  render(<Dream onWake={onWake} />);
  const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  act(() => void screen.getByLabelText('Wake').dispatchEvent(ev));
  expect(ev.defaultPrevented).toBe(true);
  expect(onWake).toHaveBeenCalledTimes(1);
});
