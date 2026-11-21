import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlaceStore } from '../state/places';
import { SETTINGS_KEY } from '../settings/settings';
import { FLAMES, Flames, flameLoop } from './Flames';
import { Zen } from './Zen';
import zenSource from './Zen.tsx?raw';
import activitiesSource from './Activities.tsx?raw';
// @ts-ignore node's own file call; this test reads the stylesheet as text.
import { readFileSync } from 'node:fs';
import { Dream } from './Dream';

// These tests step fake timers through whole quiet stretches (a ten second check each step), which is
// slow on a busy runner: give them room so a slow machine cannot fail them.
vi.setConfig({ testTimeout: 20_000 });
import { mocks } from '../bridge/tauri';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { usePacificTime } from '../ribbon/testZone';
import { LAST_MOOD_AT_KEY } from '../unwind/RoomCard';
import { LAST_MOOD_KEY, MOODS_CACHE_KEY } from '../home/Moods';
import {
  ACTIVITY_KEY,
  BODY_STEPS,
  CANDLE_LINE,
  CANDLE_LINE_MS,
  FLAME_ROTATE_MS,
  INTENTION_KEY,
  LONGEST_WORD,
  ZEN_VEIL,
  ZEN_VEIL_CANDLE,
  dayKey,
  NUM_FONT_PX,
  RING_BASE_PX,
  RING_PAD_PX,
  SCALE_MIN,
  WORD_FONT_PX,
  longestWordWidth,
  minRingDiameter,
  dreamStatusParts,
  dreamStatusText,
  driftOffset,
  DRIFT_PERIOD_MS,
  DRIFT_STEP_MS,
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
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(ACTIVITY_KEY);
  localStorage.removeItem(INTENTION_KEY);
  play.mockClear();
  pause.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

// jsdom has no media playback: stand in for play and pause.
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
HTMLMediaElement.prototype.play = play;
HTMLMediaElement.prototype.pause = pause;
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

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
  expect(document.querySelector('.breath-word')!.textContent).toMatch(/Breathe|Hold/);
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

it('opens bright at night; after ten quiet minutes it dims, shows Watt asleep and a small clock; a click wakes and it stays awake', async () => {
  render(<Zen nowMs={clockAt(NIGHT)} />);
  expect(screen.queryByLabelText('Wake')).toBeNull();
  await quiet(10.2);
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

it('flames: a muted looping video under the veil, dimmed to 35 percent in Dream', () => {
  const { container, rerender } = render(<Flames />);
  const v = container.querySelector('video')!;
  expect(v.getAttribute('src')).toBe(flameLoop);
  expect(v.loop).toBe(true);
  expect(v.muted).toBe(true);
  expect(v.hasAttribute('playsinline')).toBe(true);
  expect(container.querySelector('.fl-pair')).toBeNull();
  expect((container.firstElementChild as HTMLElement).style.opacity).toBe('1');
  rerender(<Flames dim />);
  expect((container.firstElementChild as HTMLElement).style.opacity).toBe('0.35');
});

it('flames: the video is paused while the page is hidden and plays again after', () => {
  const { container } = render(<Flames />);
  expect(play).toHaveBeenCalled();
  pause.mockClear();
  act(() => {
    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(pause).toHaveBeenCalled();
  play.mockClear();
  act(() => {
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(play).toHaveBeenCalled();
  expect(container.querySelector('video')).not.toBeNull();
});

it('reduced motion: the still flame, no video element', () => {
  setReducedMotion(true);
  const { container } = render(<Flames />);
  expect(container.querySelector('.flames')!.classList.contains('still')).toBe(true);
  expect(container.querySelector('video')).toBeNull();
  expect(container.querySelector<HTMLElement>('.fl-still')!.style.backgroundImage).toContain(FLAMES[0]);
});

it('flames: a video that errors falls back to the drifting still layers, which still rotate', () => {
  const { container } = render(<Flames />);
  act(() => void fireEvent.error(container.querySelector('video')!));
  expect(container.querySelector('video')).toBeNull();
  expect(container.querySelectorAll('.fl-pair')).toHaveLength(1);
  expect(container.querySelectorAll('.fl')).toHaveLength(2);
  act(() => void vi.advanceTimersByTime(FLAME_ROTATE_MS));
  expect(container.querySelectorAll('.fl-pair')).toHaveLength(2);
  act(() => void vi.advanceTimersByTime(31_000));
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

const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m, 0).getTime();
const quiet = (min: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(min * 60_000);
  });

it('9:59 PM with fifteen quiet minutes stays bright', async () => {
  render(<Zen nowMs={clockAt(at(21, 44))} />);
  await quiet(15);
  expect(screen.queryByLabelText('Wake')).toBeNull();
});

it('10:05 PM after ten quiet minutes dims', async () => {
  render(<Zen nowMs={clockAt(at(21, 55))} />);
  await quiet(9);
  expect(screen.queryByLabelText('Wake')).toBeNull();
  await quiet(2);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
});

it('input at nine minutes restarts the ten minutes', async () => {
  render(<Zen nowMs={clockAt(at(22, 30))} />);
  await quiet(9);
  fireEvent.pointerMove(window);
  await quiet(9);
  expect(screen.queryByLabelText('Wake')).toBeNull();
  await quiet(2);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
});

it('wheel and key presses on the wall count as input too', async () => {
  render(<Zen nowMs={clockAt(at(22, 30))} />);
  await quiet(9);
  fireEvent.wheel(window);
  await quiet(9);
  fireEvent.keyDown(window, { key: 'a' });
  await quiet(9);
  expect(screen.queryByLabelText('Wake')).toBeNull();
});

it('a click wakes it and the next dim needs another ten quiet minutes', async () => {
  render(<Zen nowMs={clockAt(at(23, 0))} />);
  await quiet(11);
  fireEvent.click(screen.getByLabelText('Wake'));
  expect(screen.queryByLabelText('Wake')).toBeNull();
  await quiet(9);
  expect(screen.queryByLabelText('Wake')).toBeNull();
  await quiet(2);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
});

it('6:01 AM never dims by itself', async () => {
  render(<Zen nowMs={clockAt(at(6, 1))} />);
  // Twelve quiet minutes pass the ten minute wait; a longer span only made this test slow enough to time out.
  await quiet(12);
  expect(screen.queryByLabelText('Wake')).toBeNull();
});

it('the small hours dim, like the late evening', async () => {
  render(<Zen nowMs={clockAt(at(3, 0))} />);
  await quiet(11);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
});

it('a saved hour and wait replace the defaults', async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenDimHour: 20, zenDimWaitMin: 2 }));
  render(<Zen nowMs={clockAt(at(20, 30))} />);
  expect(screen.getByText('Dims by itself after 8 PM and 2 quiet minutes')).toBeTruthy();
  await quiet(3);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
});

it('a running session never dims by itself, even late and quiet', async () => {
  // A one minute wait, so a five minute session runs well past the wait; with the guard gone it would dim at once.
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenDimWaitMin: 1 }));
  render(<Zen nowMs={clockAt(at(22, 30))} />);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  await quiet(3);
  expect(document.querySelector('.zen-guide')).not.toBeNull();
  expect(screen.queryByLabelText('Wake')).toBeNull();
  localStorage.removeItem(SETTINGS_KEY);
});

