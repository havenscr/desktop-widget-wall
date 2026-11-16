import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetTools, useToolsStore } from '../tools/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { StudioBlock } from './StudioBlock';
import { resetHome } from './homeStore';
import { resetKeyLights, useKeyLights } from './store';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

type Cell = { set: boolean; light: { on: boolean; brightness: number; kelvin: number } | null; word: string | null };
const on = (b = 60, k = 4400) => ({ on: true, brightness: b, kelvin: k });
let left: Cell;
let right: Cell;
let sent: Record<string, unknown>[];
const good = (l = on()): Cell => ({ set: true, light: l, word: null });
const silent = (word = 'no-answer'): Cell => ({ set: true, light: null, word });
const unset = (): Cell => ({ set: false, light: null, word: null });
const reading = (c: Cell) => (!c.set ? 'not-set-up' : (c.word ?? c.light));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-14T10:00:00-08:00'));
  resetKeyLights();
  resetHome();
  mocks.set('wall2_studio', () => {
    throw 'absent';
  });
  resetTools();
  resetTip();
  sent = [];
  left = good();
  right = good();
  mocks.set('wall2_keylights_status', () => ({ left: { set: left.set }, right: { set: right.set } }));
  mocks.set('wall2_keylights_read', () => ({ left: reading(left), right: reading(right) }));
  mocks.set('wall2_keylights_set', (args) => {
    sent.push(args ?? {});
    const out: Record<string, unknown> = { left: null, right: null };
    for (const side of args?.side === 'both' ? ['left', 'right'] : [String(args?.side)]) {
      const c = side === 'left' ? left : right;
      if (c.light) {
        if (typeof args?.on === 'boolean') c.light.on = args.on;
        if (typeof args?.brightness === 'number') c.light.brightness = args.brightness;
        if (typeof args?.kelvin === 'number') c.light.kelvin = args.kelvin;
      }
      out[side] = reading(c);
    }
    return out;
  });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const show = async () => {
  const view = render(
    <>
      <StudioBlock />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const QUIET = 'Presets and room lights: the home app does not offer them here yet.';

it('day one: no address saved says where to type them, opens Tools there, and draws no Fine tune', async () => {
  left = unset();
  right = unset();
  await show();
  expect(screen.getByText('Studio lights')).toBeTruthy();
  expect(screen.getByText('Office only')).toBeTruthy();
  expect(screen.getByText('Key lights: type their addresses in Tools')).toBeTruthy();
  expect(screen.getByText(QUIET)).toBeTruthy();
  expect(screen.queryByText('Fine tune')).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByText('Open Tools'));
  expect(useToolsStore.getState().open).toBe(true);
  expect(useToolsStore.getState().focus).toBe('keylights');
});

it('both answer: the switch is on, the line says what they report, and nothing about presets is a control', async () => {
  await show();
  const sw = screen.getByRole('switch');
  expect(sw.getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Key lights 60%, 4400 K')).toBeTruthy();
  expect(screen.getByText(QUIET).closest('button')).toBeNull();
  expect(screen.getByText('Fine tune').closest('button')).toBeTruthy();
});

it('the switch turns both lights off, then both on, and shows what they report', async () => {
  await show();
  fireEvent.click(screen.getByRole('switch'));
  await flush();
  expect(sent[0]).toEqual({ side: 'both', on: false });
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText('Key lights are off')).toBeTruthy();
  fireEvent.click(screen.getByRole('switch'));
  await flush();
  expect(sent[1]).toEqual({ side: 'both', on: true });
  expect(screen.getByText('Key lights 60%, 4400 K')).toBeTruthy();
});

it('one light off counts as on: the switch turns both off', async () => {
  left = good({ on: false, brightness: 60, kelvin: 4400 });
  await show();
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('switch'));
  await flush();
  expect(sent[0]).toEqual({ side: 'both', on: false });
});

it('lights that differ are said as left and right', async () => {
  right = good(on(45, 4700));
  await show();
  expect(screen.getByText('Left 60%, 4400 K. Right 45%, 4700 K')).toBeTruthy();
});

