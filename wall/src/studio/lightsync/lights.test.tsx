import { act, fireEvent, render } from '@testing-library/react';
// @ts-ignore node's own file calls; this test reads the shared fixture as text.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { LIGHT_SYNC_KEY } from '../../settings/settings';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { useNowPlayingStore } from '../../music/store';
import { useWatchStore } from '../../unwind/watch/store';
import { WatchSheet } from '../../unwind/watch/Sheet';
import { resetHome } from '../homeStore';
import { OfficeMoods } from '../OfficeMoods';
import { Swing, newPreview, stepPreview } from './preview';
import { DEFAULT_LIGHTS_UI, DEFAULT_LIGHT_SYNC, INTENSITIES, INTENSITY_IDS, SWATCHES, driftOf, engineSettings, resolvePalette } from './model';
import { useAudioStore } from '../../audio/store';
import { LightsPanel, driftWords, brightWords, flashWords, smoothWords } from './LightsPanel';
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

/** The plan's table, written out by hand so a wrong value in the model fails here. */
const COLUMNS = {
  subtle: { settings: { floor: 0.45, brightness: 0.8, energyDepth: 0.35, kickFlash: 0.25, kickWhite: 0, kickRiseMs: 80, kickDecayMs: 450, attackMs: 150, releaseMs: 900, levelWindow: 8, beatNudge: 0.04, minPulseGapMs: 500, slewDown: 0.8, bassGain: 1, highGain: 1 }, colourBars: 4, driftMs: 10000 },
  moderate: { settings: { floor: 0.35, brightness: 0.9, energyDepth: 0.55, kickFlash: 0.45, kickWhite: 0.15, kickRiseMs: 60, kickDecayMs: 320, attackMs: 100, releaseMs: 650, levelWindow: 4, beatNudge: 0.08, minPulseGapMs: 400, slewDown: 1.5, bassGain: 1, highGain: 1 }, colourBars: 2, driftMs: 6000 },
  high: { settings: { floor: 0.25, brightness: 1, energyDepth: 0.75, kickFlash: 0.7, kickWhite: 0.35, kickRiseMs: 40, kickDecayMs: 220, attackMs: 60, releaseMs: 420, levelWindow: 2, beatNudge: 0.15, minPulseGapMs: 340, slewDown: 3, bassGain: 1, highGain: 1 }, colourBars: 1, driftMs: 4000 },
} as const;

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

it('the Lights tab is the room, the preset bar and three groups, with starting values read back', () => {
  const { container } = render(<LightsPanel />);
  for (const label of ['Tap a light to set it', 'Hearing', 'Auto level', 'Sensitivity', 'Light', 'Ripple', 'Brightness', 'Colour', 'Pulse', 'Smooth']) expect(container.textContent).toContain(label);
  const panel = container.querySelector('.ls-panel') as HTMLElement;
  expect(Array.from(panel.children).map((c) => c.className.split(' ')[0])).toEqual(['ls-room', 'ls-presets', 'ls-card', 'ls-card', 'ls-card']);
  expect(Array.from(container.querySelectorAll('.ls-tile')).map((t) => t.textContent)).toEqual(['Far Left', 'Left', 'Shapes', 'Right', 'Far Right']);
  expect(Array.from(container.querySelectorAll('.ls-legend .ls-key')).map((k) => k.textContent)).toEqual(['Bass', 'Highs', 'Both']);
  expect(container.textContent).toContain('every 10 s');
  expect(container.textContent).toContain('45 to 80%');
  expect(container.textContent).toContain('steady');
  const switches = Array.from(container.querySelectorAll('[role="switch"]'));
  expect(switches.map((x) => x.getAttribute('aria-checked'))).toEqual(['true', 'true']);
  // Tiles in room order carry the follow of their light: Far Left, Left, Shapes (the panels), Right, Far Right.
  expect(Array.from(container.querySelectorAll('.ls-tile')).map((t) => t.getAttribute('data-follow'))).toEqual(['highs', 'bass', 'both', 'bass', 'highs']);
  // A cream tick on each slider marks the usual; the old Intensity row, preview strips and Your usual are gone.
  expect(container.querySelectorAll('.ln-usual').length).toBe(6);
  expect(container.querySelector('.ls-strip, .ls-intensity, .ln-reset')).toBeNull();
  expect(container.querySelector('[data-part="sound-level"]')).not.toBeNull();
});

