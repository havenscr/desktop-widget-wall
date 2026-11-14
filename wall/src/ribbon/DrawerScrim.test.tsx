// @ts-ignore node's own file calls; this test reads the app's source and stylesheet as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { Rail } from '../rail/Rail';
import { AgentsToday } from './AgentsToday';
import { ToolsDrawer } from '../tools/ToolsDrawer';
import { useToolsStore } from '../tools/store';
import { useState } from 'react';
import { Screens } from '../screens/Screens';
import { usePlaceStore } from '../state/places';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { resetWeatherStore } from '../weather/useWeather';
import { resetMeetingFeed } from '../work/useNextMeeting';
import { resetDays } from './days';
import { LATCH_MS } from '../work/useGuard';
import { DrawerScrim, overlayOwnsPointer, resetScrim } from './DrawerScrim';
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
  resetScrim();
  resetTip();
  resetAgents();
  resetDays();
  resetWeatherStore();
  resetMeetingFeed();
  useFocusStore.getState().dispose();
  vi.unstubAllGlobals();
  mocks.clear();
});

/**
 * The app's own layers in the app's own order: the shell (rail and place), the scrim, the leave banner, the tooltip layer.
 * With `late`, a second leave banner and the recording chip mount (as they do when a meeting nears or a recording starts).
 */
