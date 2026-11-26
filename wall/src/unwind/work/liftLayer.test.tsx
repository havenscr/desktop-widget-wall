// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summary } from '../../agents/fixtures';
import { resetAgents } from '../../agents/useAgents';
import { mocks } from '../../bridge/tauri';
import { useFocusStore } from '../../focus/store';
import { useFixedClock, usePacificTime } from '../../ribbon/testZone';
import { DrawerScrim, resetScrim } from '../../ribbon/DrawerScrim';
import { Frame } from '../../screens/Frame';
import { resetWatch } from '../watch/store';
import { useWatchRest } from '../watch/rest';
import { useWorkLayerStore } from './layerStore';
import { inLayerZone, LAYER_BAND_HYSTERESIS_PX, LAYER_BAND_PX, LAYER_CLOSE_MS, SUPPRESS_SELECTOR } from './useWorkLayer';

usePacificTime();
const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const iso = (hm: string) => new Date(t(hm)).toISOString();

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const layerEl = () => document.querySelector<HTMLElement>('.u-work')!;
const main = () => document.querySelector<HTMLElement>('.main')!;
const css = (f: string) => (readFileSync(new URL(f, import.meta.url), 'utf8') as string).replace(/\r\n/g, '\n');
const SHEET = '../../styles/unwind-work.css';

// A 680 tall frame at the top of the page, so the bottom band is y 540 to 680.
function sizeFrame() {
  Object.defineProperty(main(), 'offsetHeight', { configurable: true, value: 680 });
  main().getBoundingClientRect = () => ({ top: 0, bottom: 680, left: 0, right: 2416, width: 2416, height: 680, x: 0, y: 0, toJSON: () => ({}) });
}

beforeEach(() => {
  resetWatch();
  resetAgents();
  resetScrim();
  useWatchRest.setState({ rest: false, cardHeld: false });
  useWorkLayerStore.setState({ shown: false, held: false, panel: false });
  mocks.set('wall2_meet_day', () => ({
    accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
    events: ['a', 'b', 'c', 'd'].map((k) => ({ key: `d-${k}`, accountId: 'work', title: `Meeting ${k}`, start: iso('13:00'), end: iso('14:00'), canJoin: false, canOpen: true, isLive: false })),
  }));
  mocks.set('wall2_omni_summary', () => summary({ day: [] }));
});
afterEach(() => {
  mocks.clear();
  resetAgents();
  resetScrim();
  useFocusStore.setState({ sessions: [] });
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(t('10:24'));
});
afterEach(() => vi.useRealTimers());

describe('the hover answers only in the bottom band', () => {
  it('a pointer high on the frame does nothing, the band shows the layer, and leaving the band hides it after 1.5 s', async () => {
    render(<Frame place="unwind">x</Frame>);
    await flush();
    sizeFrame();
    fireEvent.pointerMove(main(), { clientY: 200 });
    await flush(50);
    expect(useWorkLayerStore.getState().shown).toBe(false);
    fireEvent.pointerMove(main(), { clientY: 680 - LAYER_BAND_PX + 5 });
    await flush(50);
    expect(useWorkLayerStore.getState().shown).toBe(true);
    fireEvent.pointerMove(main(), { clientY: 200 });
    await flush(LAYER_CLOSE_MS - 100);
    expect(useWorkLayerStore.getState().shown).toBe(true);
    await flush(200);
    expect(useWorkLayerStore.getState().shown).toBe(false);
  });
  it('the timeline, its panels and the lifted row count as the zone even above the band', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ top: 0, bottom: 680, height: 680 }) as DOMRect;
    Object.defineProperty(el, 'offsetHeight', { value: 680 });
    expect(inLayerZone(el, 100, 100, el)).toBe(false);
    for (const cls of ['u-work', 'day-drawer', 'agents-today', 'u-foot', 'u-office-slot']) {
      const e = document.createElement('div');
      e.className = cls;
      const kid = document.createElement('span');
      e.append(kid);
      expect(inLayerZone(el, 100, 100, kid)).toBe(true);
    }
  });
  it('the gap under a lifted box is inside the zone, and the band edge has a little hysteresis', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ top: 0, bottom: 680, height: 680 }) as DOMRect;
    Object.defineProperty(el, 'offsetHeight', { value: 680 });
    const row = document.createElement('div');
    row.className = 'u-foot';
    row.getBoundingClientRect = () => ({ left: 0, right: 470, top: 440, bottom: 558, width: 470, height: 118 }) as DOMRect;
    el.append(row);
    // Over the lifted box's column, between its top and the band: held. Beside it, the same height: not.
    expect(inLayerZone(el, 200, 500, el)).toBe(true);
    expect(inLayerZone(el, 900, 500, el)).toBe(false);
    expect(inLayerZone(el, 200, 430, el)).toBe(false);
    // The band's edge: in at 140 px, and once in it holds a little higher.
    const edge = 680 - LAYER_BAND_PX;
    expect(inLayerZone(el, 900, edge - 1, el)).toBe(false);
    expect(inLayerZone(el, 900, edge, el)).toBe(true);
    expect(inLayerZone(el, 900, edge - LAYER_BAND_HYSTERESIS_PX + 1, el, true)).toBe(true);
    expect(inLayerZone(el, 900, edge - LAYER_BAND_HYSTERESIS_PX - 1, el, true)).toBe(false);
  });
});