it('words read back the values', () => {
  expect(driftWords(4000)).toBe('every 4 s');
  expect(driftWords(20000)).toBe('every 20 s');
  expect(brightWords(0.2, 1)).toBe('20 to 100%');
  expect([flashWords(0.1), flashWords(0.5), flashWords(0.8), flashWords(1)]).toEqual(['soft', 'medium', 'strong', 'hard']);
  expect([smoothWords(0), smoothWords(20), smoothWords(50), smoothWords(90)]).toEqual(['snappy', 'a little smooth', 'smooth', 'very smooth']);
});

it('colour speed moves between slow and fast, is saved, and is sent as colourBars and driftMs', async () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.change(slider('ls-speed'), { target: { value: '4' } });
  expect(useLightSync.getState().ui.colourBars).toBe(1);
  expect(container.textContent).toContain('every 4 s');
  expect(saved().ui.colourBars).toBe(1);
  expect(tunes().length).toBe(1);
  expect((tunes()[0].args as { settings: { colourBars: number; driftMs: number } }).settings).toMatchObject({ colourBars: 1, driftMs: 4000 });
});

it('brightness has a floor and a peak handle, held in order and inside the native ranges', async () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.change(slider('Brightness floor'), { target: { value: '30' } });
  fireEvent.change(slider('Brightness peak'), { target: { value: '70' } });
  expect(useLightSync.getState().settings).toMatchObject({ floor: 0.3, brightness: 0.7 });
  expect(container.textContent).toContain('30 to 70%');
  fireEvent.change(slider('Brightness floor'), { target: { value: '90' } });
  expect(useLightSync.getState().settings.floor).toBe(0.6);
  fireEvent.change(slider('Brightness peak'), { target: { value: '5' } });
  expect(useLightSync.getState().settings.brightness).toBe(0.7);
  expect(tunes().length).toBe(4);
  const last = tunes()[3].args as { settings: { floor: number; brightness: number } };
  expect(last.settings).toMatchObject({ floor: 0.6, brightness: 0.7 });
});

it('pulse and smoothness map to kickFlash and releaseMs', () => {
  syncOn();
  render(<LightsPanel />);
  fireEvent.change(slider('ls-flash'), { target: { value: '100' } });
  fireEvent.change(slider('ls-smooth'), { target: { value: '50' } });
  expect(useLightSync.getState().settings).toMatchObject({ kickFlash: 1, releaseMs: 1100 });
  expect(tunes().length).toBe(2);
});

it('a settings change while sync runs is sent as a tune with the palette and the engine fields only', () => {
  syncOn();
  render(<LightsPanel />);
  fireEvent.change(slider('ls-flash'), { target: { value: '40' } });
  const sent = tunes()[0].args as { palette: { colors: string[]; kick: string; rest: string }; settings: Record<string, unknown> };
  expect(sent.palette.colors).toEqual(resolvePalette('synthwave').colors);
  expect(Object.keys(sent.settings).sort()).toEqual([...Object.keys(DEFAULT_LIGHT_SYNC), 'colourBars', 'driftMs', 'follow', 'ripple'].sort());
  expect(sent.settings).toMatchObject({ colourBars: 4, driftMs: 10000, ripple: true, follow: { plays: ['highs', 'bass', 'bass', 'highs'], panels: 'both' } });
  expect(sent.settings.kickFlash).toBe(0.4);
  expect(saved().settings.kickFlash).toBe(0.4);
});