function Wall({ late = false }: { late?: boolean }) {
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
      {late && (
        <>
          <div className="leave-banner late-banner">
            <button type="button" onClick={() => void leaveClicks++}>
              Join late
            </button>
          </div>
          <div className="rec-float">
            <button type="button" onClick={() => void leaveClicks++}>
              Recording
            </button>
          </div>
        </>
      )}
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
  // The shield stays for about a double click, then goes.
  expect(r.container.querySelector('.drawer-scrim')).not.toBeNull();
  await flush(LATCH_MS + 10);
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
    await flush(LATCH_MS + 10);
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
  await flush(LATCH_MS + 10);
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
  // The blur is slight (4 px) with a dim of 20 percent; without backdrop-filter support the dim alone is 30 percent.
  const sup = /@supports \(backdrop-filter: blur\(4px\)\)[^{]*\{\s*\.drawer-scrim \{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(sup).toMatch(/background: rgba\(\d+, \d+, \d+, 0\.2\)/);
  expect(sup).toMatch(/\bbackdrop-filter: blur\(4px\)/);
  const base = /\n\.drawer-scrim \{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(base).toMatch(/background: rgba\(\d+, \d+, \d+, 0\.3\)/);
  expect(base).not.toMatch(/backdrop-filter/);
  // Reduced transparency turns the blur off and puts the dim back to 30 percent, after the supported rule so it wins.
  const mq = /@media \(prefers-reduced-transparency: reduce\) \{\s*\.drawer-scrim \{([^}]*)\}/.exec(css);
  expect(mq?.[1]).toMatch(/backdrop-filter: none/);
  expect(mq?.[1]).toMatch(/background: rgba\(\d+, \d+, \d+, 0\.3\)/);
  expect(mq!.index).toBeGreaterThan(css.indexOf('@supports (backdrop-filter: blur(4px))'));
});

/** The topmost thing at the drawer's agent card, as the pointer finds it: the shield while it is up, else the card. */
const topAt = (r: ReturnType<typeof render>, under: HTMLElement) => (r.container.querySelector('.drawer-scrim') as HTMLElement | null) ?? under;
/** One whole mouse click, each event on whatever is topmost when it happens. */
const click = (r: ReturnType<typeof render>, under: HTMLElement, button = 0) => {
  fireEvent.pointerDown(topAt(r, under), { button });
  fireEvent.mouseDown(topAt(r, under), { button });
  fireEvent.pointerUp(topAt(r, under), { button });
  fireEvent.mouseUp(topAt(r, under), { button });
  if (button === 0) fireEvent.click(topAt(r, under), { button });
  else fireEvent(topAt(r, under), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button }));
};

it('a double click outside closes the drawer on the first press and the second click lands on the shield, not on the agent card', async () => {
  const r = render(<Wall />);
  await flush(50);
  const card = r.container.querySelector('.lane-open') as HTMLElement;
  fireEvent.click(handle(r));
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  click(r, card);
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  expect(r.container.querySelector('.drawer-scrim')).not.toBeNull();
  click(r, card);
  fireEvent.doubleClick(topAt(r, card));
  expect(opened).toEqual([]);
  await flush(LATCH_MS + 10);
  expect(r.container.querySelector('.drawer-scrim')).toBeNull();
  // The shield is gone: the next click on the card is a real one.
  fireEvent.click(card);
  expect(opened).toEqual([['session', { id: 'a1b2c3d4-0001' }]]);
});

it('a right click outside closes the drawer, shows no menu and opens nothing', async () => {
  const r = render(<Wall />);
  await flush(50);
  const card = r.container.querySelector('.lane-open') as HTMLElement;
  fireEvent.click(handle(r));
  fireEvent.pointerDown(topAt(r, card), { button: 2 });
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  // The menu event belongs to the shield and is prevented.
  expect(fireEvent.contextMenu(topAt(r, card), { button: 2 })).toBe(false);
  click(r, card, 2);
  expect(opened).toEqual([]);
  await flush(LATCH_MS + 10);
});

it('a drag that starts on the scrim and ends on a key only closes the drawer', async () => {
  const r = render(<Wall />);
  await flush(50);
  const key = r.container.querySelector('.keys .key-tile') as HTMLElement;
  fireEvent.click(handle(r));
  fireEvent.pointerDown(topAt(r, key));
  fireEvent.mouseDown(topAt(r, key));
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  fireEvent.pointerUp(topAt(r, key));
  fireEvent.mouseUp(topAt(r, key));
  fireEvent.click(topAt(r, key));
  await flush(LATCH_MS + 10);
  expect(opened).toEqual([]);
});

it('the shield sets the root attribute while it is up and clears it when it goes', async () => {
  const r = render(<Wall />);
  await flush(50);
  expect(overlayOwnsPointer()).toBe(false);
  fireEvent.click(handle(r));
  expect(overlayOwnsPointer()).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(overlayOwnsPointer()).toBe(false);
  fireEvent.click(handle(r));
  fireEvent.pointerDown(r.container.querySelector('.drawer-scrim') as HTMLElement);
  // Closed by a press: the attribute holds through the guard.
  expect(overlayOwnsPointer()).toBe(true);
  await flush(LATCH_MS + 10);
  expect(overlayOwnsPointer()).toBe(false);
});

it('a banner and a chip that mount while the drawer is open are inert and take no pointer; both are live again after it closes', async () => {
  const css: string = readFileSync('src/styles/ribbon.css', 'utf8');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  try {
    const r = render(<Wall />);
    await flush(50);
    fireEvent.click(handle(r));
    r.rerender(<Wall late />);
    await flush(0);
    const banner = r.container.querySelector('.late-banner') as HTMLElement;
    const chip = r.container.querySelector('.rec-float') as HTMLElement;
    expect(inertOf(banner.querySelector('button'))).not.toBeNull();
    expect(inertOf(chip.querySelector('button'))).not.toBeNull();
    // The root rule: no pointer on either while the drawer is open.
    expect(getComputedStyle(banner).pointerEvents).toBe('none');
    expect(getComputedStyle(chip).pointerEvents).toBe('none');
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush(0);
    expect(inertOf(banner.querySelector('button'))).toBeNull();
    expect(inertOf(chip.querySelector('button'))).toBeNull();
    expect(getComputedStyle(banner).pointerEvents).not.toBe('none');
    expect(getComputedStyle(chip).pointerEvents).not.toBe('none');
  } finally {
    style.remove();
  }
});

it('a click outside the open Agents today panel closes it and opens nothing; the page is inert meanwhile and live after', async () => {
  function Both() {
    const [open, setOpen] = useState(true);
    return (
      <div className="stage">
        <div className="shell">
          <Rail />
          <Screens />
          {open && <AgentsToday now={Date.now()} onClose={() => setOpen(false)} />}
        </div>
        <DrawerScrim />
      </div>
    );
  }
  const r = render(<Both />);
  await flush(50);
  const card = r.container.querySelector('.lane-open') as HTMLElement;
  expect(r.container.querySelector('.agents-today')).not.toBeNull();
  expect(inertOf(card)).not.toBeNull();
  expect(inertOf(r.container.querySelector('.agents-today'))).toBeNull();
  click(r, card);
  expect(r.container.querySelector('.agents-today')).toBeNull();
  click(r, card);
  expect(opened).toEqual([]);
  await flush(LATCH_MS + 10);
  expect(inertOf(card)).toBeNull();
});

it('with the drawer open the Tools drawer and its window listeners do nothing: Escape and a press outside leave it be', async () => {
  mocks.set('wall2_build_info', () => ({ commit: 'abc1234', builtAt: '2026-11-13T16:17Z' }));
  mocks.set('wall2_spotify_status', () => ({ setup: false, signedIn: false }));
  mocks.set('wall2_sonos_summary', () => ({}));
  mocks.set('wall2_tasks_next', () => []);
  const r = render(
    <>
      <Wall />
      <ToolsDrawer />
    </>,
  );
  await flush(50);
  act(() => useToolsStore.getState().openDrawer());
  await flush(50);
  expect(useToolsStore.getState().open).toBe(true);
  fireEvent.click(handle(r));
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  // Escape belongs to the drawer alone; a press on the shield is not an outside click for the Tools drawer.
  fireEvent.pointerDown(r.container.querySelector('.drawer-scrim') as HTMLElement);
  expect(useToolsStore.getState().open).toBe(true);
  await flush(LATCH_MS + 10);
  fireEvent.click(handle(r));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  expect(useToolsStore.getState().open).toBe(true);
  await flush(LATCH_MS + 10);
  // Once the overlay is gone Escape closes the Tools drawer as before.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(useToolsStore.getState().open).toBe(false);
});
