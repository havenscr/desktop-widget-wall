import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { CAMERAS } from '../horizon/cameras';
import { useFocusStore } from '../focus/store';
import { usePlaceStore } from '../state/places';
import { SETTINGS_KEY } from '../settings/settings';
import { Zen } from './Zen';
import { SummitCaption, SummitScene, climbProgress } from './Summit';
import { LANTERN_LIFT_PX, MAX_SUMMIT_LIGHTS, SUMMIT_MINUTES, SUMMIT_RUN_PX, climbPoint, finishedLights, peakX, summitLabel } from './modes';
import summitSource from './Summit.tsx?raw';
import zenSource from './Zen.tsx?raw';
// @ts-ignore node's own file call; this test reads the stylesheet as text.
import { readFileSync } from 'node:fs';

const summitSrc = summitSource.replace(/\r\n/g, '\n');
const zenSrc = zenSource.replace(/\r\n/g, '\n');
const css = readFileSync('src/styles/zen.css', 'utf8').replace(/\r\n/g, '\n');
const CAM = CAMERAS.unwind;
const T0 = new Date(2026, 10, 11, 10, 0, 0).getTime();
const MIN = 60_000;

beforeEach(() => {
  useFocusStore.getState().dispose();
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  mocks.set('get_do_not_disturb', () => false);
  mocks.set('enable_do_not_disturb', () => undefined);
  mocks.set('disable_do_not_disturb', () => undefined);
  usePlaceStore.setState({ active: 'zen', zenDream: false });
});
afterEach(() => {
  cleanup();
  useFocusStore.getState().dispose();
  vi.useRealTimers();
  mocks.clear();
});

const ticks = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

it('the climb starts 520 px left of the peak and ends on it, on the skyline', () => {
  const a = climbPoint(0, CAM);
  const b = climbPoint(1, CAM);
  expect(b.x).toBeCloseTo(peakX(CAM), 6);
  expect(a.x).toBeCloseTo(peakX(CAM) - SUMMIT_RUN_PX, 6);
  expect(climbPoint(0.5, CAM).x).toBeCloseTo(peakX(CAM) - SUMMIT_RUN_PX / 2, 6);
  // The Brothers is the high point of this stretch, so the lantern ends higher (smaller y) than it started.
  expect(b.y).toBeLessThan(a.y);
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const c = climbPoint(p, CAM);
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    expect(c.y).toBeGreaterThan(0);
    expect(c.y).toBeLessThan(CAM.hy);
  }
  expect(climbPoint(-1, CAM)).toEqual(a);
  expect(climbPoint(9, CAM)).toEqual(b);
  expect(climbPoint(Number.NaN, CAM)).toEqual(a);
  expect(LANTERN_LIFT_PX).toBeGreaterThan(0);
});

it('a finished session lights the summit: today only, real sessions only, at most eight', () => {
  const day = (h: number, len = 25) => ({ start: new Date(2026, 10, 11, h, 0).getTime(), end: new Date(2026, 10, 11, h, len).getTime() });
  const noon = new Date(2026, 10, 11, 12, 0).getTime();
  expect(finishedLights([], noon)).toBe(0);
  expect(finishedLights([day(8), day(9), day(10)], noon)).toBe(3);
  // Running (ends later), cut short (under 5 minutes) and yesterday's do not count.
  expect(finishedLights([day(8), { start: noon - MIN, end: noon + 24 * MIN }, day(9, 2), { start: noon - 30 * 3_600_000, end: noon - 29 * 3_600_000 }], noon)).toBe(1);
  const many = Array.from({ length: 12 }, (_, i) => day(i));
  expect(finishedLights(many, new Date(2026, 10, 11, 23, 0).getTime())).toBe(MAX_SUMMIT_LIGHTS);
  expect(MAX_SUMMIT_LIGHTS).toBe(8);
});

it('the caption names the length and counts the lights', () => {
  expect(summitLabel(50)).toBe('FIFTY MINUTES OF SUMMIT');
  expect(SUMMIT_MINUTES).toEqual([25, 50, 90]);
  const { container, rerender } = render(<SummitCaption minutes={25} left="12:00." lights={0} />);
  expect(screen.getByText('TWENTY FIVE MINUTES OF SUMMIT')).toBeTruthy();
  expect(container.querySelector('.zen-count')).toBeNull();
  rerender(<SummitCaption minutes={25} left="12:00." lights={3} />);
  expect(screen.getByText('3 climbs finished today.')).toBeTruthy();
});

it('the lantern is one element, moved once a second, with no frame loop', () => {
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  const session = { endAt: T0 + 25 * MIN, minutes: 25 };
  const { container } = render(<SummitScene session={session} lights={0} />);
  const lanterns = container.querySelectorAll('.summit-lantern');
  expect(lanterns).toHaveLength(1);
  const at = () => (lanterns[0] as HTMLElement).style.transform;
  const first = at();
  ticks(999);
  expect(at()).toBe(first);
  ticks(1);
  expect(at()).not.toBe(first);
  const second = at();
  ticks(1000);
  expect(at()).not.toBe(second);
  expect(raf).not.toHaveBeenCalled();
  expect(container.querySelectorAll('.summit-lantern')[0]).toBe(lanterns[0]);
});

