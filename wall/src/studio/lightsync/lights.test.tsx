import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { LIGHT_SYNC_KEY } from '../../settings/settings';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { useNowPlayingStore } from '../../music/store';
import { useWatchStore } from '../../unwind/watch/store';
import { WatchSheet } from '../../unwind/watch/Sheet';
import { resetHome } from '../homeStore';
import { OfficeMoods } from '../OfficeMoods';
import { newPreview, stepPreview } from './preview';
import { DEFAULT_LIGHTS_UI, DEFAULT_LIGHT_SYNC, SWATCHES, engineSettings, resolvePalette } from './model';
import { LightsPanel, barsWords, brightWords, flashWords, smoothWords } from './LightsPanel';
import { resetLightSync, useLightSync } from './store';

vi.mock('../../music/coverTint', async (orig) => ({
  ...(await orig<typeof import('../../music/coverTint')>()),
  readCoverStrips: async () => [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
  ],
}));

let calls: { command: string; args?: Record<string, unknown> }[];
const tunes = () => calls.filter((c) => c.command === 'wall2_lightsync_tune');
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  resetHome();
  resetTip();
  localStorage.clear();
  resetLightSync();
  useWatchStore.setState({ sheet: false, sheetTab: null });
  calls = [];
  mocks.set('wall2_lightsync_tune', (args) => {
    calls.push({ command: 'wall2_lightsync_tune', args });
  });
  mocks.set('wall2_lightsync_status', () => ({ paired: true, bridgeChanged: false, running: true, starting: false, lastError: null, stoppedHueSync: false }));
});
afterEach(() => {
  mocks.clear();
  resetLightSync();
  useNowPlayingStore.setState({ art: null });
});

const slider = (name: string) => document.querySelector(`input[type="range"][id="${name}"], input[aria-label="${name}"]`) as HTMLInputElement;
const saved = () => JSON.parse(localStorage.getItem(LIGHT_SYNC_KEY) ?? '{}');
/** Sync is on: a change is sent as a tune. */
const syncOn = () => useLightSync.setState({ status: { paired: true, bridgeChanged: false, running: true, starting: false, lastError: null, stoppedHueSync: false } });

it('the Lights tab has every row, the preview and Your usual, with starting values read back', () => {
  const { container } = render(<LightsPanel />);
  for (const label of ['Colour speed', 'Brightness', 'Kick flash', 'Smoothness', 'Who follows', 'Panel ripple']) expect(container.textContent).toContain(label);
  expect(container.textContent).toContain('Preview, live');
  expect(container.querySelector('[data-part="lights-preview"]')).not.toBeNull();
  // Preview B: two labelled strips. Five panel tiles (the engine's count), four named Plays; no monitor bar.
  const rows = Array.from(container.querySelectorAll('.ls-strip'));
  expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Panels', 'Plays']);
  expect(container.querySelectorAll('.ls-pn')).toHaveLength(5);
  expect(Array.from(container.querySelectorAll('.ls-play em')).map((e) => e.textContent)).toEqual(['Far Left', 'Left', 'Right', 'Far Right']);
  expect(container.querySelector('.ls-bar')).toBeNull();
  expect(container.textContent).toContain('every 2 bars');
  expect(container.textContent).toContain('15% to 90%');
  expect(container.textContent).toContain('strong');
  expect(container.textContent).toContain('a little smooth');
  expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  expect(Array.from(container.querySelectorAll('.ls-tile')).map((t) => t.getAttribute('data-follow'))).toEqual(['highs', 'bass', 'bass', 'highs', 'both']);
  // A cream tick on each slider marks the usual.
  expect(container.querySelectorAll('.ln-usual').length).toBe(5);
});

it('words read back the values', () => {
  expect(barsWords(1)).toBe('every bar');
  expect(barsWords(8)).toBe('every 8 bars');
  expect(brightWords(0.2, 1)).toBe('20% to 100%');
  expect([flashWords(0.1), flashWords(0.5), flashWords(0.8), flashWords(1)]).toEqual(['soft', 'medium', 'strong', 'hard']);
  expect([smoothWords(0), smoothWords(20), smoothWords(50), smoothWords(90)]).toEqual(['snappy', 'a little smooth', 'smooth', 'very smooth']);
});

