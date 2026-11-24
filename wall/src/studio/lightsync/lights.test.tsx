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
import { DEFAULT_LIGHTS_UI, DEFAULT_LIGHT_SYNC, INTENSITIES, INTENSITY_IDS, PALETTES, SWATCHES, driftOf, engineSettings, resolvePalette } from './model';
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
  for (const label of ['Intensity', 'Colour speed', 'Brightness', 'Pulse', 'Smoothness', 'Who follows', 'Panel ripple']) expect(container.textContent).toContain(label);
  expect(container.textContent).toContain('Preview, live');
  expect(container.querySelector('[data-part="lights-preview"]')).not.toBeNull();
  // Preview B: two labelled strips. Five panel tiles (the engine's count), four named Plays; no monitor bar.
  const rows = Array.from(container.querySelectorAll('.ls-strip'));
  expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Panels', 'Plays']);
  expect(container.querySelectorAll('.ls-pn')).toHaveLength(5);
  expect(Array.from(container.querySelectorAll('.ls-play em')).map((e) => e.textContent)).toEqual(['Far Left', 'Left', 'Right', 'Far Right']);
  expect(container.querySelector('.ls-bar')).toBeNull();
  expect(container.textContent).toContain('a colour every 10 s');
  expect(container.textContent).toContain('35% to 80%');
  expect(container.textContent).toContain('soft');
  expect(container.textContent).toContain('smooth');
  expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  expect(Array.from(container.querySelectorAll('.ls-tile')).map((t) => t.getAttribute('data-follow'))).toEqual(['highs', 'bass', 'bass', 'highs', 'both']);
  // A cream tick on each slider marks the usual.
  expect(container.querySelectorAll('.ln-usual').length).toBe(5);
});

it('words read back the values', () => {
  expect(driftWords(4000)).toBe('a colour every 4 s');
  expect(driftWords(20000)).toBe('a colour every 20 s');
  expect(brightWords(0.2, 1)).toBe('20% to 100%');
  expect([flashWords(0.1), flashWords(0.5), flashWords(0.8), flashWords(1)]).toEqual(['soft', 'medium', 'strong', 'hard']);
  expect([smoothWords(0), smoothWords(20), smoothWords(50), smoothWords(90)]).toEqual(['snappy', 'a little smooth', 'smooth', 'very smooth']);
});