it('a session ending in the afternoon still dims', () => {
  const base = clockAt(new Date(2026, 10, 11, 14, 0, 0, 0).getTime());
  render(<Zen nowMs={base} />);
  fireEvent.click(screen.getByRole('radio', { name: '3 min' }));
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  act(() => void vi.advanceTimersByTime(180_000 + 400));
  act(() => void vi.advanceTimersByTime(1300));
  expect(screen.getByLabelText('Wake')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(120_000));
  expect(screen.getByLabelText('Wake')).toBeTruthy();
});

it('the quiet line shows in the evening and not by day or during a session', () => {
  const evening = render(<Zen nowMs={clockAt(at(20, 15))} />);
  expect(screen.getByText('Dims by itself after 10 PM and 10 quiet minutes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  expect(screen.queryByText(/Dims by itself/)).toBeNull();
  evening.unmount();
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(screen.queryByText(/Dims by itself/)).toBeNull();
});

it('the dim check effect lists what it reads among its dependencies', () => {
  // `ending` is only ever true while a session runs, so no timing test can tell a stale read from a
  // fresh one; the dependency list is what keeps the effect honest, so pin it in the source.
  const effect = /DIM_CHECK_MS\);[\s\S]*?\}, \[([^\]]*)\]\);/.exec(zenSource);
  expect(effect).not.toBeNull();
  const deps = effect![1].split(',').map((d) => d.trim());
  expect(deps).toEqual(expect.arrayContaining(['startedAt', 'ending', 'nowMs', 'dimHour', 'waitMs']));
});

