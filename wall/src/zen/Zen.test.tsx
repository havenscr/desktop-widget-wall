import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlaceStore } from '../state/places';
import { FLAMES, Flames } from './Flames';
import { Zen } from './Zen';
import zenSource from './Zen.tsx?raw';
import { Dream } from './Dream';
import { mocks } from '../bridge/tauri';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { usePacificTime } from '../ribbon/testZone';
import { LAST_MOOD_AT_KEY } from '../unwind/RoomCard';
import { LAST_MOOD_KEY, MOODS_CACHE_KEY } from '../home/Moods';
import {
  FLAME_ROTATE_MS,
  LONGEST_WORD,
  NUM_FONT_PX,
  RING_BASE_PX,
  RING_PAD_PX,
  SCALE_MIN,
  WORD_FONT_PX,
  longestWordWidth,
  minRingDiameter,
  dreamStatusText,
  sessionLabel,
  waitingLines,
} from './model';

usePacificTime();

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
  usePlaceStore.setState({ active: 'zen', zenDream: false });
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
  expect(screen.getByText('Click anywhere to end early')).toBeTruthy();
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

it('the smallest ring fits the longest word with 40 px to spare, and the words use the constant sizes', () => {
  expect(RING_PAD_PX).toBeGreaterThanOrEqual(40);
  expect((RING_BASE_PX * SCALE_MIN - longestWordWidth()) / 2).toBeGreaterThanOrEqual(40);
  expect(RING_BASE_PX * SCALE_MIN).toBeGreaterThanOrEqual(minRingDiameter());
  expect(LONGEST_WORD).toBe('Breathe out');
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  expect((container.querySelector('.breath-word') as HTMLElement).style.fontSize).toBe(`${WORD_FONT_PX}px`);
  expect((container.querySelector('.breath-num') as HTMLElement).style.fontSize).toBe(`${NUM_FONT_PX}px`);
});

it('the glow is a sibling of the masked ring, not inside it, and both get the same scale', () => {
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  const ring = container.querySelector('.breath-circle') as HTMLElement;
  const glow = container.querySelector('.breath-glow') as HTMLElement;
  expect(ring.contains(glow)).toBe(false);
  expect(glow.parentElement).toBe(ring.parentElement);
  expect(glow.style.transform).toBe(ring.style.transform);
});

it('reduced motion: no frame loop, a steady ring, and the word still updates', () => {
  setReducedMotion(true);
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  const ring = container.querySelector('.breath-circle') as HTMLElement;
  const steady = ring.style.transform;
  expect(steady).toMatch(/^scale\(/);
  act(() => void vi.advanceTimersByTime(5000));
  expect(ring.style.transform).toBe(steady);
  expect(container.querySelector('.breath-word')!.textContent).toBe('Hold');
  expect(raf).not.toHaveBeenCalled();
  raf.mockRestore();
});

it('focus moves to the tap target when a session starts and back to Start when it ends', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(100));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End session early' }));
  fireEvent.click(screen.getByRole('button', { name: 'End session early' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Start/ }));
});

it('the words do not scale with the ring; the ring, glow and a fixed guide ring are drawn', () => {
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  expect(container.querySelector('.breath-guide')).not.toBeNull();
  expect(container.querySelector('.breath-ring > .breath-glow')).not.toBeNull();
  expect(container.querySelector('.breath-circle')!.contains(container.querySelector('.breath-words'))).toBe(false);
});

