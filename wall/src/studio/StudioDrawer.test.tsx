import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { StudioDrawer } from './StudioDrawer';
import { NOTE_MS, resetKeyLights, useKeyLights } from './store';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

type Light = { on: boolean; brightness: number; kelvin: number };
type Cell = { set: boolean; light: Light | null; word: string | null };
const on = (b = 60, k = 4400): Light => ({ on: true, brightness: b, kelvin: k });
const good = (l = on()): Cell => ({ set: true, light: l, word: null });
const silent = (word = 'no-answer'): Cell => ({ set: true, light: null, word });
const reading = (c: Cell) => (!c.set ? 'not-set-up' : (c.word ?? c.light));
let left: Cell;
let right: Cell;
let sent: Record<string, unknown>[];
let ignore: Set<string>;
let refuse: Set<string>;

beforeEach(() => {
  vi.useFakeTimers();
  resetKeyLights();
  resetTip();
  sent = [];
  ignore = new Set();
  refuse = new Set();
  left = good();
  right = good();
  mocks.set('wall2_keylights_status', () => ({ left: { set: left.set }, right: { set: right.set } }));
  mocks.set('wall2_keylights_read', () => ({ left: reading(left), right: reading(right) }));
  mocks.set('wall2_keylights_set', (args) => {
    sent.push(args ?? {});
    const out: Record<string, unknown> = { left: null, right: null };
    for (const side of args?.side === 'both' ? ['left', 'right'] : [String(args?.side)]) {
      const c = side === 'left' ? left : right;
      if (refuse.has(side)) {
        out[side] = 'failed';
        continue;
      }
      if (c.light && !ignore.has(side)) {
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

const open = async () => {
  await useKeyLights.getState().refresh();
  useKeyLights.getState().setDrawer(true);
  const view = render(
    <>
      <StudioDrawer />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const slider = (name: string) => screen.getByRole('slider', { name });
const press = async (el: HTMLElement, key: string, n = 1) => {
  for (let i = 0; i < n; i++) fireEvent.keyDown(el, { key });
  await flush();
};
const text = (el: Element) => el.getAttribute('aria-valuetext');

it('linked: one brightness and one warmth slider show the left light, with the range under the warmth track', async () => {
  await open();
  expect(slider('Both key lights brightness').getAttribute('aria-valuenow')).toBe('60');
  expect(text(slider('Both key lights brightness'))).toBe('60%');
  expect(text(slider('Both key lights warmth'))).toBe('4400 K');
  expect(screen.getByText('2900 K warm')).toBeTruthy();
  expect(screen.getByText('7000 K cool')).toBeTruthy();
  expect(screen.getByText("Range 2900 K to 7000 K, the maker's figure")).toBeTruthy();
  expect(screen.getByText('Linked').closest('button')?.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText('Not matched', { exact: false })).toBeNull();
});

it('a move sets both lights, and the number after it is what they report', async () => {
  await open();
  await press(slider('Both key lights brightness'), 'ArrowRight', 5);
  expect(sent.at(-1)).toMatchObject({ side: 'both' });
  expect(left.light?.brightness).toBe(65);
  expect(right.light?.brightness).toBe(65);
  expect(text(slider('Both key lights brightness'))).toBe('65%');
  await press(slider('Both key lights warmth'), 'ArrowLeft', 2);
  expect(text(slider('Both key lights warmth'))).toBe('4300 K');
  expect(left.light?.kelvin).toBe(4300);
});

it('the number shown is the read back, never the value dragged to', async () => {
  await open();
  ignore.add('left');
  ignore.add('right');
  await press(slider('Both key lights brightness'), 'End');
  // The lights kept their value, so the slider is back at 60 once the answer is in.
  expect(text(slider('Both key lights brightness'))).toBe('60%');
  ignore.clear();
  await press(slider('Both key lights brightness'), 'ArrowRight');
  expect(text(slider('Both key lights brightness'))).toBe('61%');
});

it('moving a slider on lights that are off turns them on', async () => {
  left = good({ on: false, brightness: 40, kelvin: 3800 });
  right = good({ on: false, brightness: 40, kelvin: 3800 });
  await open();
  await press(slider('Both key lights brightness'), 'ArrowRight');
  expect(sent.at(-1)).toMatchObject({ side: 'both', on: true, brightness: 41 });
  expect(left.light?.on).toBe(true);
});

it('clamps at the maker range: nothing below 3 percent, nothing past 7000 K', async () => {
  await open();
  await press(slider('Both key lights brightness'), 'Home');
  expect(text(slider('Both key lights brightness'))).toBe('3%');
  await press(slider('Both key lights warmth'), 'End');
  expect(text(slider('Both key lights warmth'))).toBe('7000 K');
});

it('lights that differ: the left light is shown, a note says so, and the first move sets both', async () => {
  right = good(on(45, 4700));
  await open();
  expect(text(slider('Both key lights brightness'))).toBe('60%');
  expect(screen.getByText('Not matched: the left light is shown. The first move sets both.')).toBeTruthy();
  await press(slider('Both key lights brightness'), 'ArrowRight');
  expect(sent.at(-1)).toMatchObject({ side: 'both', brightness: 61, kelvin: 4400 });
  expect(right.light).toMatchObject({ brightness: 61, kelvin: 4400 });
  expect(screen.queryByText('Not matched', { exact: false })).toBeNull();
});

it('Split sets each light by itself, Linked joins them again', async () => {
  right = good(on(45, 4700));
  await open();
  fireEvent.click(screen.getByText('Linked'));
  expect(screen.getByText('Split')).toBeTruthy();
  expect(text(slider('Left key light brightness'))).toBe('60%');
  expect(text(slider('Right key light brightness'))).toBe('45%');
  expect(text(slider('Right key light warmth'))).toBe('4700 K');
  await press(slider('Right key light brightness'), 'ArrowLeft', 5);
  expect(sent.at(-1)).toMatchObject({ side: 'right', brightness: 40 });
  expect(left.light?.brightness).toBe(60);
  expect(right.light?.brightness).toBe(40);
  fireEvent.click(screen.getByText('Split'));
  expect(screen.getByText('Linked')).toBeTruthy();
});

it('one light that does not answer splits the pair by itself, says so, and Try again reads it', async () => {
  right = silent();
  await open();
  expect(screen.getByText('Right: not answering')).toBeTruthy();
  expect(screen.getByText('Split').closest('button')?.hasAttribute('disabled')).toBe(true);
  expect(slider('Right key light brightness').getAttribute('aria-disabled')).toBe('true');
  expect(text(slider('Right key light brightness'))).toBe('not answering');
  // The other light works.
  await press(slider('Left key light brightness'), 'ArrowRight');
  expect(sent.at(-1)).toMatchObject({ side: 'left' });
  right = good();
  fireEvent.click(screen.getByText('Try again'));
  await flush();
  // Both answer again: the pair is linked again.
  expect(screen.queryByText('Right: not answering')).toBeNull();
  expect(text(slider('Both key lights brightness'))).toBe('61%');
});

it('a write the light does not take springs back and says so for five seconds', async () => {
  await open();
  fireEvent.click(screen.getByText('Linked'));
  refuse.add('left');
  await press(slider('Left key light brightness'), 'ArrowRight', 5);
  expect(text(slider('Left key light brightness'))).toBe('60%');
  expect(screen.getByText('The left key light did not take that change')).toBeTruthy();
  await flush(NOTE_MS + 10);
  expect(screen.queryByText('The left key light did not take that change')).toBeNull();
});

it('the switch turns the lights on and off from the drawer', async () => {
  await open();
  fireEvent.click(screen.getByRole('switch'));
  await flush();
  expect(sent.at(-1)).toEqual({ side: 'both', on: false });
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
});

it('carries the one quiet line for what is not built yet, and no control for it', async () => {
  await open();
  const line = screen.getByText('Presets and room lights come with a later home app change.');
  expect(line.closest('button')).toBeNull();
  expect(screen.queryByText('Back to normal')).toBeNull();
  expect(screen.queryByText('Panels')).toBeNull();
});

it('Escape and a click outside close it, a click inside does not', async () => {
  await open();
  fireEvent.pointerDown(screen.getByText('Key lights'));
  expect(useKeyLights.getState().drawer).toBe(true);
  fireEvent.pointerDown(document.body);
  expect(useKeyLights.getState().drawer).toBe(false);
  useKeyLights.getState().setDrawer(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(useKeyLights.getState().drawer).toBe(false);
});

it('closes by itself after two minutes with the pointer away, and not while it is over it', async () => {
  const { container } = await open();
  const drawer = container.ownerDocument.querySelector('.st-drawer')!;
  await flush(119_000);
  expect(useKeyLights.getState().drawer).toBe(true);
  fireEvent.pointerEnter(drawer);
  await flush(300_000);
  expect(useKeyLights.getState().drawer).toBe(true);
  fireEvent.pointerLeave(drawer);
  await flush(120_001);
  expect(useKeyLights.getState().drawer).toBe(false);
});

it('every control has a tip', async () => {
  await open();
  for (const el of [slider('Both key lights brightness'), slider('Both key lights warmth'), screen.getByText('Linked').closest('button')!, screen.getByRole('switch')]) {
    fireEvent.mouseEnter(el);
    await flush(300);
    expect((document.querySelector('.hover-tip')?.textContent ?? '').length).toBeGreaterThan(10);
    fireEvent.mouseLeave(el);
    await flush(10);
  }
});
