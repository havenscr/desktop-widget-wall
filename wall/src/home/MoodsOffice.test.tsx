import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { resetHome, useHome } from '../studio/homeStore';
import { resetLightSync } from '../studio/lightsync/store';
import { capFirst, MOODS_WHICH_KEY, Moods, NORMAL_LINE, NORMAL_OFF_TIP, NORMAL_TIP } from './Moods';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let active: string | null;

const answer = () => ({
  stale: false,
  moods: [
    { id: 'gaming', label: 'Gaming', line: 'Room 25%, panels Candles 10%, key lights off', short: 'Room 25% · Panels 10% · Candles', active: active === 'gaming' },
    { id: 'recording', label: 'Recording', line: 'Room 80%, panels 50%, key lights on', active: active === 'recording' },
  ],
  nudge: null,
  canWrite: true,
  writeBlock: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(MOODS_WHICH_KEY, 'office');
  resetHome();
  resetLightSync();
  resetTip();
  active = null;
  mocks.set('wall2_office_moods', () => answer());
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
const normal = () => document.querySelector('[data-mood="_normal"]') as HTMLElement;

it('capFirst upper-cases only the first letter', () => {
  expect(capFirst('bright and cool')).toBe('Bright and cool');
  expect(capFirst('Already')).toBe('Already');
  expect(capFirst('')).toBe('');
  expect(capFirst('3 lights')).toBe('3 lights');
});

it('the Office row has a third card, Normal, with its own line and art, and the short line wins', async () => {
  await show();
  const names = [...document.querySelectorAll('.mood-btn .mood-name')].map((n) => n.textContent);
  expect(names).toEqual(['Gaming', 'Recording', 'Normal']);
  expect(document.querySelector('.mood-more')).toBeNull();
  expect(document.querySelector('[data-mood="gaming"] .mood-sub')?.textContent).toBe('Room 25% · Panels 10% · Candles');
  expect(document.querySelector('[data-mood="recording"] .mood-sub')?.textContent).toBe('Room 80%, panels 50%, key lights on');
  expect(normal().querySelector('.mood-sub')?.textContent).toBe(NORMAL_LINE);
  expect(normal().querySelector('svg.mood-art')).not.toBeNull();
});

it('Normal is greyed and does nothing while neither Gaming nor Recording is on', async () => {
  const go = vi.fn(() => Promise.resolve());
  await show();
  useHome.setState({ goBackFromMood: go });
  expect(normal().getAttribute('aria-disabled')).toBe('true');
  expect(normal().classList.contains('off')).toBe(true);
  fireEvent.click(normal());
  await flush();
  expect(go).not.toHaveBeenCalled();
  fireEvent.mouseEnter(normal());
  await flush(300);
  expect(document.querySelector('.hover-tip')?.textContent).toBe(NORMAL_OFF_TIP);
});

it('Normal calls the As before action when a mood is on', async () => {
  active = 'gaming';
  const go = vi.fn(() => Promise.resolve());
  await show();
  useHome.setState({ goBackFromMood: go });
  expect(normal().getAttribute('aria-disabled')).toBeNull();
  fireEvent.mouseEnter(normal());
  await flush(300);
  expect(document.querySelector('.hover-tip')?.textContent).toBe(NORMAL_TIP);
  fireEvent.click(normal());
  await flush();
  expect(go).toHaveBeenCalledTimes(1);
});

it('an empty Office list shows the empty message and no lone Normal card', async () => {
  mocks.set('wall2_office_moods', () => ({ stale: false, moods: [], nudge: null, canWrite: true, writeBlock: null }));
  await show();
  expect(document.querySelectorAll('.mood-btn')).toHaveLength(0);
  expect(normal()).toBeNull();
  expect(document.body.textContent).toContain('No moods set up in the home app yet');
});

it('an Office preset named Normal applies like any other mood and keeps the injected card too', async () => {
  const applied: string[] = [];
  mocks.set('wall2_office_moods', () => ({
    stale: false,
    moods: [{ id: 'normal', label: 'Normal', line: 'Room 40%', short: 'Room 40%', active: false }],
    nudge: null,
    canWrite: true,
    writeBlock: null,
  }));
  const go = vi.fn(() => Promise.resolve());
  await show();
  useHome.setState({ goBackFromMood: go, applyMood: (id: string) => { applied.push(id); return Promise.resolve(); } } as never);
  const real = document.querySelector('[data-mood="normal"]') as HTMLElement;
  expect(real.querySelector('.mood-sub')?.textContent).toBe('Room 40%');
  expect(normal()).not.toBeNull();
  fireEvent.click(real);
  await flush();
  expect(applied).toEqual(['normal']);
  expect(go).not.toHaveBeenCalled();
});
