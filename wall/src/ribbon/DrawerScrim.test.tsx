// @ts-ignore node's own file calls; this test reads the app's source and stylesheet as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { Rail } from '../rail/Rail';
import { Screens } from '../screens/Screens';
import { usePlaceStore } from '../state/places';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { resetWeatherStore } from '../weather/useWeather';
import { resetMeetingFeed } from '../work/useNextMeeting';
import { resetDays } from './days';
import { DrawerScrim } from './DrawerScrim';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();
useFixedClock(Date.parse('2026-11-11T10:24:00-08:00'));

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let opened: unknown[] = [];
let leaveClicks = 0;
beforeEach(() => {
  opened = [];
  leaveClicks = 0;
  useFocusStore.getState().dispose();
  localStorage.clear();
  usePlaceStore.setState({ active: 'work' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  mocks.set('wall2_meet_next', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }], meetings: [] }));
  mocks.set('wall2_meet_day', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }], events: [] }));
  mocks.set('wall2_tasks_summary', () => ({ next: [{ id: 't1', title: 'Send the proposal', estMinutes: 45 }], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } }));
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_machines', () => ({ pc: { cpuPct: 34, gpuPct: 71, ramPct: 58 }, box: null, boxStale: false }));
  mocks.set('get_do_not_disturb', () => false);
  mocks.set('wall2_omni_summary', () => summary({ sessionsList: [lane(), lane({ id: 'a1b2c3d4-0002', title: 'Usage meter rework' })] }));
  mocks.set('wall2_omni_days', () => []);
  mocks.set('wall2_omni_day', () => null);
  mocks.set('wall2_focus_omnigent', (a) => void opened.push(['session', a]));
  mocks.set('wall2_keys_summary', () => ({ front: 'app', autoId: 'general', exe: null, sets: [{ id: 'general', name: 'General', general: true, keys: [{ label: 'Snip', icon: 'screenshot', action: null }] }], source: 'file', defaultPins: [], filePins: [] }));
  mocks.set('wall2_arrange_status', () => true);
  mocks.set('wall2_keys_send', (a) => void opened.push(['key', a]));
});
afterEach(() => {
  resetTip();
  resetAgents();
  resetDays();
  resetWeatherStore();
  resetMeetingFeed();
  useFocusStore.getState().dispose();
  vi.unstubAllGlobals();
  mocks.clear();
});

/** The app's own layers in the app's own order: the shell (rail and place), the scrim, the leave banner, the tooltip layer. */
function Wall() {
  return (
    <div className="stage">
      <div className="shell">
        <Rail />
        <Screens />
      </div>
      <DrawerScrim />
      <div className="leave-banner">
        <button type="button" onClick={() => void leaveClicks++}>
          Join now
        </button>
      </div>
      <HoverTipLayer />
    </div>
  );
}

const handle = (r: ReturnType<typeof render>) => r.container.querySelector('.rib .rib-handle:not(.in-drawer)') as HTMLElement;
const inertOf = (el: Element | null) => el?.closest('[inert]') ?? null;

it('with the drawer open a click outside only closes it: the agent card, the tasks and the rail are not reached', async () => {
  const r = render(<Wall />);
  await flush(50);
  expect(r.container.querySelector('.drawer-scrim')).toBeNull();
  const card = r.container.querySelector('.lane-open') as HTMLElement;
  expect(card).not.toBeNull();
  expect(r.container.querySelector('.keys .key-tile')).not.toBeNull();
  fireEvent.click(handle(r));
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  const scrim = r.container.querySelector('.drawer-scrim') as HTMLElement;
  expect(scrim).not.toBeNull();
  // The agent card, a task, the rail and the leave banner are inert: no hover, click or focus.
  expect(inertOf(card)).not.toBeNull();
  expect(inertOf(r.container.querySelector('.keys .key-tile'))).not.toBeNull();
  expect(inertOf(r.container.querySelector('.wr [aria-label="Tasks"]'))).not.toBeNull();
  expect(inertOf(r.container.querySelector('.rail .rb'))).not.toBeNull();
  expect(inertOf(r.container.querySelector('.leave-banner button'))).not.toBeNull();
  expect(inertOf(handle(r))).not.toBeNull();
  // The drawer, its own rows and the hover card layer stay live.
  expect(inertOf(r.container.querySelector('.day-drawer'))).toBeNull();
  expect(inertOf(r.container.querySelector('.dd-row'))).toBeNull();
  // A click anywhere outside lands on the scrim: it closes the drawer and opens nothing.
  fireEvent.click(scrim);
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  expect(r.container.querySelector('.drawer-scrim')).toBeNull();
  expect(opened).toEqual([]);
  expect(leaveClicks).toBe(0);
});