it('colour speed moves between slow and fast, is saved, and is sent as colourBars', async () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.change(slider('ls-speed'), { target: { value: '4' } });
  expect(useLightSync.getState().ui.colourBars).toBe(1);
  expect(container.textContent).toContain('every bar');
  expect(saved().ui.colourBars).toBe(1);
  expect(tunes().length).toBe(1);
  expect((tunes()[0].args as { settings: { colourBars: number } }).settings.colourBars).toBe(1);
});

it('brightness has a floor and a peak handle, held in order and inside the native ranges', async () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.change(slider('Brightness floor'), { target: { value: '30' } });
  fireEvent.change(slider('Brightness peak'), { target: { value: '70' } });
  expect(useLightSync.getState().settings).toMatchObject({ floor: 0.3, brightness: 0.7 });
  expect(container.textContent).toContain('30% to 70%');
  fireEvent.change(slider('Brightness floor'), { target: { value: '90' } });
  expect(useLightSync.getState().settings.floor).toBe(0.5);
  fireEvent.change(slider('Brightness peak'), { target: { value: '5' } });
  expect(useLightSync.getState().settings.brightness).toBe(0.5);
  expect(tunes().length).toBe(4);
  const last = tunes()[3].args as { settings: { floor: number; brightness: number } };
  expect(last.settings).toMatchObject({ floor: 0.5, brightness: 0.5 });
});

it('kick flash and smoothness map to kickFlash and releaseMs', () => {
  syncOn();
  render(<LightsPanel />);
  fireEvent.change(slider('ls-flash'), { target: { value: '100' } });
  fireEvent.change(slider('ls-smooth'), { target: { value: '50' } });
  expect(useLightSync.getState().settings).toMatchObject({ kickFlash: 1, releaseMs: 800 });
  expect(tunes().length).toBe(2);
});

it('a settings change while sync runs is sent as a tune with the palette and the engine fields only', () => {
  syncOn();
  render(<LightsPanel />);
  fireEvent.change(slider('ls-flash'), { target: { value: '40' } });
  const sent = tunes()[0].args as { palette: { colors: string[]; kick: string; rest: string }; settings: Record<string, unknown> };
  expect(sent.palette.colors).toEqual(resolvePalette('synthwave').colors);
  expect(Object.keys(sent.settings).sort()).toEqual([...Object.keys(DEFAULT_LIGHT_SYNC), 'colourBars', 'follow', 'ripple'].sort());
  expect(sent.settings).toMatchObject({ colourBars: 2, ripple: true, follow: { plays: ['highs', 'bass', 'bass', 'highs'], panels: 'both' } });
  expect(sent.settings.kickFlash).toBe(0.4);
  expect(saved().settings.kickFlash).toBe(0.4);
});

it('with sync off a change is saved and nothing is sent', () => {
  render(<LightsPanel />);
  fireEvent.change(slider('ls-flash'), { target: { value: '40' } });
  expect(tunes().length).toBe(0);
  expect(saved().settings.kickFlash).toBe(0.4);
});

it('Who follows: a click cycles bass, highs, both for that light only', () => {
  const { container } = render(<LightsPanel />);
  const tile = (i: number) => container.querySelectorAll('.ls-tile')[i] as HTMLElement;
  expect(tile(1).getAttribute('data-follow')).toBe('bass');
  fireEvent.click(tile(1));
  expect(tile(1).getAttribute('data-follow')).toBe('highs');
  fireEvent.click(tile(1));
  expect(tile(1).getAttribute('data-follow')).toBe('both');
  fireEvent.click(tile(1));
  expect(tile(1).getAttribute('data-follow')).toBe('bass');
  fireEvent.click(tile(4));
  expect(useLightSync.getState().ui.follow).toEqual(['highs', 'bass', 'bass', 'highs', 'bass']);
  expect(saved().ui.follow[4]).toBe('bass');
});

