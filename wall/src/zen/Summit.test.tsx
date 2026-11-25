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
// @ts-ignore node's own file call; this test reads the stylesheet as text.
import { readFileSync } from 'node:fs';

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

it('a finished climb lights the summit: completed only, once per climb, today only, at most eight', () => {
  const day = (h: number, len = 25, extra: object = { done: true }) => ({ start: new Date(2026, 10, 11, h, 0).getTime(), end: new Date(2026, 10, 11, h, len).getTime(), ...extra });
  const noon = new Date(2026, 10, 11, 12, 0).getTime();
  expect(finishedLights([], noon)).toBe(0);
  expect(finishedLights([day(8), day(9), day(10)], noon)).toBe(3);
  // Running, ended early (not done), a 4:59 session (not done) and yesterday's do not count.
  expect(finishedLights([day(8), { start: noon - MIN, end: noon + 24 * MIN, done: true }, day(9, 6, {}), day(10, 4, {}), { start: noon - 30 * 3_600_000, end: noon - 29 * 3_600_000, done: true }], noon)).toBe(1);
  // Two records of one climb (pause then resume) are one light.
  expect(finishedLights([day(8, 10, { id: 5 }), { ...day(9, 15), id: 5 }], noon)).toBe(1);
  // A climb that ends just after midnight counts on the day it ended, whole.
  const late = { start: new Date(2026, 10, 11, 23, 58).getTime(), end: new Date(2026, 10, 12, 0, 23).getTime(), done: true };
  expect(finishedLights([late], new Date(2026, 10, 12, 1, 0).getTime())).toBe(1);
  expect(finishedLights([late], noon)).toBe(0);
  const many = Array.from({ length: 12 }, (_, i) => day(i));
  expect(finishedLights(many, new Date(2026, 10, 11, 23, 0).getTime())).toBe(MAX_SUMMIT_LIGHTS);
  expect(MAX_SUMMIT_LIGHTS).toBe(8);
});

it('the store marks a climb done only when the timer runs to zero, one light across pause and resume', () => {
  const f = () => useFocusStore.getState();
  const lights = () => finishedLights(f().sessions, Date.now());
  f().init();
  f().start();
  ticks(10 * MIN);
  f().pause();
  ticks(MIN);
  f().resume();
  expect(f().sessions).toHaveLength(2);
  ticks(15 * MIN + 1000);
  expect(f().state.status).toBe('finished');
  expect(lights()).toBe(1);
  // End session at minute 6 leaves no light.
  f().start();
  ticks(6 * MIN);
  f().reset();
  expect(lights()).toBe(1);
  // Paused after 4:59 and ended: no light.
  f().start();
  ticks(4 * MIN + 59_000);
  f().pause();
  f().reset();
  expect(lights()).toBe(1);
  // A full session adds one.
  f().start();
  ticks(25 * MIN + 1000);
  expect(lights()).toBe(2);
});

it('an old save without ids or done flags still reads, and counts no lights', () => {
  localStorage.setItem('wall2-focus-day', JSON.stringify({ sessions: [{ start: T0 - 40 * MIN, end: T0 - 10 * MIN }] }));
  useFocusStore.getState().init();
  expect(useFocusStore.getState().sessions).toHaveLength(1);
  expect(finishedLights(useFocusStore.getState().sessions, T0)).toBe(0);
});

it('a session finishing while Zen is open adds its light at once', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenMode: 'summit' }));
  useFocusStore.getState().init();
  useFocusStore.getState().startLabeled('Summit');
  render(<Zen nowMs={() => Date.now()} />);
  expect(document.querySelectorAll('.summit-light').length).toBe(0);
  ticks(25 * MIN + 1000);
  expect(useFocusStore.getState().state.status).toBe('finished');
  expect(document.querySelectorAll('.summit-light').length).toBe(1);
});

it('yesterday lights clear at local midnight while Zen stays open', () => {
  vi.setSystemTime(new Date(2026, 10, 11, 23, 0).getTime());
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenMode: 'summit' }));
  useFocusStore.getState().init();
  useFocusStore.getState().start();
  ticks(25 * MIN + 1000);
  render(<Zen nowMs={() => Date.now()} />);
  expect(document.querySelectorAll('.summit-light').length).toBe(1);
  ticks(2 * 3_600_000);
  expect(document.querySelectorAll('.summit-light').length).toBe(0);
});

it('a timer already running opens Summit even when the store loads after Zen mounts', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenMode: 'breath' }));
  localStorage.setItem('wall2-focus', JSON.stringify({ status: 'running', minutes: 25, endAt: T0 + 20 * MIN }));
  render(<Zen nowMs={() => Date.now()} />);
  expect(document.querySelector('.summit-lantern')).toBeNull();
  act(() => useFocusStore.getState().init());
  expect(document.querySelector('.summit-lantern')).not.toBeNull();
});

it('a length Work set outside the usual chips shows as the selected chip', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zenMode: 'summit' }));
  useFocusStore.getState().init();
  useFocusStore.getState().setMinutes(35);
  render(<Zen nowMs={() => Date.now()} />);
  expect(screen.getByRole('radio', { name: '35 min' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getAllByRole('radio', { name: /min$/ }).filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
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
  expect(btn.getAttribute('aria-label') ?? btn.textContent).toBe('End session');
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

it('Summit draws with no frame loop and never touches the timer on unmount', () => {
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  useFocusStore.getState().startLabeled('Summit');
  const { unmount } = render(<Zen nowMs={() => Date.now()} />);
  ticks(5000);
  expect(raf).not.toHaveBeenCalled();
  unmount();
  expect(useFocusStore.getState().state.status).toBe('running');
  raf.mockRestore();
});

it('the Summit text keeps its size and the buttons keep their padding', () => {
  const px = (re: RegExp) => Number(re.exec(css)?.[1] ?? 0);
  expect(px(/\.zen-hint \{[^}]*font: 400 (\d+)px/)).toBeGreaterThanOrEqual(16);
  expect(px(/\.zen-br \.zend \{[^}]*padding: 0 (\d+)px/)).toBeGreaterThanOrEqual(10);
  expect(px(/\.zleave \{[^}]*padding: 0 (\d+)px/)).toBeGreaterThanOrEqual(10);
  expect(css).toMatch(/\.summit-lantern \{[^}]*transition: transform 1s linear/);
  expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.summit-lantern,\s*\.summit-name \{\s*transition: none/);
});