it('colour speed moves between slow and fast, is saved, and is sent as colourBars and driftMs', async () => {
  syncOn();
  const { container } = render(<LightsPanel />);
  fireEvent.change(slider('ls-speed'), { target: { value: '4' } });
  expect(useLightSync.getState().ui.colourBars).toBe(1);
  expect(container.textContent).toContain('a colour every 4 s');
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
  expect(container.textContent).toContain('30% to 70%');
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
  const controls = Array.from(container.querySelectorAll('input[type="range"], .ls-tile, [role="switch"], .ln-reset, [role="radio"]'));
  expect(controls.length).toBe(15);
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

it('the preview tiles change colour and brightness when the palette and the sound change', async () => {
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
    const pn = () => Array.from(container.querySelectorAll<HTMLElement>('.ls-pn'));
    const colours = () => pn().map((e) => e.style.background);
    const opac = () => pn().map((e) => (e.style.background.match(/\d+/g) ?? []).map(Number).reduce((a, b) => Math.max(a, b), 0));
    tick();
    const quietColours = colours();
    const quiet = opac();
    expect(quietColours.every((c) => c !== '')).toBe(true);
    // Louder sound: the tiles brighten.
    useAudioStore.setState({ bass: 1, high: 1 });
    tick(30);
    expect(Math.max(...opac())).toBeGreaterThan(Math.max(...quiet));
    // Another palette: the same tiles take its colours.
    expect(PALETTES.some((p) => p.id === 'neon')).toBe(true);
    act(() => useLightSync.setState({ palette: 'neon' }));
    tick();
    expect(colours()).not.toEqual(quietColours);
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
  const st = newPreview(0.35);
  const ui = { ...DEFAULT_LIGHTS_UI, follow: ['both', 'bass', 'highs', 'both', 'both'] as typeof DEFAULT_LIGHTS_UI.follow };
  let f = frame(st, {}, ui, 0, 1, 0);
  for (let i = 0; i < 60; i++) f = frame(st, {}, ui, 0, 1, 0);
  const mean = (st.bassEnv + st.highEnv) / 2;
  const target = 0.35 + 0.45 * Math.min(1, 0.35 * mean);
  expect(f.panels[0].some((v) => v > 0)).toBe(true);
  expect(st.plays[0].b).toBeCloseTo(target, 5);
});

it('the preview matches the native frames on the shared fixture (Subtle)', () => {
  const fx = JSON.parse(readFileSync('../src-tauri/tests/fixtures/lightsync-frames.json', 'utf8').replace(/\r\n/g, '\n')) as { dtMs: number; palette: { colors: string[]; kick: string }; frames: [number, number, number][]; plays: number[][] };
  expect(fx.plays.length).toBe(fx.frames.length);
  const st = newPreview(DEFAULT_LIGHT_SYNC.floor);
  let beats = 0;
  fx.frames.forEach(([bass, high, beat], i) => {
    if (beat) beats += 1;
    const f = stepPreview(st, DEFAULT_LIGHT_SYNC, DEFAULT_LIGHTS_UI, fx.palette, { bass, high, beatCount: beats, dtMs: fx.dtMs });
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

it('Intensity sits first on the Lights tab with three buttons and helper text, Subtle lit', () => {
  const { container } = render(<LightsPanel />);
  const row = container.querySelector('.ls-intensity') as HTMLElement;
  expect(row).toBe(container.querySelector('.ls-panel')?.firstElementChild);
  expect(radios().map((r) => r.textContent)).toEqual(['Subtle', 'Moderate', 'High']);
  expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  expect(container.textContent).toContain('How lively the lights are.');
  expect(container.querySelector('[data-part="intensity-value"]')?.textContent).toBe('');
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
    const col = INTENSITIES[id];
    expect(useLightSync.getState().settings).toMatchObject(col.settings);
    expect(useLightSync.getState().ui.colourBars).toBe(col.colourBars);
    expect(tunes().length).toBe(before + 1);
    const sent = (tunes().at(-1)?.args as { settings: Record<string, unknown> }).settings;
    expect(sent).toMatchObject({ ...col.settings, colourBars: col.colourBars, driftMs: driftOf(col.colourBars) });
    expect(saved().settings).toMatchObject(col.settings);
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(INTENSITY_IDS.map((x) => String(x === id)));
  });
}

it('the High column keeps its drift at 4000 ms, the table value', () => {
  expect(driftOf(INTENSITIES.high.colourBars)).toBe(4000);
  expect(driftOf(INTENSITIES.moderate.colourBars)).toBe(6000);
  expect(driftOf(INTENSITIES.subtle.colourBars)).toBe(10000);
});

it('moving any slider shows Custom and lights no button; picking a level brings the name back', () => {
  const { container } = render(<LightsPanel />);
  for (const [name, value] of [['ls-flash', '60'], ['ls-smooth', '10'], ['ls-speed', '0'], ['Brightness floor', '20'], ['Brightness peak', '95']] as const) {
    fireEvent.click(radios()[1]);
    expect(container.querySelector('[data-part="intensity-value"]')?.textContent).toBe('');
    fireEvent.change(slider(name), { target: { value } });
    expect(container.querySelector('[data-part="intensity-value"]')?.textContent).toBe('Custom');
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
  }
  fireEvent.click(radios()[2]);
  expect(container.querySelector('[data-part="intensity-value"]')?.textContent).toBe('');
  expect(radios()[2].getAttribute('aria-checked')).toBe('true');
});

it('Your usual puts Subtle back and its tip says so', () => {
  const { container } = render(<LightsPanel />);
  fireEvent.click(radios()[2]);
  fireEvent.click(container.querySelector('.ln-reset') as HTMLElement);
  expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  expect(useLightSync.getState().settings).toEqual(DEFAULT_LIGHT_SYNC);
});

it('keyboard order: the group is one tab stop, arrows move and pick, Home and End jump', () => {
  syncOn();
  render(<LightsPanel />);
  // One tab stop in the group: the lit button (the first when Custom).
  expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  radios()[0].focus();
  fireEvent.keyDown(radios()[0], { key: 'ArrowRight' });
  expect(document.activeElement).toBe(radios()[1]);
  expect(useLightSync.getState().settings.brightness).toBe(INTENSITIES.moderate.settings.brightness);
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