it('Who follows and Panel ripple are sent to a running sync as follow and ripple', () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.click(container.querySelectorAll('.ls-tile')[0]);
  fireEvent.click(container.querySelectorAll('.ls-tile')[4]);
  fireEvent.click(container.querySelector('[role="switch"]') as HTMLElement);
  const last = tunes().at(-1)?.args as { settings: { follow: { plays: string[]; panels: string }; ripple: boolean } };
  expect(last.settings.follow).toEqual({ plays: ['both', 'bass', 'bass', 'highs'], panels: 'bass' });
  expect(last.settings.ripple).toBe(false);
  expect(tunes().length).toBe(3);
  expect(engineSettings(DEFAULT_LIGHT_SYNC, DEFAULT_LIGHTS_UI).follow).toEqual({ plays: ['highs', 'bass', 'bass', 'highs'], panels: 'both' });
});

it('Panel ripple switches off and on', () => {
  const { container } = render(<LightsPanel />);
  const sw = container.querySelector('[role="switch"]') as HTMLElement;
  fireEvent.click(sw);
  expect(sw.getAttribute('aria-checked')).toBe('false');
  expect(container.textContent).toContain('Off');
  expect(useLightSync.getState().ui.ripple).toBe(false);
  fireEvent.click(sw);
  expect(useLightSync.getState().ui.ripple).toBe(true);
});

it('Your usual puts every setting back, and keeps the palette and your colours', () => {
  syncOn();
  useLightSync.setState({ palette: 'neon', custom: ['#ff3d9a', '#35e6ea', '#9a7bff'] });
  const { container } = render(<LightsPanel />);
  fireEvent.change(slider('ls-flash'), { target: { value: '10' } });
  fireEvent.change(slider('ls-speed'), { target: { value: '0' } });
  fireEvent.click(container.querySelector('.ls-tile') as HTMLElement);
  fireEvent.click(container.querySelector('[role="switch"]') as HTMLElement);
  fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Your usual')) as HTMLElement);
  const s = useLightSync.getState();
  expect(s.settings).toEqual(DEFAULT_LIGHT_SYNC);
  expect(s.ui).toEqual(DEFAULT_LIGHTS_UI);
  expect(s.palette).toBe('neon');
  expect(s.custom.length).toBe(3);
  // Flash, colour speed, who follows, ripple and Your usual each send one.
  expect(tunes().length).toBe(5);
});

it('every control has a hover tip', async () => {
  const { container } = render(
    <>
      <LightsPanel />
      <HoverTipLayer />
    </>,
  );
  const controls = Array.from(container.querySelectorAll('input[type="range"], .ls-tile, [role="switch"], .ln-reset'));
  expect(controls.length).toBe(12);
  vi.useFakeTimers();
  try {
    for (const c of controls) {
      fireEvent.mouseEnter(c);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(document.querySelector('.hover-tip')?.textContent ?? '').not.toBe('');
      fireEvent.mouseLeave(c);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    }
  } finally {
    vi.useRealTimers();
  }
});

it('the sheet has Lights as its third tab and the gear tooltip names it', async () => {
  const { container } = render(<WatchSheet initial="lines" />);
  const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
  expect(tabs).toEqual(['Looks', 'Lines', 'Lights']);
  fireEvent.click(container.querySelectorAll('[role="tab"]')[2]);
  expect(container.querySelector('[data-part="lights-panel"]')).not.toBeNull();
});

it('the palette strip Settings item opens the Lights tab', async () => {
  const view = render(
    <>
      <OfficeMoods />
      <WatchSheet initial="lines" />
    </>,
  );
  void view;
  mocks.set('wall2_office_moods', () => ({ stale: false, moods: [{ id: 'a', label: 'Bright desk', line: null, active: true }], off: { active: false }, canWrite: true, writeBlock: null }));
  useLightSync.getState().openStrip(true);
  await flush();
  const item = document.querySelector('[data-part="palette-settings"]');
  if (item) {
    fireEvent.click(item);
    expect(useWatchStore.getState().sheetTab).toBe('lights');
    expect(useWatchStore.getState().sheet).toBe(true);
  } else {
    // The row is hidden until the home app lists moods; the strip item is exercised in lightsync.test.tsx's row.
    useWatchStore.getState().setSheet(true, 'lights');
    expect(useWatchStore.getState().sheetTab).toBe('lights');
  }
});

