import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { resetHome, useHome } from '../studio/homeStore';
import { resetLightSync, useLightSync } from '../studio/lightsync/store';
import { floorTip, MOODS_WHICH_KEY, Moods, NUDGE_TIPS } from './Moods';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let nudge: { mood: string; level: number; floor: number; step: number } | null;
let active: string | null;
let canWrite: boolean;
let readWord: string | null;
let calls: { command: string; args?: Record<string, unknown> }[];

const answer = () => ({
  stale: false,
  moods: [
    { id: 'focus', label: 'Focus', line: 'Room 80%, panels Daylight 40%', active: active === 'focus' },
    { id: 'gaming', label: 'Gaming', line: 'Room 25%', active: active === 'gaming' },
  ],
  nudge: active ? nudge : null,
  canWrite,
  writeBlock: canWrite ? null : 'not-set-up',
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(MOODS_WHICH_KEY, 'office');
  resetHome();
  resetLightSync();
  resetTip();
  nudge = { mood: 'focus', level: 62, floor: 45, step: 10 };
  active = 'focus';
  canWrite = true;
  readWord = null;
  calls = [];
  mocks.set('wall2_office_moods', () => {
    if (readWord) throw readWord;
    return answer();
  });
  mocks.set('wall2_office_mood_nudge', (args) => {
    calls.push({ command: 'wall2_office_mood_nudge', args });
    nudge = nudge && { ...nudge, level: Math.max(0, Math.min(100, nudge.level + (args?.dir === 'up' ? 10 : -10))) };
    return answer();
  });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetHome();
  resetLightSync();
  resetTip();
});