it('the page is live again after the drawer closes, by Escape or by the scrim', async () => {
  const r = render(<Wall />);
  await flush(50);
  for (const close of [() => fireEvent.keyDown(window, { key: 'Escape' }), () => fireEvent.click(r.container.querySelector('.drawer-scrim') as HTMLElement)]) {
    fireEvent.click(handle(r));
    expect(r.container.querySelectorAll('[inert]').length).toBeGreaterThan(0);
    close();
    expect(r.container.querySelector('.day-drawer')).toBeNull();
    expect(r.container.querySelectorAll('[inert]').length).toBe(0);
    expect(inertOf(r.container.querySelector('.lane-open'))).toBeNull();
  }
  fireEvent.click(r.container.querySelector('.lane-open') as HTMLElement);
  expect(opened).toEqual([['session', { id: 'a1b2c3d4-0001' }]]);
});

it('focus goes into the drawer when it opens and back to the handle when it closes', async () => {
  const r = render(<Wall />);
  await flush(50);
  handle(r).focus();
  fireEvent.click(handle(r));
  const drawer = r.container.querySelector('.day-drawer') as HTMLElement;
  expect(document.activeElement).toBe(drawer);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(document.activeElement).toBe(handle(r));
  // Opened without the handle having focus (a click in a test, a fold chip on the strip): focus still ends on the handle.
  (document.activeElement as HTMLElement).blur();
  fireEvent.click(handle(r));
  expect(document.activeElement).toBe(r.container.querySelector('.day-drawer'));
  fireEvent.click(r.container.querySelector('.drawer-scrim') as HTMLElement);
  expect(document.activeElement).toBe(handle(r));
});

it('a press on the scrim does not take focus out of the drawer', async () => {
  const r = render(<Wall />);
  await flush(50);
  fireEvent.click(handle(r));
  const down = fireEvent.mouseDown(r.container.querySelector('.drawer-scrim') as HTMLElement);
  // Prevented: the browser does not move focus to the body.
  expect(down).toBe(false);
});

it('the app draws the scrim between the shell and the leave banner, and the layers stack scrim, drawer, banner', () => {
  const app: string = readFileSync('src/App.tsx', 'utf8');
  const at = (t: string) => app.indexOf(t);
  expect(at('<DrawerScrim />')).toBeGreaterThan(at('<Screens />'));
  expect(at('<DrawerScrim />')).toBeLessThan(at('<LeaveBanner />'));
  expect(at('<DrawerScrim />')).toBeLessThan(at('<FloatingRecordingChip />'));
  const css: string = readFileSync('src/styles/ribbon.css', 'utf8');
  const z = (sel: string) => Number(new RegExp(`\\n${sel.replace(/[.~ ]/g, '\\$&')} \\{[^}]*z-index: (\\d+)`).exec(css)?.[1]);
  expect(z('.drawer-scrim')).toBeLessThan(z('.day-drawer'));
  const above = Number(/\.drawer-scrim ~ \.leave-banner,\n\.drawer-scrim ~ \.rec-float \{[^}]*z-index: (\d+)/.exec(css)?.[1]);
  expect(above).toBeGreaterThan(z('.day-drawer'));
  // The dim is 20 to 30 percent and there is no live blur of the animated sky.
  const dim = Number(/\.drawer-scrim \{[^}]*background: rgba\(\d+, \d+, \d+, ([\d.]+)\)/.exec(css)?.[1]);
  expect(dim).toBeGreaterThanOrEqual(0.2);
  expect(dim).toBeLessThanOrEqual(0.3);
  expect(/\.drawer-scrim \{[^}]*backdrop-filter/.test(css)).toBe(false);
});