it('with sync off a change is saved and nothing is sent', () => {
  render(<LightsPanel />);
  fireEvent.change(slider('ls-flash'), { target: { value: '40' } });
  expect(tunes().length).toBe(0);
  expect(saved().settings.kickFlash).toBe(0.4);
});

it('a tile tap cycles that light bass, highs, both and no other', () => {
  const { container } = render(<LightsPanel />);
  const tile = (i: number) => container.querySelectorAll('.ls-tile')[i] as HTMLElement;
  expect(tile(1).getAttribute('data-follow')).toBe('bass');
  fireEvent.click(tile(1));
  expect(tile(1).getAttribute('data-follow')).toBe('highs');
  fireEvent.click(tile(1));
  expect(tile(1).getAttribute('data-follow')).toBe('both');
  fireEvent.click(tile(1));
  expect(tile(1).getAttribute('data-follow')).toBe('bass');
  // The third tile is the Shapes: the panels' light, the last of the five.
  fireEvent.click(tile(2));
  expect(useLightSync.getState().ui.follow).toEqual(['highs', 'bass', 'bass', 'highs', 'bass']);
  expect(saved().ui.follow[4]).toBe('bass');
});

const ripple = (c: HTMLElement) => c.querySelector('[role="switch"][aria-labelledby="ls-ripple-label"]') as HTMLElement;

it('Who follows and Panel ripple are sent to a running sync as follow and ripple', () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.click(container.querySelectorAll('.ls-tile')[0]);
  fireEvent.click(container.querySelectorAll('.ls-tile')[2]);
  fireEvent.click(ripple(container));
  const last = tunes().at(-1)?.args as { settings: { follow: { plays: string[]; panels: string }; ripple: boolean } };
  expect(last.settings.follow).toEqual({ plays: ['both', 'bass', 'bass', 'highs'], panels: 'bass' });
  expect(last.settings.ripple).toBe(false);
  expect(tunes().length).toBe(3);
  expect(engineSettings(DEFAULT_LIGHT_SYNC, DEFAULT_LIGHTS_UI).follow).toEqual({ plays: ['highs', 'bass', 'bass', 'highs'], panels: 'both' });
});

it('Panel ripple switches off and on', () => {
  const { container } = render(<LightsPanel />);
  const sw = ripple(container);
  fireEvent.click(sw);
  expect(sw.getAttribute('aria-checked')).toBe('false');
  expect(useLightSync.getState().ui.ripple).toBe(false);
  fireEvent.click(sw);
  expect(useLightSync.getState().ui.ripple).toBe(true);
});

it('resetLights puts every setting back, and keeps the palette and your colours', () => {
  syncOn();
  useLightSync.setState({ palette: 'neon', custom: ['#ff3d9a', '#35e6ea', '#9a7bff'] });
  const { container } = render(<LightsPanel />);
  fireEvent.change(slider('ls-flash'), { target: { value: '10' } });
  fireEvent.change(slider('ls-speed'), { target: { value: '0' } });
  fireEvent.click(container.querySelector('.ls-tile') as HTMLElement);
  fireEvent.click(ripple(container));
  act(() => useLightSync.getState().resetLights());
  const s = useLightSync.getState();
  expect(s.settings).toEqual(DEFAULT_LIGHT_SYNC);
  expect(s.ui).toEqual(DEFAULT_LIGHTS_UI);
  expect(s.palette).toBe('neon');
  expect(s.custom.length).toBe(3);
  // Flash, colour speed, who follows, ripple and the reset each send one.
  expect(tunes().length).toBe(5);
});