const show = async () => {
  const view = render(
    <>
      <Moods />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const btn = (dir: 'up' | 'down') => document.querySelector(`[data-nudge-dir="${dir}"]`) as HTMLElement;
const level = () => document.querySelector('.nudge-lv')?.textContent;
const tipOf = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(300);
  return document.querySelector('.hover-tip')?.textContent ?? '';
};

it('the bar sits on the active office card only, beside the card button and not inside it, and replaces the preset line', async () => {
  await show();
  expect(document.querySelectorAll('[data-nudge="bar"]')).toHaveLength(1);
  const cell = document.querySelector('[data-nudge="bar"]')!.closest('.mood-cell')!;
  expect(cell.querySelector('.mood-btn')?.getAttribute('data-mood')).toBe('focus');
  expect(cell.querySelector('.mood-btn')?.contains(document.querySelector('[data-nudge="bar"]'))).toBe(false);
  expect(cell.querySelector('.mood-sub')).toBeNull();
  expect(document.querySelector('[data-mood="gaming"] .mood-sub')?.textContent).toBe('Room 25%');
  expect(level()).toBe('62%');
  expect(btn('down').getAttribute('aria-label')).toBe('Dimmer');
  expect(btn('up').getAttribute('aria-label')).toBe('Brighter');
});

it('no bar when no mood is on, when the answer has no nudge, and never on Condo', async () => {
  active = null;
  const first = await show();
  expect(document.querySelector('[data-nudge="bar"]')).toBeNull();
  expect(document.querySelectorAll('.mood-cell').length).toBeGreaterThan(0);
  first.unmount();
  resetHome();
  active = 'focus';
  nudge = null;
  const { unmount } = await show();
  expect(document.querySelector('[data-nudge="bar"]')).toBeNull();
  unmount();
  localStorage.setItem(MOODS_WHICH_KEY, 'condo');
  mocks.set('wall2_moods', () => [{ id: 'day', label: 'Day' }]);
  await show();
  expect(document.querySelector('[data-nudge="bar"]')).toBeNull();
  expect(document.querySelector('.mood-cell')).toBeNull();
});

it('a press sends one nudge call with only the direction and shows the new level', async () => {
  await show();
  fireEvent.click(btn('up'));
  await flush(50);
  expect(calls).toEqual([{ command: 'wall2_office_mood_nudge', args: { dir: 'up' } }]);
  expect(level()).toBe('72%');
  fireEvent.click(btn('down'));
  await flush(50);
  expect(calls[1].args).toEqual({ dir: 'down' });
  expect(level()).toBe('62%');
  expect(document.querySelector('[data-mood="focus"]')?.classList.contains('working')).toBe(false);
});

it('at the floor the dimmer is disabled with the floor tip and the word Floor; brighter still works', async () => {
  nudge = { mood: 'focus', level: 45, floor: 45, step: 10 };
  await show();
  expect(level()).toBe('Floor');
  expect(btn('down').getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(btn('down'));
  await flush(50);
  expect(calls).toHaveLength(0);
  expect(await tipOf(btn('down'))).toBe(floorTip(45));
  expect(btn('up').getAttribute('aria-disabled')).toBeNull();
  fireEvent.click(btn('up'));
  await flush(50);
  expect(calls).toHaveLength(1);
});

it('at full the brighter button is disabled and says Max; dimmer works', async () => {
  nudge = { mood: 'focus', level: 100, floor: 45, step: 10 };
  await show();
  expect(level()).toBe('Max');
  expect(btn('up').getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(btn('up'));
  await flush(50);
  expect(calls).toHaveLength(0);
  fireEvent.click(btn('down'));
  await flush(50);
  expect(calls).toHaveLength(1);
});

it('home offline: the last level is kept faded, both buttons are dashed and do nothing, with the not answering tip', async () => {
  await show();
  readWord = 'unreachable';
  await act(async () => {
    await useHome.getState().readMoods();
  });
  await flush();
  expect(level()).toBe('62%');
  expect(document.querySelector('.nudge-lv')?.classList.contains('faded')).toBe(true);
  expect(btn('down').classList.contains('off')).toBe(true);
  expect(btn('up').classList.contains('off')).toBe(true);
  fireEvent.click(btn('up'));
  fireEvent.click(btn('down'));
  await flush(50);
  expect(calls).toHaveLength(0);
  expect(await tipOf(btn('up'))).toBe(NUDGE_TIPS.offline);
});

it('a PC that may not write gets the dashed look and nothing is sent', async () => {
  canWrite = false;
  await show();
  expect(btn('up').classList.contains('off')).toBe(true);
  fireEvent.click(btn('up'));
  await flush(50);
  expect(calls).toHaveLength(0);
  expect((await tipOf(btn('up'))).length).toBeGreaterThan(0);
});

it('while music sync is driving the lights both buttons are disabled with the sync tip', async () => {
  useLightSync.setState({ starting: true });
  await show();
  expect(btn('up').getAttribute('aria-disabled')).toBe('true');
  expect(btn('down').getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(btn('up'));
  await flush(50);
  expect(calls).toHaveLength(0);
  expect(await tipOf(btn('down'))).toBe(NUDGE_TIPS.sync);
});

it('the bar reads sync status itself: disables when sync runs, re-enables when it stops', async () => {
  let running = true;
  mocks.set('wall2_lightsync_status', () => ({ paired: true, bridgeChanged: false, running, starting: false, lastError: null, stoppedHueSync: false }));
  expect(useLightSync.getState().status).toBeNull();
  await show();
  await flush(50);
  expect(btn('up').getAttribute('aria-disabled')).toBe('true');
  expect(btn('down').getAttribute('aria-disabled')).toBe('true');
  running = false;
  await flush(2500);
  expect(btn('up').getAttribute('aria-disabled')).not.toBe('true');
  expect(btn('down').getAttribute('aria-disabled')).not.toBe('true');
});

it('sync started outside is noticed while the bar stays on Home', async () => {
  let running = false;
  mocks.set('wall2_lightsync_status', () => ({ paired: true, bridgeChanged: false, running, starting: false, lastError: null, stoppedHueSync: false }));
  await show();
  await flush(50);
  expect(btn('up').getAttribute('aria-disabled')).not.toBe('true');
  running = true;
  await flush(2500);
  expect(btn('up').getAttribute('aria-disabled')).toBe('true');
});

it('while a write is out the pressed button spins and a second click is ignored', async () => {
  let release: () => void = () => undefined;
  mocks.set('wall2_office_mood_nudge', (args) => {
    calls.push({ command: 'wall2_office_mood_nudge', args });
    return new Promise((r) => (release = () => r(answer())));
  });
  await show();
  fireEvent.click(btn('up'));
  await flush();
  expect(btn('up').querySelector('.nudge-spin')).not.toBeNull();
  expect(btn('down').querySelector('.nudge-spin')).toBeNull();
  fireEvent.click(btn('down'));
  fireEvent.click(btn('up'));
  await flush(50);
  expect(calls).toHaveLength(1);
  release();
  await flush(50);
  expect(btn('up').querySelector('.nudge-spin')).toBeNull();
});

it('a refused press shows amber words in the heading line and reads again', async () => {
  mocks.set('wall2_office_mood_nudge', () => {
    throw 'at-floor';
  });
  await show();
  fireEvent.click(btn('down'));
  await flush(50);
  expect(document.querySelector('.moods-head .warn-text')?.textContent).toContain('At the floor');
});