function systemIdle(secs: () => number) {
  const calls = { n: 0 };
  mocks.set('wall2_idle_state', () => {
    calls.n += 1;
    return { idle: false, idleSecs: secs() };
  });
  return calls;
}

it('system activity keeps it bright although the wall got no event for eleven minutes', async () => {
  systemIdle(() => 3);
  render(<Zen nowMs={clockAt(at(22, 30))} />);
  await quiet(11);
  expect(screen.queryByLabelText('Wake')).toBeNull();
  mocks.clear();
});

it('a system idle of ten minutes dims it', async () => {
  const start = Date.now();
  systemIdle(() => Math.round((Date.now() - start) / 1000) + 300);
  render(<Zen nowMs={clockAt(at(22, 30))} />);
  await quiet(4);
  expect(screen.queryByLabelText('Wake')).toBeNull();
  await quiet(2);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
  mocks.clear();
});

it('a click right after the system question makes its old answer count for nothing', async () => {
  let release: (v: { idle: boolean; idleSecs: number }) => void = () => undefined;
  mocks.set('wall2_idle_state', () => new Promise((res) => (release = res)));
  render(<Zen nowMs={clockAt(at(22, 30))} />);
  await quiet(0.2);
  fireEvent.pointerDown(window);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
    release({ idle: true, idleSecs: 9999 });
  });
  expect(screen.queryByLabelText('Wake')).toBeNull();
  mocks.clear();
});

it('when the system command fails the wall input is the fallback', async () => {
  mocks.set('wall2_idle_state', () => Promise.reject(new Error('no helper')));
  render(<Zen nowMs={clockAt(at(22, 30))} />);
  await quiet(9);
  expect(screen.queryByLabelText('Wake')).toBeNull();
  await quiet(2);
  expect(screen.getByLabelText('Wake')).toBeTruthy();
  mocks.clear();
});

it('nothing is polled before the dim hour, while a session runs, once dimmed, or with the page hidden', async () => {
  const calls = systemIdle(() => 0);
  const day = render(<Zen nowMs={clockAt(at(21, 0))} />);
  await quiet(5);
  expect(calls.n).toBe(0);
  day.unmount();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const h = render(<Zen nowMs={clockAt(at(22, 30))} />);
  await quiet(5);
  expect(calls.n).toBe(0);
  h.unmount();
  hidden.mockRestore();
  const run = render(<Zen nowMs={clockAt(at(22, 30))} />);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  await quiet(2);
  expect(calls.n).toBe(0);
  run.unmount();
  usePlaceStore.getState().openDream();
  render(<Zen nowMs={clockAt(at(22, 30))} />);
  await quiet(5);
  expect(calls.n).toBe(0);
  mocks.clear();
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
  usePlaceStore.getState().openDream();
  const night = render(<Zen nowMs={clockAt(NIGHT)} />);
  expect((night.container.querySelector('.zen-veil') as HTMLElement).style.opacity).toBe('0');
});

it("openDream opens Zen already dimmed, by day, once", () => {
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
  expect(screen.getByText('Click anywhere to wake')).toBeTruthy();
  expect(screen.queryByText(/Touch anywhere|Move the mouse/)).toBeNull();
  expect(container.querySelector('.dream-date')!.textContent).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}$/);
  expect(container.querySelector('.dream-clock')!.textContent).toBe('11:48PM');
});