it('one light that does not answer: its line, the other still switches', async () => {
  right = silent();
  await show();
  expect(screen.getByText('The right key light is not answering. The other one works.')).toBeTruthy();
  fireEvent.click(screen.getByRole('switch'));
  await flush();
  expect(sent[0]).toEqual({ side: 'left', on: false });
});

it('neither answers: a dashed tile that is not a switch, Check again reads again, nothing spins', async () => {
  left = silent();
  right = silent('timeout');
  const { container } = await show();
  expect(screen.getByText('Key lights are not answering')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByText('Fine tune')).toBeNull();
  expect(container.querySelector('.st-tg.warn')).toBeTruthy();
  expect(container.querySelector('[class*="spin"], [class*="pulse"]')).toBeNull();
  left = good();
  right = good();
  fireEvent.click(screen.getAllByText('Check again')[0]);
  await flush();
  expect(screen.getByText('Key lights 60%, 4400 K')).toBeTruthy();
});

it('Fine tune opens the drawer, and clicking it again closes it', async () => {
  await show();
  fireEvent.click(screen.getByText('Fine tune'));
  expect(screen.getByLabelText('Studio lights', { selector: 'section' })).toBeTruthy();
  expect(useKeyLights.getState().drawer).toBe(true);
  fireEvent.click(screen.getByText('Fine tune'));
  expect(useKeyLights.getState().drawer).toBe(false);
});

it('every control has a hover tip', async () => {
  await show();
  for (const [text, want] of [
    ['Fine tune', 'Opens the sliders'],
    ['Key lights', 'Turns both key lights off'],
  ] as const) {
    fireEvent.mouseEnter(screen.getByText(text).closest('button')!);
    await flush(300);
    expect(document.querySelector('.hover-tip')?.textContent ?? '').toContain(want);
    fireEvent.mouseLeave(screen.getByText(text).closest('button')!);
    await flush(10);
  }
});

it('reads when it opens and every 30 seconds, and not while the page is hidden', async () => {
  const reads = vi.fn(() => ({ left: reading(left), right: reading(right) }));
  mocks.set('wall2_keylights_read', reads);
  await show();
  expect(reads).toHaveBeenCalledTimes(1);
  await flush(30_000);
  expect(reads).toHaveBeenCalledTimes(2);
  await flush(30_000);
  expect(reads).toHaveBeenCalledTimes(3);
  // Hidden: no read at all.
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const n = reads.mock.calls.length;
  await flush(120_000);
  expect(reads.mock.calls.length).toBe(n);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
  expect(reads.mock.calls.length).toBe(n + 1);
});

it('one side with no address is a setup to do: its own plain line, no warning tile, Open Tools beside Fine tune', async () => {
  right = unset();
  const { container } = await show();
  expect(screen.getByText('The right key light is not set up. Add it in Tools.')).toBeTruthy();
  expect(screen.queryByText(/not answering/)).toBeNull();
  expect(container.querySelector('.st-tg.warn')).toBeNull();
  expect(container.querySelector('.st-sum.amber')).toBeNull();
  expect(screen.getByText('Fine tune')).toBeTruthy();
  fireEvent.click(screen.getByText('Open Tools'));
  expect(useToolsStore.getState().focus).toBe('keylights');
  // The light that is set up still switches.
  fireEvent.click(screen.getByRole('switch'));
  await flush();
  expect(sent[0]).toEqual({ side: 'left', on: false });
});

it('only one light set up and it does not answer: the block names that light', async () => {
  right = unset();
  left = silent();
  await show();
  expect(screen.getByText('The left key light is not answering. Check it is on and on this network.')).toBeTruthy();
  // The tile says it too, once, and Check again is there.
  expect(screen.getAllByText('The left key light is not answering')).toHaveLength(1);
  expect(screen.queryByText('Neither light answered', { exact: false })).toBeNull();
  expect(screen.getAllByText('Check again')[0]).toBeTruthy();
});

it('a write the lights answered with "busy" shows no line on the block', async () => {
  await show();
  mocks.set('wall2_keylights_set', () => ({ left: 'busy', right: 'busy' }));
  fireEvent.click(screen.getByRole('switch'));
  await flush();
  expect(screen.queryByText(/did not take/)).toBeNull();
  expect(screen.getByText('Key lights 60%, 4400 K')).toBeTruthy();
});