it('lays out the concept: clock, picker at bottom left before a session, label and time left during one', () => {
  const { container } = render(<Zen nowMs={clockAt(DAY)} />);
  expect(container.querySelector('.zen-clock .clk')).not.toBeNull();
  expect(container.querySelector('.zen-bl .breath-picker')).not.toBeNull();
  expect(screen.queryByText('Click anywhere to end early')).toBeNull();
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

it('waitingLines: exact count and urgency below the feed limit, "or more" and no urgency at the limit', () => {
  expect(waitingLines([])).toBeNull();
  const q = (...x: (string | null)[]) => x.map((quadrant) => ({ quadrant }));
  expect(waitingLines(q(null, null))).toEqual({ count: 'After this: 2 things are waiting.', urgent: null });
  expect(waitingLines(q('feature', 'neither'))?.urgent).toBe('Neither is urgent.');
  expect(waitingLines(q('feature', 'hotfix'))?.urgent).toBeNull();
  expect(waitingLines(q('feature', null))?.urgent).toBeNull();
  expect(waitingLines(q('feature'))).toEqual({ count: 'After this: 1 thing is waiting.', urgent: 'It is not urgent.' });
  expect(waitingLines(q('feature', 'neither', 'feature'))).toEqual({ count: 'After this: 3 or more things are waiting.', urgent: null });
  expect(waitingLines(q('hotfix', 'admin', 'feature'))?.urgent).toBeNull();
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
  const t = (id: string) => ({ id, title: id, due_at: null, due_is_all_day: false, quadrant: 'feature' });
  mocks.set('wall2_tasks_next', () => [t('a'), t('b'), t('c')]);
  const three = render(<Zen nowMs={clockAt(DAY)} />);
  await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
  expect(screen.getByText('After this: 3 or more things are waiting.')).toBeTruthy();
  expect(screen.queryByText(/urgent/)).toBeNull();
  three.unmount();
  mocks.set('wall2_tasks_next', () => []);
  const none = render(<Zen nowMs={clockAt(DAY)} />);
  await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
  expect(document.querySelector('.zen-waiting')).toBeNull();
  none.unmount();
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

it("opens straight into Dream by day from Unwind's Dream tab, once", () => {
  usePlaceStore.setState({ active: 'unwind', from: 'work', zenDream: false });
  usePlaceStore.getState().openDream();
  const r = render(<Zen nowMs={clockAt(DAY)} />);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
  expect(usePlaceStore.getState().zenDream).toBe(false);
  r.unmount();
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(screen.queryByLabelText('Wake')).toBeNull();
});

const flushAsync = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

it('Dream: the hint says what really wakes it, at 13 px, and the date sits under the clock', () => {
  vi.setSystemTime(new Date(2026, 10, 11, 23, 48));
  const { container } = render(<Dream onWake={() => undefined} />);
  expect(screen.getByText('Move the mouse or click to wake')).toBeTruthy();
  expect(screen.queryByText(/Touch anywhere/)).toBeNull();
  expect(container.querySelector('.dream-date')!.textContent).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}$/);
  expect(container.querySelector('.dream-clock')!.textContent).toBe('11:48PM');
});

it('Dream: a mouse move wakes it only after the grace time and by more than a few pixels; jitter does not', () => {
  const onWake = vi.fn();
  render(<Dream onWake={onWake} />);
  const w = screen.getByLabelText('Wake');
  fireEvent.mouseMove(w, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(w, { clientX: 400, clientY: 10 });
  expect(onWake).not.toHaveBeenCalled();
  act(() => void vi.advanceTimersByTime(2000));
  fireEvent.mouseMove(w, { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(w, { clientX: 103, clientY: 101 });
  expect(onWake).not.toHaveBeenCalled();
  fireEvent.mouseMove(w, { clientX: 300, clientY: 100 });
  expect(onWake).toHaveBeenCalledTimes(1);
});

it('dreamStatusText says only what is known', () => {
  expect(dreamStatusText(null, null, null)).toBe('');
  expect(dreamStatusText(2, 0, null)).toBe('2 agents still working · No agent needs you');
  expect(dreamStatusText(0, 1, 'Late Night')).toBe('An agent needs you · Lights: Late Night');
  expect(dreamStatusText(1, 3, null)).toBe('1 agent still working · 3 agents need you');
  expect(dreamStatusText(null, null, 'Evening')).toBe('Lights: Evening');
});

it('Dream status: agents from a fresh store, nothing when the store is off or stale, the mood only when this wall set one', async () => {
  vi.setSystemTime(new Date(2026, 10, 11, 23, 48));
  resetAgents();
  localStorage.clear();
  mocks.set('wall2_omni_summary', () => summary({ lanes: [lane({ id: 'a', state: 'working' }), lane({ id: 'b', state: 'working' })] }));
  mocks.set('wall2_meet_day', () => ({ events: [] }));
  localStorage.setItem(LAST_MOOD_KEY, 'lateNight');
  localStorage.setItem(LAST_MOOD_AT_KEY, JSON.stringify({ id: 'lateNight', at: Date.now() - 60_000 }));
  localStorage.setItem(MOODS_CACHE_KEY, JSON.stringify([{ id: 'lateNight', label: 'Late Night' }]));
  const r = render(<Dream onWake={() => undefined} />);
  await flushAsync();
  expect(document.querySelector('.dream-status')!.textContent).toBe('2 agents still working · No agent needs you · Lights: Late Night');
  r.unmount();
  // The helper is not set up: no agent words; no mood mark: no lights words.
  resetAgents();
  localStorage.clear();
  mocks.set('wall2_omni_summary', () => Promise.reject(new Error('not-configured')));
  render(<Dream onWake={() => undefined} />);
  await flushAsync();
  expect(document.querySelector('.dream-status')).toBeNull();
  resetAgents();
  mocks.clear();
});

it('Dream: the Tomorrow card shows the first meeting, says so when the calendar cannot be read, and is absent on a clear day', async () => {
  const now = () => new Date('2026-11-11T21:42:00-08:00');
  mocks.set('wall2_omni_summary', () => Promise.reject(new Error('not-configured')));
  mocks.set('wall2_meet_day', () => ({ events: [{ key: 'b', title: 'AE sync', start: '2026-11-12T17:00:00Z', end: '2026-11-12T17:30:00Z' }] }));
  const a = render(<Dream onWake={() => undefined} now={now} />);
  await flushAsync();
  expect(document.querySelector('.dream-card')!.textContent).toBe('Tomorrow9:00, AE sync');
  a.unmount();
  mocks.set('wall2_meet_day', () => ({ events: [], accounts: [{ state: 'signed-out' }] }));
  const b = render(<Dream onWake={() => undefined} now={now} />);
  await flushAsync();
  expect(document.querySelector('.dream-card')!.textContent).toBe('TomorrowCalendar not available');
  b.unmount();
  mocks.set('wall2_meet_day', () => ({ events: [] }));
  render(<Dream onWake={() => undefined} now={now} />);
  await flushAsync();
  expect(document.querySelector('.dream-card')).toBeNull();
  resetAgents();
  mocks.clear();
});

it('the chosen session length is the one filled chip', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  fireEvent.click(screen.getByRole('radio', { name: '10 min' }));
  const on = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
  expect(on.map((r) => r.textContent)).toEqual(['10 min']);
});