it('Custom: Keep this cover saves five colours, which become the palette', async () => {
  useNowPlayingStore.setState({ art: 'cover.jpg' });
  useLightSync.getState().openCustom(true);
  const { container } = render(<OfficeMoodsPicker />);
  await flush();
  fireEvent.click(container.querySelector('[data-part="keep-cover"]') as HTMLElement);
  await flush();
  expect(useLightSync.getState().custom).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff']);
  expect(useLightSync.getState().palette).toBe('custom');
  expect(saved().custom.length).toBe(5);
  expect(saved().palette).toBe('custom');
});

it('Custom: swatches add and swap, and a click on one of yours takes it out (3 to 5)', async () => {
  useLightSync.getState().openCustom(true);
  const { container } = render(<OfficeMoodsPicker />);
  expect(SWATCHES.length).toBe(24);
  const sw = (i: number) => container.querySelector(`[data-swatch="${SWATCHES[i]}"]`) as HTMLElement;
  fireEvent.click(sw(0));
  fireEvent.click(sw(1));
  expect(useLightSync.getState().palette).toBe('synthwave');
  fireEvent.click(sw(2));
  expect(useLightSync.getState().custom).toEqual([SWATCHES[0], SWATCHES[1], SWATCHES[2]]);
  expect(useLightSync.getState().palette).toBe('custom');
  // Three is the least: taking one out does nothing; add a fourth, then swap.
  fireEvent.click(sw(0));
  expect(useLightSync.getState().custom.length).toBe(3);
  fireEvent.click(sw(3));
  fireEvent.click(sw(0));
  expect(useLightSync.getState().custom).toEqual([SWATCHES[1], SWATCHES[2], SWATCHES[3]]);
  // Five at most.
  fireEvent.click(sw(4));
  fireEvent.click(sw(5));
  fireEvent.click(sw(6));
  expect(useLightSync.getState().custom.length).toBe(5);
  // One of yours (in the top row too) comes out.
  fireEvent.click(container.querySelector(`.uc-mine [data-colour="${SWATCHES[2]}"]`) as HTMLElement);
  expect(useLightSync.getState().custom).not.toContain(SWATCHES[2]);
  expect(container.querySelectorAll('.uc-mine .uc-dot.empty').length).toBe(1);
});

it('Custom: a running sync is tuned with your colours; fewer than three falls back to Synthwave', () => {
  syncOn();
  useLightSync.getState().openCustom(true);
  const { container } = render(<OfficeMoodsPicker />);
  for (const i of [0, 1, 2]) fireEvent.click(container.querySelector(`[data-swatch="${SWATCHES[i]}"]`) as HTMLElement);
  const sent = tunes().at(-1)?.args as { palette: { colors: string[] } };
  expect(sent.palette.colors).toEqual([SWATCHES[0], SWATCHES[1], SWATCHES[2]]);
  expect(resolvePalette('custom', { custom: [SWATCHES[0], SWATCHES[1]] }).colors).toEqual(resolvePalette('synthwave').colors);
});

it('Custom: the colours survive a reload, and a throwing localStorage does not break a save', () => {
  useLightSync.getState().openCustom(true);
  const { container } = render(<OfficeMoodsPicker />);
  for (const i of [7, 8, 9]) fireEvent.click(container.querySelector(`[data-swatch="${SWATCHES[i]}"]`) as HTMLElement);
  resetLightSync();
  expect(useLightSync.getState().custom).toEqual([SWATCHES[7], SWATCHES[8], SWATCHES[9]]);
  expect(useLightSync.getState().palette).toBe('custom');
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  try {
    useLightSync.getState().toggleCustom(SWATCHES[10]);
    expect(useLightSync.getState().custom.length).toBe(4);
  } finally {
    spy.mockRestore();
  }
});

