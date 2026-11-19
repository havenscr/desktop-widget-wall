import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { StudioDrawer } from './StudioDrawer';
import { resetHome } from './homeStore';
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
let gate: Promise<void> | null;
/** The side whose writes the gate holds; null holds every write. */
let gateSide: string | null = null;
/** Holds every write's answer (or only one side's) until the returned function is called. */
const hold = (side: string | null = null) => {
  let open!: () => void;
  gate = new Promise<void>((r) => (open = r));
  gateSide = side;
  return () => {
    gate = null;
    gateSide = null;
    open();
  };
};
/** A light that reports a little off what it was asked for, as the real one rounds. */
let round: number;

beforeEach(() => {
  vi.useFakeTimers();
  resetKeyLights();
  resetHome();
  mocks.set('wall2_studio', () => {
    throw 'absent';
  });
  resetTip();
  sent = [];
  ignore = new Set();
  refuse = new Set();
  gate = null;
  gateSide = null;
  round = 0;
  left = good();
  right = good();
  mocks.set('wall2_keylights_status', () => ({ left: { set: left.set }, right: { set: right.set } }));
  mocks.set('wall2_keylights_read', () => ({ left: reading(left), right: reading(right) }));
  mocks.set('wall2_keylights_set', async (args) => {
    sent.push(args ?? {});
    if (gate && (gateSide === null || args?.side === gateSide)) await gate;
    const out: Record<string, unknown> = { left: null, right: null };
    for (const side of args?.side === 'both' ? ['left', 'right'] : [String(args?.side)]) {
      const c = side === 'left' ? left : right;
      if (refuse.has(side)) {
        out[side] = 'failed';
        continue;
      }
      if (c.light && !ignore.has(side)) {
        if (typeof args?.on === 'boolean') c.light.on = args.on;
        if (typeof args?.brightness === 'number') c.light.brightness = args.brightness - round;
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
  fireEvent.keyUp(el, { key });
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

const thumbAt = (name: string): number => parseFloat((slider(name).querySelector('.st-th') as HTMLElement).style.left);
const numberBeside = (name: string): string => slider(name).parentElement?.querySelector('.st-val')?.textContent ?? '';
const frac = (v: number) => ((v - 3) / 97) * 100;

it('the number and the ARIA value are what the light reported, also while a write is out; only the thumb says where it was asked to go', async () => {
  await open();
  const name = 'Both key lights brightness';
  const release = hold();
  fireEvent.keyDown(slider(name), { key: 'ArrowRight' });
  fireEvent.keyDown(slider(name), { key: 'ArrowRight' });
  await flush();
  // In flight: the thumb is at 62, the light still reports 60.
  expect(thumbAt(name)).toBeCloseTo(frac(62), 1);
  expect(numberBeside(name)).toBe('60%');
  expect(slider(name).getAttribute('aria-valuenow')).toBe('60');
  expect(text(slider(name))).toBe('setting to 62%, the light reports 60%');
  release();
  fireEvent.keyUp(slider(name), { key: 'ArrowRight' });
  await flush();
  expect(numberBeside(name)).toBe('62%');
  expect(thumbAt(name)).toBeCloseTo(frac(62), 1);
  expect(text(slider(name))).toBe('62%');
});

it('lights that keep their value: during the write the thumb is where it was asked, after it the thumb is back at what they report', async () => {
  await open();
  const name = 'Both key lights brightness';
  ignore.add('left');
  ignore.add('right');
  const release = hold();
  fireEvent.keyDown(slider(name), { key: 'End' });
  fireEvent.keyUp(slider(name), { key: 'End' });
  await flush();
  expect(thumbAt(name)).toBeCloseTo(100, 1);
  expect(numberBeside(name)).toBe('60%');
  release();
  await flush();
  expect(thumbAt(name)).toBeCloseTo(frac(60), 1);
  expect(text(slider(name))).toBe('60%');
  ignore.clear();
  await press(slider(name), 'ArrowRight');
  expect(text(slider(name))).toBe('61%');
});

/** A pointer drag with a real pointer: down, move, a held answer, the answer, up (or up first). */
const dragTrack = (name: string) => {
  const el = slider(name);
  el.getBoundingClientRect = () => ({ left: 0, right: 1000, top: 0, bottom: 26, width: 1000, height: 26, x: 0, y: 0, toJSON: () => ({}) });
  return el;
};
const px = (v: number) => (frac(v) / 100) * 1000;

it('a pointer drag whose answer comes before the button is up: the thumb follows the pointer, the number is what the light reports, and on letting go the thumb goes to the report at once', async () => {
  round = 1;
  await open();
  const name = 'Both key lights brightness';
  const el = dragTrack(name);
  const release = hold();
  fireEvent.pointerDown(el, { clientX: px(53), button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: px(55), pointerId: 1 });
  await flush();
  expect(thumbAt(name)).toBeCloseTo(frac(55), 0);
  expect(numberBeside(name)).toBe('60%');
  release();
  await flush();
  // The write is answered while the button is still down: the light reports 54 for the 55 asked.
  expect(numberBeside(name)).toBe('54%');
  expect(slider(name).getAttribute('aria-valuenow')).toBe('54');
  expect(thumbAt(name)).toBeCloseTo(frac(55), 0);
  fireEvent.pointerUp(el, { pointerId: 1 });
  await flush();
  expect(thumbAt(name)).toBeCloseTo(frac(54), 0);
  expect(text(slider(name))).toBe('54%');
});

it('a pointer drag let go while a write is still out: the thumb stays where it was asked until the answer, then goes to the report', async () => {
  round = 2;
  await open();
  const name = 'Both key lights brightness';
  const el = dragTrack(name);
  const release = hold();
  fireEvent.pointerDown(el, { clientX: px(70), button: 0, pointerId: 1 });
  await flush();
  fireEvent.pointerUp(el, { pointerId: 1 });
  await flush();
  expect(thumbAt(name)).toBeCloseTo(frac(70), 0);
  expect(numberBeside(name)).toBe('60%');
  release();
  await flush();
  expect(numberBeside(name)).toBe('68%');
  expect(thumbAt(name)).toBeCloseTo(frac(68), 0);
});

it('split: a released slider goes to the report at once while the other light\'s write is still out', async () => {
  round = 2;
  await open();
  fireEvent.click(screen.getByText('Linked'));
  const name = 'Right key light brightness';
  const el = dragTrack(name);
  const releaseLeft = hold('left');
  // A write to the left light is out and held.
  await press(slider('Left key light brightness'), 'ArrowRight', 3);
  expect(sent.at(-1)).toMatchObject({ side: 'left' });
  // The right slider is dragged and let go: its own write is answered, the left one is still waiting.
  fireEvent.pointerDown(el, { clientX: px(70), button: 0, pointerId: 1 });
  await flush();
  fireEvent.pointerUp(el, { pointerId: 1 });
  await flush();
  expect(sent.at(-1)).toMatchObject({ side: 'right' });
  expect(numberBeside(name)).toBe('68%');
  expect(thumbAt(name)).toBeCloseTo(frac(68), 0);
  // The left slider, whose own write is out, still holds its asked place.
  expect(thumbAt('Left key light brightness')).toBeCloseTo(frac(63), 0);
  releaseLeft();
  await flush();
});

it('a cancelled pointer lets go as an up does', async () => {
  await open();
  const name = 'Both key lights brightness';
  const el = dragTrack(name);
  fireEvent.pointerDown(el, { clientX: px(80), button: 0, pointerId: 1 });
  await flush();
  fireEvent.pointerCancel(el, { pointerId: 1 });
  await flush();
  expect(thumbAt(name)).toBeCloseTo(frac(80), 0);
  expect(numberBeside(name)).toBe('80%');
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
  const line = screen.getByText('Presets and room lights: the home app does not offer them here yet.');
  expect(line.closest('button')).toBeNull();
  expect(screen.queryByText('As before')).toBeNull();
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

it('a side with no address is not set up, not "not answering": no Try again, no split, and Open Tools', async () => {
  right = { set: false, light: null, word: null };
  await open();
  expect(screen.queryByText(/not answering/)).toBeNull();
  expect(screen.queryByText('Try again')).toBeNull();
  // One light on its own has nothing to link: no Linked or Split chip, one pair of sliders for it.
  expect(screen.queryByText('Linked')).toBeNull();
  expect(screen.queryByText('Split')).toBeNull();
  expect(screen.getByText('The right key light is not set up.')).toBeTruthy();
  await press(slider('Left key light brightness'), 'ArrowRight');
  expect(sent.at(-1)).toMatchObject({ side: 'left' });
  fireEvent.click(screen.getByText('Open Tools'));
  const { useToolsStore } = await import('../tools/store');
  expect(useToolsStore.getState().focus).toBe('keylights');
});

it('a light with an address that is silent still splits the pair, while the one without an address does not', async () => {
  left = silent();
  right = { set: false, light: null, word: null };
  await open();
  expect(screen.getByText('Left: not answering')).toBeTruthy();
  expect(screen.getByText('Right: not set up')).toBeTruthy();
  expect(screen.getAllByText('Try again')).toHaveLength(1);
});

it('a write answered with "slow-down" or "busy" leaves what is shown alone and says nothing', async () => {
  await open();
  mocks.set('wall2_keylights_set', () => ({ left: 'busy', right: 'slow-down' }));
  await press(slider('Both key lights brightness'), 'ArrowRight');
  expect(text(slider('Both key lights brightness'))).toBe('60%');
  expect(useKeyLights.getState().note).toBeNull();
  expect(useKeyLights.getState().left).toEqual(on());
});

it('takes focus when it opens, keeps Tab inside, and gives focus back to the control that opened it', async () => {
  const opener = document.createElement('button');
  opener.textContent = 'Fine tune';
  document.body.appendChild(opener);
  opener.focus();
  await useKeyLights.getState().refresh();
  useKeyLights.getState().setDrawer(true);
  const view = render(<StudioDrawer />);
  await flush();
  const close = screen.getByLabelText('Close Studio lights');
  expect(document.activeElement).toBe(close);
  // Shift+Tab from the first control wraps to the last, Tab from the last wraps to the first.
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  const last = [...document.querySelectorAll<HTMLElement>('.st-drawer button:not(:disabled), .st-drawer [tabindex="0"]')].at(-1)!;
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(close);
  // Closing returns focus to what opened it.
  view.unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

it('does not take focus back from a control the pointer already moved it to', async () => {
  const opener = document.createElement('button');
  const other = document.createElement('button');
  document.body.append(opener, other);
  opener.focus();
  await useKeyLights.getState().refresh();
  useKeyLights.getState().setDrawer(true);
  const view = render(<StudioDrawer />);
  await flush();
  other.focus();
  view.unmount();
  expect(document.activeElement).toBe(other);
  opener.remove();
  other.remove();
});
