import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlaceStore } from '../state/places';
import { FLAMES, Flames } from './Flames';
import { Zen } from './Zen';
import zenSource from './Zen.tsx?raw';
import { Dream } from './Dream';
import { mocks } from '../bridge/tauri';
import {
  FLAME_ROTATE_MS,
  LONGEST_WORD,
  NUM_FONT_PX,
  RING_BASE_PX,
  RING_PAD_PX,
  SCALE_MIN,
  WORD_FONT_PX,
  minRingDiameter,
  sessionLabel,
  waitingLines,
} from './model';

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
  expect(screen.getByText('3:00 left.')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(60_000));
  expect(screen.getByText('2:00 left.')).toBeTruthy();
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

it('a tap anywhere ends the session without going to Dream', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(100));
  expect(screen.getByText('Touch anywhere to end early')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'End session early' }));
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

it('keeps the running state with the tap target off while the guide fades after a session', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('radio', { name: '3 min' }));
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(180_000 + 400));
  expect(document.querySelector('.zen-guide.ending')).not.toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'End session early' })).toBeNull();
  expect(screen.getByText('0:00 left.')).toBeTruthy();
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
  const effect = /setDream\(true\);\s*\}, NIGHT_CHECK_MS\);[\s\S]*?\}, \[([^\]]*)\]\);/.exec(zenSource);
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

it('the smallest ring fits the longest word with 24 px to spare, and the words use the constant sizes', () => {
  expect(RING_PAD_PX).toBeGreaterThanOrEqual(24);
  expect(RING_BASE_PX * SCALE_MIN).toBeGreaterThanOrEqual(minRingDiameter());
  expect(LONGEST_WORD).toBe('Breathe out');
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  expect((container.querySelector('.breath-word') as HTMLElement).style.fontSize).toBe(`${WORD_FONT_PX}px`);
  expect((container.querySelector('.breath-num') as HTMLElement).style.fontSize).toBe(`${NUM_FONT_PX}px`);
});

it('the words do not scale with the ring; the ring, glow and a fixed guide ring are drawn', () => {
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  expect(container.querySelector('.breath-guide')).not.toBeNull();
  expect(container.querySelector('.breath-circle .breath-glow')).not.toBeNull();
  expect(container.querySelector('.breath-circle')!.contains(container.querySelector('.breath-words'))).toBe(false);
});

it('lays out the concept: clock, picker at bottom left before a session, label and time left during one', () => {
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  expect(container.querySelector('.zen-clock .clk')).not.toBeNull();
  expect(container.querySelector('.zen-bl .breath-picker')).not.toBeNull();
  expect(screen.queryByText('Touch anywhere to end early')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(100));
  expect(screen.getByText('FIVE MINUTES OF ZEN')).toBeTruthy();
  expect(container.querySelector('.zen-bl .zen-left')!.textContent).toBe('5:00 left.');
  expect(container.querySelector('.zen-veil')).not.toBeNull();
  expect(sessionLabel(3)).toBe('THREE MINUTES OF ZEN');
  expect(sessionLabel(10)).toBe('TEN MINUTES OF ZEN');
});

it('Leave still works while a session runs', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Leave Zen' }));
  expect(usePlaceStore.getState().active).toBe('work');
});

it('waitingLines: count, urgency only when the data says so, nothing when empty', () => {
  expect(waitingLines([])).toBeNull();
  const q = (...x: (string | null)[]) => x.map((quadrant) => ({ quadrant }));
  expect(waitingLines(q(null, null))).toEqual({ count: 'After this: 2 things are waiting.', urgent: null });
  expect(waitingLines(q('feature', 'neither'))?.urgent).toBe('Neither is urgent.');
  expect(waitingLines(q('feature', 'neither', 'feature'))?.urgent).toBe('None is urgent.');
  expect(waitingLines(q('feature', 'hotfix'))?.urgent).toBeNull();
  expect(waitingLines(q('feature', null))?.urgent).toBeNull();
  expect(waitingLines(q('feature'))).toEqual({ count: 'After this: 1 thing is waiting.', urgent: 'It is not urgent.' });
});

it('shows the open task count from the task feed, hides it when not set up', async () => {
  mocks.set('wall2_tasks_next', () => [
    { id: 'a', title: 'A', due_at: null, due_is_all_day: false, quadrant: 'feature' },
    { id: 'b', title: 'B', due_at: null, due_is_all_day: false, quadrant: 'neither' },
  ]);
  const first = render(<Zen nowMs={clockAt(DAY)} />);
  await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
  expect(screen.getByText('After this: 2 things are waiting.')).toBeTruthy();
  expect(screen.getByText('Neither is urgent.')).toBeTruthy();
  first.unmount();
  mocks.set('wall2_tasks_next', () => {
    throw new Error('not-configured');
  });
  render(<Zen nowMs={clockAt(DAY)} />);
  await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
  expect(document.querySelector('.zen-waiting')).toBeNull();
  mocks.clear();
});

it('the veil leaves the flames at about 45 percent of today and lifts in Dream', () => {
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  expect(Number((container.querySelector('.zen-veil') as HTMLElement).style.opacity)).toBeCloseTo(0.55, 2);
  cleanup();
  const night = render(<Zen nowMs={clockAt(NIGHT)} />);
  expect((night.container.querySelector('.zen-veil') as HTMLElement).style.opacity).toBe('0');
});