it('Dream: moving the mouse never wakes it; a click and the keys do', () => {
  const onWake = vi.fn();
  render(<Dream onWake={onWake} />);
  const w = screen.getByLabelText('Wake');
  act(() => void vi.advanceTimersByTime(5000));
  fireEvent.mouseMove(w, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(w, { clientX: 900, clientY: 300 });
  fireEvent.mouseEnter(w);
  expect(onWake).not.toHaveBeenCalled();
  fireEvent.click(w);
  expect(onWake).toHaveBeenCalledTimes(1);
});

/** The layer's offset from its inline transform. */
const offsetOf = (el: Element | null) => {
  const n = ((el as HTMLElement).style.transform.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return { x: n[0] ?? Number.NaN, y: n[1] ?? 0 };
};

it('Dream: all its text sits in one drifting layer whose offset changes over time and stays within 30 px', () => {
  vi.setSystemTime(new Date(2026, 10, 11, 23, 0));
  const { container } = render(<Dream onWake={() => undefined} />);
  const layer = container.querySelector('.dream-drift')!;
  for (const sel of ['.dream-clock', '.dream-date', '.dream-hint']) expect(layer.querySelector(sel)).not.toBeNull();
  const seen = new Set<string>();
  for (let i = 0; i < 80; i += 1) {
    act(() => void vi.advanceTimersByTime(30_000));
    const o = offsetOf(layer);
    seen.add(`${o.x},${o.y}`);
    expect(Math.abs(o.x)).toBeLessThanOrEqual(15);
    expect(Math.abs(o.y)).toBeLessThanOrEqual(10);
  }
  // Forty minutes is two laps of 40 samples each: every lap visits the same many different places.
  expect(seen.size).toBeGreaterThanOrEqual(30);
  // Only transform moves: no left, top or margin is set on the layer.
  expect((layer as HTMLElement).style.left).toBe('');
  expect((layer as HTMLElement).style.top).toBe('');
  expect((layer as HTMLElement).style.margin).toBe('');
});

it('Dream drift: the path is closed, one lap in 20 minutes', () => {
  expect(driftOffset(0, false)).toEqual(driftOffset(DRIFT_PERIOD_MS, false));
  expect(driftOffset(0, false)).toEqual({ x: 15, y: 0 });
  expect(driftOffset(DRIFT_PERIOD_MS / 4, false)).toEqual({ x: 0, y: 10 });
  expect(DRIFT_PERIOD_MS).toBeGreaterThanOrEqual(10 * 60_000);
});

it('Dream drift under reduced motion: a few discrete steps, many minutes apart', () => {
  setReducedMotion(true);
  vi.setSystemTime(new Date(2026, 10, 11, 23, 0));
  const { container } = render(<Dream onWake={() => undefined} />);
  const layer = container.querySelector('.dream-drift')!;
  expect(layer.classList.contains('stepped')).toBe(true);
  const seen: string[] = [];
  let changes = 0;
  for (let i = 0; i < 60; i += 1) {
    act(() => void vi.advanceTimersByTime(30_000));
    const o = offsetOf(layer);
    const k = `${o.x},${o.y}`;
    if (seen.length === 0 || seen[seen.length - 1] !== k) changes += 1;
    seen.push(k);
    expect(Math.abs(o.x)).toBeLessThanOrEqual(15);
    expect(Math.abs(o.y)).toBeLessThanOrEqual(10);
  }
  // Thirty minutes: four steps at most five changes, never a continuous slide.
  expect(new Set(seen).size).toBeLessThanOrEqual(4);
  expect(changes).toBeLessThanOrEqual(5);
  expect(changes).toBeGreaterThanOrEqual(2);
  expect(DRIFT_STEP_MS).toBeGreaterThanOrEqual(5 * 60_000);
});

it('Zen: the end-early hint shows only while a session runs and is not ending', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(screen.queryByText('Click anywhere to end early')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  expect(screen.getByText('Click anywhere to end early')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(5 * 60_000 + 600));
  // The guide is fading out: a click does nothing now, so the hint is gone.
  expect(screen.queryByLabelText('End session early')).toBeNull();
  expect(screen.queryByText('Click anywhere to end early')).toBeNull();
});

it('Zen: keyboard focus starts on the chosen length, not the first chip', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  const focused = document.activeElement as HTMLElement;
  expect(focused.getAttribute('role')).toBe('radio');
  expect(focused.getAttribute('aria-checked')).toBe('true');
  expect(focused.textContent).toBe('5 min');
});

it('dreamStatusText says only what is known', () => {
  expect(dreamStatusText(null, null, null)).toBe('');
  expect(dreamStatusText(2, 0, null)).toBe('2 agents still working · No agent needs you');
  expect(dreamStatusText(0, 1, 'Late Night')).toBe('An agent needs you · Lights: Late Night');
  expect(dreamStatusText(1, 3, null)).toBe('1 agent still working · 3 agents need you');
  expect(dreamStatusText(null, null, 'Evening')).toBe('Lights: Evening');
});

it('dreamStatusParts marks only the part that says an agent needs the owner', () => {
  expect(dreamStatusParts(null, null, null)).toEqual([]);
  expect(dreamStatusParts(2, 0, 'Evening')).toEqual([
    { text: '2 agents still working', needs: false },
    { text: 'No agent needs you', needs: false },
    { text: 'Lights: Evening', needs: false },
  ]);
  expect(dreamStatusParts(1, 1, null)).toEqual([
    { text: '1 agent still working', needs: false },
    { text: 'An agent needs you', needs: true },
  ]);
  expect(dreamStatusParts(0, 3, null)).toEqual([{ text: '3 agents need you', needs: true }]);
});

it('Dream status: the needs part is an amber span with a dot, the words stay one sentence; calm has no span', async () => {
  vi.setSystemTime(new Date(2026, 10, 11, 23, 48));
  mocks.set('wall2_meet_day', () => ({ events: [] }));
  for (const [waiting, text, span] of [[true, '1 agent still working · An agent needs you', 'An agent needs you'], [false, '1 agent still working · No agent needs you', null]] as const) {
    resetAgents();
    localStorage.clear();
    mocks.set('wall2_omni_summary', () =>
      summary({ lanes: [lane({ id: 'a', state: 'working' }), ...(waiting ? [lane({ id: 'b', state: 'blocked', waiting: true })] : [])], yourMove: { total: waiting ? 1 : 0, first: waiting ? { sessionId: 'b', title: 'B', kind: 'gate', since: null, question: '' } : null, ...(waiting ? { ids: ['b'] } : {}) } }),
    );
    const r = render(<Dream onWake={() => undefined} />);
    await flushAsync();
    const status = document.querySelector('.dream-status')!;
    expect(status.textContent).toBe(text);
    const needs = status.querySelector('.dream-needs');
    expect(needs?.textContent ?? null).toBe(span);
    expect(needs ? needs.querySelector('i') !== null : true).toBe(true);
    r.unmount();
  }
  resetAgents();
  mocks.clear();
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

it('the chosen session length is the one filled chip in its row', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  const lengths = () => within(screen.getByRole('radiogroup', { name: 'Session length' })).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
  expect(lengths()).toHaveLength(1);
  fireEvent.click(screen.getByRole('radio', { name: '10 min' }));
  expect(lengths().map((r) => r.textContent)).toEqual(['10 min']);
});

it('Dream status: a lane that waits on the owner is not counted as working, like Work', async () => {
  vi.setSystemTime(new Date(2026, 10, 11, 23, 48));
  resetAgents();
  localStorage.clear();
  mocks.set('wall2_omni_summary', () =>
    summary({ lanes: [lane({ id: 'a', state: 'working' }), lane({ id: 'b', state: 'working', waiting: true })] }),
  );
  mocks.set('wall2_meet_day', () => ({ events: [] }));
  render(<Dream onWake={() => undefined} />);
  await flushAsync();
  expect(document.querySelector('.dream-status')!.textContent).toMatch(/^1 agent still working/);
  resetAgents();
  mocks.clear();
});

it('Dream status: counts helper work outside the three glance lanes', async () => {
  vi.setSystemTime(new Date(2026, 10, 11, 23, 48));
  resetAgents();
  localStorage.clear();
  const quiet = [lane({ id: 'a', live: 'idle' }), lane({ id: 'b', live: 'idle' }), lane({ id: 'c', live: 'idle' })];
  const helper = lane({ id: 'd', live: 'idle', bg: { agents: 1, shells: 0 } });
  mocks.set('wall2_omni_summary', () => summary({ lanes: quiet, sessionsList: [...quiet, helper] }));
  mocks.set('wall2_meet_day', () => ({ events: [] }));
  render(<Dream onWake={() => undefined} />);
  await flushAsync();
  expect(document.querySelector('.dream-status')!.textContent).toMatch(/^1 agent still working/);
  resetAgents();
  mocks.clear();
});

const pick = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
const start = () => fireEvent.click(screen.getByRole('button', { name: /Start/ }));
const ticks = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

it('activity picker: four chips above the length chips, Breathe chosen and remembered', () => {
  const { unmount } = render(<Zen nowMs={clockAt(DAY)} />);
  const group = screen.getByRole('radiogroup', { name: 'Activity' });
  expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Breathe', 'Body scan', 'Candle', 'Intention']);
  expect(screen.getByRole('radio', { name: 'Breathe' }).getAttribute('aria-checked')).toBe('true');
  expect(group.compareDocumentPosition(screen.getByRole('radiogroup', { name: 'Session length' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  pick('Candle');
  expect(JSON.parse(localStorage.getItem(ACTIVITY_KEY)!).activity).toBe('candle');
  unmount();
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(screen.getByRole('radio', { name: 'Candle' }).getAttribute('aria-checked')).toBe('true');
  expect(document.querySelector('.zen-candle')).not.toBeNull();
  expect(document.querySelector('.breath')).toBeNull();
});

it('activity picker: a broken or blocked store gives Breathe', () => {
  localStorage.setItem(ACTIVITY_KEY, '{nope');
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(screen.getByRole('radio', { name: 'Breathe' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('radio', { name: 'Calm 4-2-6' }).getAttribute('aria-checked')).toBe('true');
});

it('the running label follows the activity', () => {
  const cases: [string, string][] = [
    ['Breathe', 'FIVE MINUTES OF ZEN'],
    ['Body scan', 'FIVE MINUTES OF BODY SCAN'],
    ['Candle', 'FIVE MINUTES OF CANDLE'],
    ['Intention', 'FIVE MINUTES OF INTENTION'],
  ];
  for (const [chip, label] of cases) {
    const { unmount } = render(<Zen nowMs={clockAt(DAY)} />);
    pick(chip);
    start();
    ticks(100);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('5:00 left.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End session early' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave Zen' })).toBeTruthy();
    unmount();
  }
  expect(sessionLabel(10, 'scan')).toBe('TEN MINUTES OF BODY SCAN');
});

it('Box 4-4-4-4: pattern chips only for Breathe, remembered, and the ring holds after the out-breath too', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  const pats = screen.getByRole('radiogroup', { name: 'Breathing pattern' });
  expect(within(pats).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Calm 4-2-6', 'Box 4-4-4-4', '4-7-8', 'Even 5-5']);
  fireEvent.click(within(pats).getByRole('radio', { name: 'Box 4-4-4-4' }));
  expect(JSON.parse(localStorage.getItem(ACTIVITY_KEY)!).pattern).toBe('box');
  const word = () => document.querySelector('.breath-word')!.textContent;
  expect(word()).toBe('Breathe in');
  ticks(4500);
  expect(word()).toBe('Hold');
  ticks(4000);
  expect(word()).toBe('Breathe out');
  ticks(4000);
  expect(word()).toBe('Hold');
  ticks(4000);
  expect(word()).toBe('Breathe in');
  pick('Candle');
  expect(screen.queryByRole('radiogroup', { name: 'Breathing pattern' })).toBeNull();
});

it('Body scan: the figure, one caption, and the step follows the session length', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  pick('Body scan');
  expect(document.querySelector('.zen-figure')).not.toBeNull();
  expect(screen.getByText(BODY_STEPS[0].caption)).toBeTruthy();
  start();
  ticks(100);
  expect(document.querySelector('.zen-scan')!.getAttribute('data-step')).toBe('0');
  // 5 minutes over 12 steps: 25 seconds a step.
  ticks(26_000);
  expect(document.querySelector('.zen-scan')!.getAttribute('data-step')).toBe('1');
  expect(screen.getByText(BODY_STEPS[1].caption)).toBeTruthy();
  // The old line fades out while the new one fades in, then only the new one is left.
  expect(document.querySelectorAll('.zen-scan-cap p')).toHaveLength(2);
  ticks(1000);
  expect(document.querySelectorAll('.zen-scan-cap p')).toHaveLength(1);
  const bar = document.querySelector<HTMLElement>('.zen-scan-bar i')!;
  expect(parseFloat(bar.style.width)).toBeGreaterThan(0);
});

it('Body scan under reduced motion swaps the caption without a crossfade', () => {
  setReducedMotion(true);
  render(<Zen nowMs={clockAt(DAY)} />);
  pick('Body scan');
  start();
  ticks(26_100);
  expect(screen.getByText(BODY_STEPS[1].caption)).toBeTruthy();
  expect(document.querySelectorAll('.zen-scan-cap p')).toHaveLength(1);
});

it('Candle: a darker veil, the line for 10 seconds and then it fades; the flicker keeps running under reduced motion', () => {
  const veil = () => (document.querySelector('.zen-veil') as HTMLElement).style.opacity;
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(veil()).toBe(String(ZEN_VEIL));
  pick('Candle');
  expect(veil()).toBe(String(ZEN_VEIL_CANDLE));
  expect(ZEN_VEIL_CANDLE).toBeGreaterThan(ZEN_VEIL);
  const line = () => screen.getByText(CANDLE_LINE);
  start();
  ticks(CANDLE_LINE_MS - 500);
  expect(line().getAttribute('data-shown')).toBe('true');
  ticks(600);
  expect(line().getAttribute('data-shown')).toBe('false');
  expect(line().classList.contains('gone')).toBe(true);
  expect(document.querySelector('.zen-candle-flame')).not.toBeNull();
});

const zenCss: string = readFileSync('src/styles/zen.css', 'utf8');

it('Candle flicker stays animated with reduced motion (transform and opacity only)', () => {
  expect(zenCss).toMatch(/\.zen-candle-flame\s*{[^}]*animation: zen-flicker/);
  const reduced = zenCss.slice(zenCss.indexOf('prefers-reduced-motion'));
  expect(reduced).not.toMatch(/zen-candle-(flame|glow)|zen-flicker|zen-glow/);
  const frames = zenCss.match(/@keyframes zen-(flicker|glow)\s*{[\s\S]*?\n}\n/g)!.join('');
  const props = new Set([...frames.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]));
  expect([...props].sort()).toEqual(['opacity', 'transform']);
});

it('Intention: the question and a field before Start; Enter begins; the line shows faint during the run', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  pick('Intention');
  expect(screen.getByText('What matters for the next hour?')).toBeTruthy();
  const field = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(field, { target: { value: 'Finish the dashboard draft' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  ticks(100);
  expect(screen.getByText('FIVE MINUTES OF INTENTION')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(document.querySelector('.zen-intent-line')!.textContent).toBe('Finish the dashboard draft');
});

it('Intention: typing does not end the session, wake it or reach key handlers outside the field', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  pick('Intention');
  const field = screen.getByRole('textbox') as HTMLInputElement;
  const outside = vi.fn();
  document.addEventListener('keydown', outside);
  field.focus();
  fireEvent.keyDown(field, { key: 'a' });
  fireEvent.keyDown(field, { key: ' ' });
  fireEvent.click(field);
  document.removeEventListener('keydown', outside);
  expect(outside).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Start/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'End session early' })).toBeNull();
  expect(usePlaceStore.getState().active).toBe('zen');
  // A running session still ends on a click anywhere.
  start();
  ticks(100);
  fireEvent.click(screen.getByRole('button', { name: 'End session early' }));
  expect(screen.getByRole('button', { name: /Start/ })).toBeTruthy();
});

it('Intention: the line is kept for the day and prefilled; another day starts empty', () => {
  const { unmount } = render(<Zen nowMs={clockAt(DAY)} />);
  pick('Intention');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ship the report' } });
  start();
  expect(JSON.parse(localStorage.getItem(INTENTION_KEY)!)).toEqual({ day: dayKey(new Date(DAY)), text: 'Ship the report' });
  unmount();
  render(<Zen nowMs={clockAt(DAY + 3_600_000)} />);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Ship the report');
  cleanup();
  render(<Zen nowMs={clockAt(DAY + 24 * 3_600_000)} />);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
});

it('every new control has a tooltip handler', () => {
  render(<Zen nowMs={clockAt(DAY)} />);
  expect(zenSource.match(/\{\.\.\.tip\(/g)!.length).toBeGreaterThanOrEqual(2);
  expect(activitiesSource.match(/\{\.\.\.tip\(/g)!.length).toBeGreaterThanOrEqual(1);
});