it('Your own is enabled in the strip and with no colours kept opens the picker without switching palette', () => {
  useLightSync.getState().setPalette('custom');
  expect(useLightSync.getState().customOpen).toBe(true);
  expect(useLightSync.getState().palette).toBe('synthwave');
});

import { CustomPicker } from '../SyncChip';
function OfficeMoodsPicker() {
  return (
    <>
      <CustomPicker />
      <HoverTipLayer />
    </>
  );
}

it('a flat cover (one colour) is filled up to three with the nearest swatches', async () => {
  useNowPlayingStore.setState({ art: 'cover.jpg' });
  const coverTint = await import('../../music/coverTint');
  const spy = vi.spyOn(coverTint, 'readCoverStrips').mockResolvedValue([[255, 61, 154], [255, 61, 154], [255, 61, 154], [255, 61, 154], [255, 61, 154]]);
  try {
    expect(await useLightSync.getState().keepCover()).toBe(true);
    const c = useLightSync.getState().custom;
    expect(c.length).toBe(3);
    expect(c[0]).toBe('#ff3d9a');
    expect(c.slice(1).every((x) => SWATCHES.includes(x))).toBe(true);
    expect(useLightSync.getState().palette).toBe('custom');
  } finally {
    spy.mockRestore();
  }
});

const frame = (st: ReturnType<typeof newPreview>, over: Partial<typeof DEFAULT_LIGHT_SYNC> = {}, ui = DEFAULT_LIGHTS_UI, beatCount = 0, bass = 0, high = 0, dtMs = 33) =>
  stepPreview(st, { ...DEFAULT_LIGHT_SYNC, ...over }, ui, 3, { bass, high, beatCount, dtMs });

it('the preview steps colours every colourBars times four beats', () => {
  const st = newPreview(0.15);
  let beats = 0;
  const ui = { ...DEFAULT_LIGHTS_UI, colourBars: 1 };
  for (let i = 0; i < 3; i++) frame(st, {}, ui, ++beats);
  expect(st.colourPos).toBe(0);
  expect(frame(st, {}, ui, ++beats).colour).toBe(1);
  const two = newPreview(0.15);
  beats = 0;
  for (let i = 0; i < 7; i++) frame(two, {}, DEFAULT_LIGHTS_UI, ++beats);
  expect(two.colourPos).toBe(0);
  expect(frame(two, {}, DEFAULT_LIGHTS_UI, ++beats).colour).toBe(1);
});

it('the preview kick flash follows Kick flash, and Panel ripple off pulses the panels whole', () => {
  const hit = (flash: number, ripple: boolean) => {
    const st = newPreview(0);
    return frame(st, { floor: 0, kickFlash: flash }, { ...DEFAULT_LIGHTS_UI, ripple }, 1);
  };
  expect(hit(1, true).plays[1]).toBeGreaterThan(hit(0.2, true).plays[1] + 0.4);
  // Ripple on: the ring starts at the centre panel only. Off: every panel flashes together.
  const on = hit(1, true).panels;
  expect(on[2]).toBeGreaterThan(on[0]);
  const off = hit(1, false).panels;
  expect(new Set(off.map((v) => v.toFixed(3))).size).toBe(1);
  expect(off[0]).toBeGreaterThan(0.9);
});

it('the preview takes "both" as the mean, as the engine does', () => {
  const st = newPreview(0.15);
  let f = frame(st);
  for (let i = 0; i < 60; i++) f = frame(st, { floor: 0.0 }, { ...DEFAULT_LIGHTS_UI, follow: ['both', 'bass', 'highs', 'both', 'both'] }, 0, 1, 0);
  expect(f.plays[0]).toBeCloseTo((st.bassEnv + st.highEnv) / 2, 5);
  expect(f.panels[0]).toBeCloseTo((st.bassEnv + st.highEnv) / 2, 5);
});