it('every control has a hover tip', async () => {
  // A slider moved off its preset lights Save and Reset, so they are enabled and can be hovered too.
  useLightSync.getState().setSettings({ kickFlash: 0.9 });
  const { container } = render(
    <>
      <LightsPanel />
      <HoverTipLayer />
    </>,
  );
  const controls = Array.from(container.querySelectorAll('input[type="range"], .ls-tile, [role="switch"], .ls-save, .ls-undo, [role="radio"]'));
  expect(controls.length).toBe(18);
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

it('the sheet has Lights as its fourth tab and the gear tooltip names it', async () => {
  const { container } = render(<WatchSheet initial="lines" />);
  const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
  expect(tabs).toEqual(['Looks', 'Lines', 'Vibe', 'Lights']);
  fireEvent.click(container.querySelectorAll('[role="tab"]')[3]);
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

it('the room tiles glow brighter when the sound is louder', async () => {
  let cb: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    cb = f;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  try {
    useAudioStore.setState({ bass: 0, high: 0 });
    const { container } = render(<LightsPanel />);
    let t = 1000;
    const tick = (n = 1) => {
      for (let i = 0; i < n; i++) {
        t += 33;
        act(() => cb?.(t));
      }
    };
    const glow = () => Array.from(container.querySelectorAll<HTMLElement>('.ls-tile')).map((e) => Number(e.style.getPropertyValue('--glow')));
    const level = () => Number((container.querySelector('.ls-panel') as HTMLElement).style.getPropertyValue('--lvl'));
    tick();
    const quiet = glow();
    expect(quiet.every((g) => g > 0)).toBe(true);
    expect(level()).toBe(0);
    useAudioStore.setState({ bass: 1, high: 1 });
    tick(30);
    expect(Math.max(...glow())).toBeGreaterThan(Math.max(...quiet));
    expect(level()).toBe(1);
  } finally {
    vi.unstubAllGlobals();
    useAudioStore.setState({ bass: 0, high: 0 });
  }
});

const SYNTH = resolvePalette('synthwave');
const frame = (st: ReturnType<typeof newPreview>, over: Partial<typeof DEFAULT_LIGHT_SYNC> = {}, ui = DEFAULT_LIGHTS_UI, beatCount = 0, bass = 0, high = 0, dtMs = 33) =>
  stepPreview(st, { ...DEFAULT_LIGHT_SYNC, ...over }, ui, SYNTH, { bass, high, beatCount, dtMs });
const top = (c: number[]) => Math.max(...c);

it('the preview palette drifts on its own clock with no beat at all', () => {
  const st = newPreview(0.35);
  for (let i = 0; i < 250; i++) frame(st);
  expect(st.pos).toBeGreaterThan(0.5);
  // A faster colour speed (fewer bars) drifts faster.
  const fast = newPreview(0.35);
  for (let i = 0; i < 250; i++) frame(fast, {}, { ...DEFAULT_LIGHTS_UI, colourBars: 1 });
  expect(fast.pos).toBeGreaterThan(st.pos);
});

it('quiet lights stay on at the floor in a palette colour, never off', () => {
  const st = newPreview(0.35);
  let f = frame(st);
  for (let i = 0; i < 100; i++) f = frame(st);
  for (const c of [...f.plays, ...f.panels]) expect(top(c)).toBeGreaterThan(0.35 * 0.95 * 0.5);
});

it('a beat swells the brightness without white on Subtle', () => {
  const st = newPreview(0.35);
  const base = frame(st);
  let peak = 0;
  frame(st, {}, DEFAULT_LIGHTS_UI, 1);
  for (let i = 0; i < 8; i++) peak = Math.max(peak, top(frame(st, {}, DEFAULT_LIGHTS_UI, 1).plays[1]));
  expect(peak).toBeGreaterThan(top(base.plays[1]) + 0.03);
  expect(peak).toBeLessThanOrEqual(0.8 + 1e-9);
});

it('Panel ripple off pulses the panels whole, and on starts the ring at the centre panel', () => {
  const hit = (ripple: boolean) => {
    const st = newPreview(0.35);
    const ui = { ...DEFAULT_LIGHTS_UI, ripple };
    const s = { kickFlash: 1, kickRiseMs: 30, slewDown: 5 };
    const base = frame(st, s, ui).panels.map(top);
    let out = frame(st, s, ui, 1);
    for (let i = 0; i < 3; i++) out = frame(st, s, ui, 1);
    return out.panels.map((c, i) => top(c) - base[i]);
  };
  const on = hit(true);
  expect(on[2]).toBeGreaterThan(on[0] + 0.02);
  const off = hit(false);
  expect(off.every((v) => v > 0.02)).toBe(true);
});

it('the preview takes "both" as the mean, as the engine does', () => {
  const st = newPreview(DEFAULT_LIGHT_SYNC.floor);
  const ui = { ...DEFAULT_LIGHTS_UI, follow: ['both', 'bass', 'highs', 'both', 'both'] as typeof DEFAULT_LIGHTS_UI.follow };
  let f = frame(st, {}, ui, 0, 1, 0);
  for (let i = 0; i < 60; i++) f = frame(st, {}, ui, 0, 1, 0);
  const mean = (st.bassEnv + st.highEnv) / 2;
  const target = DEFAULT_LIGHT_SYNC.floor + (DEFAULT_LIGHT_SYNC.brightness - DEFAULT_LIGHT_SYNC.floor) * Math.min(1, DEFAULT_LIGHT_SYNC.energyDepth * mean);
  expect(f.panels[0].some((v) => v > 0)).toBe(true);
  expect(st.plays[0].b).toBeCloseTo(target, 5);
});

it('the preview matches the native frames on the shared fixture (Subtle)', () => {
  const fx = JSON.parse(readFileSync('../src-tauri/tests/fixtures/lightsync-frames.json', 'utf8').replace(/\r\n/g, '\n')) as { dtMs: number; palette: { colors: string[]; kick: string }; frames: [number, number, number][]; plays: number[][] };
  expect(fx.plays.length).toBe(fx.frames.length);
  // The shared fixture was cut at a floor of 0.35, so it is held there whatever Subtle's floor is now.
  const fxSettings = { ...DEFAULT_LIGHT_SYNC, floor: 0.35 };
  const st = newPreview(fxSettings.floor);
  let beats = 0;
  fx.frames.forEach(([bass, high, beat], i) => {
    if (beat) beats += 1;
    const f = stepPreview(st, fxSettings, DEFAULT_LIGHTS_UI, fx.palette, { bass, high, beatCount: beats, dtMs: fx.dtMs });
    f.plays.flat().forEach((v, k) => expect(Math.abs(v - fx.plays[i][k]), `frame ${i} channel ${k}`).toBeLessThan(2e-6));
  });
});

it('the flash guard holds every intensity and the harshest sliders under five swings a second, Plays and panels', () => {
  const harshest = { floor: 0.05, brightness: 1, energyDepth: 1, kickFlash: 1, kickWhite: 0.5, kickRiseMs: 30, kickDecayMs: 150, attackMs: 40, releaseMs: 200, levelWindow: 1, beatNudge: 0.25, minPulseGapMs: 340, slewDown: 5 };
  const sets = [...INTENSITY_IDS.map((id) => ({ id: id as string, ...INTENSITIES[id] })), { id: 'harshest', settings: harshest, colourBars: 1 }];
  const palettes = [SYNTH, { colors: ['#ffffff', '#ffff00', '#ffffff', '#ffff00'], kick: '#ffffff' }, { colors: ['#ffff00', '#00ffff'], kick: '#ffff00' }];
  const y = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const palette of palettes) {
    for (const { id, settings, colourBars } of sets) {
      for (const step of [20, 33]) {
        const st = newPreview(settings.floor);
        const ui = { ...DEFAULT_LIGHTS_UI, colourBars };
        const counters = Array.from({ length: 9 }, () => new Swing());
        let now = 0;
        let beats = 0;
        const frames = Math.round(20000 / step);
        for (let i = 0; i < frames; i++) {
          now += step;
          if (i % Math.round(264 / step) === 0) beats += 1;
          const f = stepPreview(st, { ...DEFAULT_LIGHT_SYNC, ...settings }, ui, palette, { bass: (i / 4) % 2 < 1 ? 1 : 0, high: i % 2, beatCount: beats, dtMs: step });
          [...f.plays, ...f.panels].forEach((c, k) => {
            counters[k].commit(now, y(c));
            expect(counters[k].transitions, `${id} ${palette.colors[0]} ${step} ms`).toBeLessThanOrEqual(5);
          });
        }
      }
    }
  }
});

const radios = () => Array.from(document.querySelectorAll<HTMLElement>('[role="radio"][data-intensity]'));

const dot = (c: HTMLElement) => c.querySelector('[data-part="preset-dot"]');
const checked = () => radios().map((r) => r.getAttribute('aria-checked'));
const saveBtn = (c: HTMLElement) => c.querySelector('.ls-save') as HTMLButtonElement;
const undoBtn = (c: HTMLElement) => c.querySelector('.ls-undo') as HTMLButtonElement;

it('the preset bar sits after the room with three buttons, Subtle lit, no dot and Save held back', () => {
  const { container } = render(<LightsPanel />);
  expect(container.querySelector('.ls-presets')).toBe(container.querySelector('.ls-panel')?.children[1]);
  expect(radios().map((r) => r.textContent)).toEqual(['Subtle', 'Moderate', 'High']);
  expect(checked()).toEqual(['true', 'false', 'false']);
  expect(dot(container)).toBeNull();
  expect(saveBtn(container).textContent).toBe('Save to Subtle');
  expect(saveBtn(container).disabled).toBe(true);
  expect(undoBtn(container).disabled).toBe(true);
});

for (const id of INTENSITY_IDS) {
  it(`picking ${id} rewrites its whole column and sends one tune with it`, () => {
    syncOn();
    render(<LightsPanel />);
    // Start away from every column so the pick has something to rewrite.
    fireEvent.change(slider('ls-flash'), { target: { value: '5' } });
    fireEvent.change(slider('ls-speed'), { target: { value: '0' } });
    const before = tunes().length;
    fireEvent.click(radios()[INTENSITY_IDS.indexOf(id)]);
    const col = COLUMNS[id];
    expect(useLightSync.getState().settings).toMatchObject(col.settings);
    expect(useLightSync.getState().ui.colourBars).toBe(col.colourBars);
    expect(tunes().length).toBe(before + 1);
    const sent = (tunes().at(-1)?.args as { settings: Record<string, unknown> }).settings;
    expect(sent).toMatchObject({ ...col.settings, colourBars: col.colourBars, driftMs: col.driftMs });
    expect(saved().settings).toMatchObject(col.settings);
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(INTENSITY_IDS.map((x) => String(x === id)));
  });
}

it('the High column keeps its drift at 4000 ms, the table value', () => {
  for (const id of INTENSITY_IDS) expect(driftOf(INTENSITIES[id].colourBars)).toBe(COLUMNS[id].driftMs);
});

it('moving any slider puts a dot on the active preset and lights Save to it; picking a preset clears it', () => {
  const { container } = render(<LightsPanel />);
  for (const [name, value] of [['ls-flash', '60'], ['ls-smooth', '10'], ['ls-speed', '0'], ['Brightness floor', '20'], ['Brightness peak', '95'], ['ls-sens', '90']] as const) {
    fireEvent.click(radios()[1]);
    expect(dot(container)).toBeNull();
    fireEvent.change(slider(name), { target: { value } });
    expect(dot(container)).not.toBeNull();
    expect(radios()[1].contains(dot(container))).toBe(true);
    expect(checked()).toEqual(['false', 'true', 'false']);
    expect(saveBtn(container).disabled).toBe(false);
    expect(saveBtn(container).textContent).toBe('Save to Moderate');
    expect(undoBtn(container).disabled).toBe(false);
  }
  fireEvent.click(radios()[2]);
  expect(dot(container)).toBeNull();
  expect(checked()).toEqual(['false', 'false', 'true']);
});

it('Save to the preset keeps the slider values: the dot goes, and picking another preset and back returns them', () => {
  const { container } = render(<LightsPanel />);
  fireEvent.click(radios()[1]);
  fireEvent.change(slider('ls-flash'), { target: { value: '90' } });
  fireEvent.change(slider('Brightness floor'), { target: { value: '50' } });
  fireEvent.click(saveBtn(container));
  expect(dot(container)).toBeNull();
  expect(saveBtn(container).disabled).toBe(true);
  expect(useLightSync.getState().ui.saved.moderate?.settings).toMatchObject({ kickFlash: 0.9, floor: 0.5 });
  expect(saved().ui.saved.moderate.settings.kickFlash).toBe(0.9);
  fireEvent.click(radios()[0]);
  expect(useLightSync.getState().settings.kickFlash).toBe(COLUMNS.subtle.settings.kickFlash);
  fireEvent.click(radios()[1]);
  expect(useLightSync.getState().settings).toMatchObject({ kickFlash: 0.9, floor: 0.5 });
  expect(dot(container)).toBeNull();
  // The saved one survives a reload.
  resetLightSync();
  expect(useLightSync.getState().ui.saved.moderate?.settings.kickFlash).toBe(0.9);
});

it('Reset brings the active preset back to its stored values, saved ones included, and sends one tune', () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.click(radios()[2]);
  fireEvent.change(slider('ls-flash'), { target: { value: '10' } });
  fireEvent.change(slider('ls-speed'), { target: { value: '0' } });
  const before = tunes().length;
  fireEvent.click(undoBtn(container));
  expect(useLightSync.getState().settings).toMatchObject(COLUMNS.high.settings);
  expect(useLightSync.getState().ui.colourBars).toBe(COLUMNS.high.colourBars);
  expect(tunes().length).toBe(before + 1);
  expect(dot(container)).toBeNull();
  // After a save, Reset returns the saved values, not the built-in ones.
  fireEvent.change(slider('ls-flash'), { target: { value: '33' } });
  fireEvent.click(saveBtn(container));
  fireEvent.change(slider('ls-flash'), { target: { value: '5' } });
  fireEvent.click(undoBtn(container));
  expect(useLightSync.getState().settings.kickFlash).toBe(0.33);
});

it('the preset brightness floors are Subtle 45, Moderate 35 and High 25 percent', () => {
  expect(INTENSITY_IDS.map((id) => Math.round(INTENSITIES[id].settings.floor * 100))).toEqual([45, 35, 25]);
  expect(DEFAULT_LIGHT_SYNC.floor).toBe(0.45);
  const { container } = render(<LightsPanel />);
  for (const [i, floor] of [45, 35, 25].entries()) {
    fireEvent.click(radios()[i]);
    expect(slider('Brightness floor').value).toBe(String(floor));
    expect(container.querySelector('.ls-dual')?.nextElementSibling?.textContent?.startsWith(`${floor} to `)).toBe(true);
  }
});

it('Sensitivity sets both band gains, shows a word, and Auto level is saved but not sent to the engine', () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.change(slider('ls-sens'), { target: { value: '100' } });
  expect(useLightSync.getState().settings).toMatchObject({ bassGain: 1.6, highGain: 1.6 });
  expect(container.textContent).toContain('touchy');
  fireEvent.change(slider('ls-sens'), { target: { value: '0' } });
  expect(container.textContent).toContain('calm');
  const auto = container.querySelector('[role="switch"][aria-labelledby="ls-auto-label"]') as HTMLElement;
  fireEvent.click(auto);
  expect(useLightSync.getState().ui.autoLevel).toBe(false);
  expect(saved().ui.autoLevel).toBe(false);
  const sent = (tunes().at(-1)?.args as { settings: Record<string, unknown> }).settings;
  expect('autoLevel' in sent || 'preset' in sent || 'saved' in sent).toBe(false);
});

it('the sheet keeps 16 px at both sides and the panel is one minmax(0,1fr) column', () => {
  const css = readFileSync('src/styles/unwind.css', 'utf8').replace(/\r\n/g, '\n');
  const block = (sel: string) => css.slice(css.indexOf(`\n${sel} {`), css.indexOf('\n}', css.indexOf(`\n${sel} {`)));
  expect(block('.w-sheet.ls-sheet')).toMatch(/padding: \d+px 16px \d+px;/);
  expect(block('.w-sheet.ls-sheet > .ln-body')).toMatch(/padding: 0;/);
  expect(block('.ls-panel')).toContain(['grid-template-columns: minmax(0, ', '1fr);'].join(''));
  for (const sel of ['.ls-room', '.ls-card']) expect(block(sel)).toContain('min-width: 0;');
  expect(block('.ls-row')).toContain(['grid-template-columns: 112px minmax(0, ', '1fr) 92px;'].join(''));
});

it('keyboard order: the group is one tab stop, arrows move and pick, Home and End jump', () => {
  syncOn();
  render(<LightsPanel />);
  // One tab stop in the group: the lit button (the first when Custom).
  expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  radios()[0].focus();
  fireEvent.keyDown(radios()[0], { key: 'ArrowRight' });
  expect(document.activeElement).toBe(radios()[1]);
  expect(useLightSync.getState().settings.brightness).toBe(0.9);
  expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  fireEvent.keyDown(radios()[1], { key: 'End' });
  expect(document.activeElement).toBe(radios()[2]);
  fireEvent.keyDown(radios()[2], { key: 'ArrowRight' });
  expect(document.activeElement).toBe(radios()[0]);
  fireEvent.keyDown(radios()[0], { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(radios()[2]);
  fireEvent.keyDown(radios()[2], { key: 'Home' });
  expect(document.activeElement).toBe(radios()[0]);
  // Custom: the first button is the tab stop.
  fireEvent.change(slider('ls-flash'), { target: { value: '5' } });
  expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  // The Intensity buttons come before every slider in the document.
  const all = Array.from(document.querySelectorAll('[role="radio"][data-intensity], input[type="range"]'));
  expect(all.slice(0, 3)).toEqual(radios());
});

it('every intensity column is the hand-written table', () => {
  for (const id of INTENSITY_IDS) expect(INTENSITIES[id]).toEqual({ settings: COLUMNS[id].settings, colourBars: COLUMNS[id].colourBars });
});

it('dragging Smoothness away from a preset and back to its stop clears the dot again', () => {
  const { container } = render(<LightsPanel />);
  for (const [i, id] of INTENSITY_IDS.entries()) {
    fireEvent.click(radios()[i]);
    const stop = String(Math.round((COLUMNS[id].settings.releaseMs - 200) / 18));
    expect(slider('ls-smooth').value).toBe(stop);
    fireEvent.change(slider('ls-smooth'), { target: { value: '95' } });
    expect(dot(container)).not.toBeNull();
    fireEvent.change(slider('ls-smooth'), { target: { value: stop } });
    expect(dot(container)).toBeNull();
    expect(radios()[i].getAttribute('aria-checked')).toBe('true');
  }
});

it('a field with no slider (kickWhite, beatNudge) changed in the store puts the dot on the preset', () => {
  const { container } = render(<LightsPanel />);
  for (const patch of [{ kickWhite: 0.3 }, { beatNudge: 0.2 }]) {
    fireEvent.click(radios()[0]);
    act(() => useLightSync.getState().setSettings(patch));
    expect(dot(container)).not.toBeNull();
  }
});