describe('the row lifts with the layer', () => {
  it('the frame marks the lifted state while the layer shows and clears it when it closes', async () => {
    render(<Frame place="unwind">x</Frame>);
    await flush();
    sizeFrame();
    expect(main().hasAttribute('data-work-shown')).toBe(false);
    fireEvent.pointerMove(main(), { clientY: 650 });
    await flush(50);
    expect(main().hasAttribute('data-work-shown')).toBe(true);
    fireEvent.pointerLeave(main());
    await flush(LAYER_CLOSE_MS + 50);
    expect(main().hasAttribute('data-work-shown')).toBe(false);
  });
  it('the stylesheet lifts the row 116 px by transform alone, 250 ms up and 400 ms down, and fades the day line', () => {
    const s = css(SHEET);
    const up = s.slice(s.indexOf("[data-work-shown] .u-foot"), s.indexOf('}', s.indexOf("[data-work-shown] .u-foot")));
    expect(up).toContain('translateY(-116px)');
    expect(up).toMatch(/transition: transform 250ms ease/);
    const rest = s.slice(s.indexOf(".main[data-place='unwind'] .u-foot,\n.main[data-place='unwind'] .u-office-slot {"));
    expect(rest.slice(0, rest.indexOf('}'))).toMatch(/transition: transform 400ms ease/);
    expect(s).toMatch(/\.main\[data-work-shown\] \.rib-line \{\s*opacity: 0;\s*transition: opacity 250ms ease/);
    expect(s).toMatch(/\.rib-line \{[^}]*transition: opacity 400ms ease/);
  });
});

describe('the layer own panel and drawer', () => {
  it('only the Day drawer and Agents today are exempt, by class, in the script and in the stylesheet', () => {
    expect(SUPPRESS_SELECTOR).not.toContain('.u-work *');
    for (const sel of [SUPPRESS_SELECTOR, css(SHEET)]) {
      expect(sel).toContain(':not(.day-drawer)');
      expect(sel).toContain(':not(.agents-today)');
      expect(sel).toContain(':not(.u-keys *)');
      expect(sel).not.toContain(':not(.u-work *)');
    }
  });
  it('an unrelated dialog or menu inside the layer still takes it down; the layer own overlays do not', async () => {
    render(<Frame place="unwind">x</Frame>);
    await flush();
    sizeFrame();
    fireEvent.pointerMove(main(), { clientY: 650 });
    await flush(100);
    expect(useWorkLayerStore.getState().shown).toBe(true);
    for (const own of ['<div class="agents-today" role="dialog"><div role="dialog" class="at-cal"></div></div>', '<div class="day-drawer" role="dialog"><div role="menu"></div></div>']) {
      layerEl().insertAdjacentHTML('beforeend', own);
      await flush(50);
      expect(useWorkLayerStore.getState().shown).toBe(true);
      layerEl().lastElementChild!.remove();
      await flush(50);
    }
    for (const other of ['<div role="dialog"></div>', '<div role="menu"></div>']) {
      layerEl().insertAdjacentHTML('beforeend', other);
      await flush(50);
      expect(useWorkLayerStore.getState().shown).toBe(false);
      layerEl().lastElementChild!.remove();
      await flush(50);
      expect(useWorkLayerStore.getState().shown).toBe(true);
    }
  });
  it('a click on the sessions line opens Agents today, the layer is held up and stays after the pointer leaves', async () => {
    mocks.set('wall2_omni_summary', () => summary({ day: [{ lane: 'a1b2c3d4-0001', start: iso('09:42'), end: null, kind: 'run' }] }));
    render(<Frame place="unwind">x</Frame>);
    await flush();
    sizeFrame();
    fireEvent.pointerMove(main(), { clientY: 650 });
    await flush(100);
    const cell = document.querySelector<HTMLElement>('.u-work .agent-row .ac, .u-work .ag-line')!;
    expect(cell).not.toBeNull();
    fireEvent.click(cell);
    await flush(50);
    expect(document.querySelector('.u-work .agents-today')).not.toBeNull();
    expect(useWorkLayerStore.getState().panel).toBe(true);
    expect(document.querySelector(SUPPRESS_SELECTOR)).toBeNull();
    fireEvent.pointerLeave(main());
    await flush(LAYER_CLOSE_MS + 600);
    expect(useWorkLayerStore.getState().shown).toBe(true);
    expect(document.querySelector('.u-work .agents-today')).not.toBeNull();
    fireEvent.keyDown(document.querySelector('.agents-today')!, { key: 'Escape' });
    await flush(LAYER_CLOSE_MS + 600);
    expect(document.querySelector('.agents-today')).toBeNull();
    expect(useWorkLayerStore.getState().panel).toBe(false);
  });
  it('a click on the more chip opens the Day drawer and holds the layer', async () => {
    render(<Frame place="unwind">x</Frame>);
    await flush();
    sizeFrame();
    fireEvent.pointerMove(main(), { clientY: 650 });
    await flush(100);
    const fold = document.querySelector<HTMLElement>('.u-work .ev.fold')!;
    expect(fold).not.toBeNull();
    fireEvent.click(fold);
    await flush(50);
    expect(document.querySelector('.u-work .day-drawer')).not.toBeNull();
    expect(useWorkLayerStore.getState().panel).toBe(true);
    fireEvent.pointerLeave(main());
    await flush(LAYER_CLOSE_MS + 600);
    expect(useWorkLayerStore.getState().shown).toBe(true);
  });
  it('the hold clears on an outside press, on leaving the place and on unmount', async () => {
    mocks.set('wall2_omni_summary', () => summary({ day: [{ lane: 'a1b2c3d4-0001', start: iso('09:42'), end: null, kind: 'run' }] }));
    const openPanel = async (ui: ReturnType<typeof render>) => {
      await flush();
      sizeFrame();
      fireEvent.pointerMove(main(), { clientY: 650 });
      await flush(100);
      fireEvent.click(document.querySelector<HTMLElement>('.u-work .agent-row .ac, .u-work .ag-line')!);
      await flush(50);
      expect(useWorkLayerStore.getState().panel).toBe(true);
      return ui;
    };
    // An outside press: the scrim closes the panel.
    const a = render(
      <>
        <Frame place="unwind">x</Frame>
        <DrawerScrim />
      </>,
    );
    await openPanel(a);
    fireEvent.pointerDown(document.querySelector('.drawer-scrim')!);
    await flush(50);
    expect(document.querySelector('.agents-today')).toBeNull();
    expect(useWorkLayerStore.getState().panel).toBe(false);
    a.unmount();
    resetScrim();
    // Leaving the place.
    const b = render(<Frame place="unwind">x</Frame>);
    await openPanel(b);
    b.rerender(<Frame place="work">x</Frame>);
    await flush(50);
    expect(useWorkLayerStore.getState().panel).toBe(false);
    b.unmount();
    // Unmount.
    const c = render(<Frame place="unwind">x</Frame>);
    await openPanel(c);
    c.unmount();
    expect(useWorkLayerStore.getState().panel).toBe(false);
  });
  it('the keys row hold survives the timeline ribbon remounting and closing its panel', async () => {
    render(<Frame place="unwind">x</Frame>);
    await flush();
    sizeFrame();
    fireEvent.pointerMove(main(), { clientY: 650 });
    await flush(100);
    act(() => useWorkLayerStore.setState({ held: true }));
    // The ribbon leaves (layer closes) and comes back: the keys hold is not written to.
    fireEvent.pointerLeave(main());
    await flush(LAYER_CLOSE_MS + 700);
    expect(useWorkLayerStore.getState().shown).toBe(true);
    expect(useWorkLayerStore.getState().held).toBe(true);
    fireEvent.click(document.querySelector<HTMLElement>('.u-work .ev.fold')!);
    await flush(50);
    expect(useWorkLayerStore.getState().panel).toBe(true);
    fireEvent.keyDown(document.querySelector('.day-drawer')!, { key: 'Escape' });
    await flush(LAYER_CLOSE_MS + 700);
    expect(useWorkLayerStore.getState().panel).toBe(false);
    expect(useWorkLayerStore.getState().held).toBe(true);
    expect(useWorkLayerStore.getState().shown).toBe(true);
  });
});