it('the lantern reaches the peak at the end and the peak name fades in near the top', () => {
  const session = { endAt: T0 + 10 * MIN, minutes: 10 };
  const { container } = render(<SummitScene session={session} lights={0} />);
  const name = container.querySelector('.summit-name')!;
  expect(name.className).not.toContain(' on');
  ticks(8 * MIN);
  expect(name.className).not.toContain(' on');
  ticks(MIN);
  expect(name.className).toContain(' on');
  expect(name.textContent).toBe('The Brothers');
  ticks(MIN);
  const end = climbPoint(1, CAM);
  expect((container.querySelector('.summit-lantern') as HTMLElement).style.transform).toBe(`translate(${Math.round(end.x * 100) / 100}px, ${Math.round(end.y * 100) / 100}px)`);
  expect(climbProgress(T0 + 10 * MIN, 10, T0 + 5 * MIN)).toBeCloseTo(0.5, 6);
});

it('shows one small light per finished session, never more than eight, and no lantern with no session', () => {
  const a = render(<SummitScene session={null} lights={3} />);
  expect(a.container.querySelectorAll('.summit-light')).toHaveLength(3);
  expect(a.container.querySelector('.summit-lantern')).toBeNull();
  a.unmount();
  const b = render(<SummitScene session={null} lights={8} />);
  expect(b.container.querySelectorAll('.summit-light')).toHaveLength(8);
});

it('Zen opens in Summit when the focus timer is already running, and does not save that as the mode', () => {
  useFocusStore.getState().startLabeled('Review the draft');
  render(<Zen nowMs={() => Date.now()} />);
  expect(screen.getByText('TWENTY FIVE MINUTES OF SUMMIT')).toBeTruthy();
  expect(document.querySelector('.summit-lantern')).not.toBeNull();
  expect(screen.queryByRole('radiogroup', { name: 'Mode' })).toBeNull();
  const saved = localStorage.getItem(SETTINGS_KEY);
  expect(saved === null || JSON.parse(saved).zenMode === undefined).toBe(true);
});

it('Start on Summit starts the shared focus timer, and leaving Zen never stops it', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenMode: 'summit' }));
  const view = render(<Zen nowMs={() => Date.now()} />);
  fireEvent.click(screen.getByRole('radio', { name: '50 min' }));
  expect(useFocusStore.getState().state.minutes).toBe(50);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  const s = useFocusStore.getState().state;
  expect(s.status).toBe('running');
  expect(s.status === 'running' && s.label).toBe('Summit');
  expect(screen.getByText('FIFTY MINUTES OF SUMMIT')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Leave Zen' }));
  view.unmount();
  expect(useFocusStore.getState().state.status).toBe('running');
  ticks(MIN);
  expect(useFocusStore.getState().state.status).toBe('running');
});

it('the counts run and a finished session lights the summit', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenMode: 'summit' }));
  render(<Zen nowMs={() => Date.now()} />);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  ticks(MIN);
  expect(screen.getByText('24:00 left.')).toBeTruthy();
  ticks(24 * MIN + 1000);
  expect(useFocusStore.getState().state.status).toBe('finished');
  expect(document.querySelectorAll('.summit-light')).toHaveLength(1);
  expect(screen.getByRole('button', { name: /Start/ })).toBeTruthy();
});

it('a click on the stage only closes Summit: the focus timer keeps running', () => {
  useFocusStore.getState().startLabeled('Summit');
  render(<Zen nowMs={() => Date.now()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close Summit' }));
  expect(useFocusStore.getState().state.status).toBe('running');
  expect(document.querySelector('.summit-lantern')).toBeNull();
  expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
  cleanup();
  // Reopening Zen while the timer runs opens Summit on the session again.
  render(<Zen nowMs={() => Date.now()} />);
  expect(document.querySelector('.summit-lantern')).not.toBeNull();
});

it('End session stops the focus timer and has a tooltip', () => {
  useFocusStore.getState().startLabeled('Summit');
  render(<Zen nowMs={() => Date.now()} />);
  const btn = screen.getByRole('button', { name: 'End session' });
  fireEvent.focus(btn);
  fireEvent.click(btn);
  expect(useFocusStore.getState().state.status).toBe('idle');
  expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
  expect(zenSrc).toMatch(/tip\('Stops the focus timer and Do Not Disturb'\)/);
  expect(css).toMatch(/\.zen-br \.zend \{[^}]*font-size: 18px;[^}]*padding: 0 22px/);
});

it('a paused focus timer offers Resume instead of a second Start', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenMode: 'summit' }));
  useFocusStore.getState().start();
  useFocusStore.getState().pause();
  render(<Zen nowMs={() => Date.now()} />);
  fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
  expect(useFocusStore.getState().state.status).toBe('running');
});

it('the Summit start screen explains the shared timer in text of 16 px or more', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenMode: 'summit' }));
  render(<Zen nowMs={() => Date.now()} />);
  expect(document.querySelector('.zen-note')!.textContent).toMatch(/Do Not Disturb/);
  expect(css).toMatch(/\.zen-note \{[^}]*font: 400 18px/);
  expect(css).toMatch(/\.zen-count \{[^}]*font: 400 18px/);
  expect(css).toMatch(/\.summit-name span \{[^}]*font: 600 18px/);
});

it('Summit draws with no frame loop, never touches the timer on unmount, and honours reduced motion', () => {
  const needle = ['request', 'Animation', 'Frame'].join('');
  expect(summitSrc.includes(needle)).toBe(false);
  expect(summitSrc).toMatch(/setInterval\(tick, LANTERN_TICK_MS\)/);
  expect(summitSrc).not.toMatch(/useFocusStore/);
  expect(zenSrc).not.toMatch(/useEffect\(\(\) => \(\) => useFocusStore/);
  expect(css).toMatch(/\.summit-lantern \{[^}]*transition: transform 1s linear/);
  expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.summit-lantern,\s*\.summit-name \{\s*transition: none/);
});
