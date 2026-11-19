import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { LIGHT_SYNC_KEY, loadLightSync } from '../../settings/settings';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { setCoverTint, resetCoverTint } from '../../music/coverTint';
import { useNowPlayingStore } from '../../music/store';
import { resetHome, useHome } from '../homeStore';
import { SYNC_WIDTH, SYNC_WORD, fitMoodRow, syncChipModel } from '../moodRow';
import { OfficeMoods } from '../OfficeMoods';
import { DEFAULT_LIGHT_SYNC, PALETTES, clampSettings, isHex, resolvePalette, type PaletteId } from './model';
import { resetLightSync, useLightSync } from './store';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let calls: { command: string; args?: Record<string, unknown> }[];
let list: { id: string; label: string; line: string | null; active: boolean }[];
let off: { active: boolean } | null;
let running: boolean;
let hue: boolean;
let startWord: string | null;
let startHold: boolean;
const order = () => calls.map((c) => c.command);
const count = (c: string) => calls.filter((x) => x.command === c).length;

beforeEach(() => {
  vi.useFakeTimers();
  resetHome();
  resetTip();
  localStorage.clear();
  resetLightSync();
  calls = [];
  list = [
    { id: 'brightDesk', label: 'Bright desk', line: null, active: true },
    { id: 'gaming', label: 'Gaming', line: null, active: false },
  ];
  off = { active: false };
  running = false;
  hue = false;
  startWord = null;
  startHold = false;
  const answer = () => ({ stale: false, moods: list.map((m) => ({ ...m })), off, canWrite: true, writeBlock: null });
  mocks.set('wall2_office_moods', () => answer());
  mocks.set('wall2_office_mood', (args) => {
    calls.push({ command: 'wall2_office_mood', args });
    list = list.map((m) => ({ ...m, active: m.id === args?.id }));
    return answer();
  });
  mocks.set('wall2_office_off', () => {
    calls.push({ command: 'wall2_office_off' });
    list = list.map((m) => ({ ...m, active: false }));
    off = { active: true };
    return answer();
  });
  mocks.set('wall2_lightsync_status', () => ({ paired: true, bridgeChanged: false, running, starting: false, lastError: null, stoppedHueSync: running && hue }));
  mocks.set('wall2_lightsync_start', async (args) => {
    calls.push({ command: 'wall2_lightsync_start', args });
    if (startHold) await new Promise<never>(() => undefined);
    if (startWord) throw startWord;
    running = true;
    // Start turns the Plays on: the home app's mood read no longer shows one lit.
    return 'started';
  });
  mocks.set('wall2_lightsync_tune', (args) => {
    calls.push({ command: 'wall2_lightsync_tune', args });
  });
  mocks.set('wall2_lightsync_stop', (args) => {
    calls.push({ command: 'wall2_lightsync_stop', args });
    running = false;
  });
});
afterEach(() => {
  resetLightSync();
  vi.useRealTimers();
  mocks.clear();
  resetHome();
  resetTip();
});

const show = async () => {
  const view = render(
    <>
      <OfficeMoods />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const slot = () => document.querySelector('[data-slot="office-lights"]') as HTMLElement;
const syncChip = () => slot().querySelector('[data-mood="sync"]') as HTMLElement;
const main = () => syncChip().querySelector('[data-part="sync-main"]') as HTMLElement;
const dots = () => syncChip().querySelector('[data-part="sync-dots"]') as HTMLElement;
const mood = (id: string) => slot().querySelector(`[data-mood="${id}"]`) as HTMLElement;
const tipOf = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(300);
  const t = document.querySelector('.hover-tip')?.textContent ?? '';
  fireEvent.mouseLeave(el);
  await flush(300);
  return t;
};

it('the chip is first in the row and its width is a fixed part of the fit rule', async () => {
  await show();
  const chips = [...slot().querySelectorAll('.u-mood')];
  expect(chips[0]).toBe(syncChip());
  expect(syncChip().textContent).toContain(SYNC_WORD);
  // The fit rule counts the chip's fixed width, and that width does not shrink with the names.
  const names = Array(4).fill(100);
  const without = fitMoodRow(names, 160, 80, 130);
  const withSync = fitMoodRow(names, 160, 80, 130, SYNC_WIDTH);
  expect(without.label).toBe(true);
  expect(withSync.label).toBe(false);
  expect(SYNC_WIDTH).toBe(216);
});

it('states: idle, starting (spinner), on (lit), failed (warning icon)', async () => {
  expect(syncChipModel({ starting: false, running: false, failure: null, paletteName: 'x', hueNote: false })).toEqual({ lit: false, busy: false, failed: false });
  startHold = true;
  await show();
  expect(syncChip().getAttribute('data-state')).toBe('off');
  expect(main().getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(main());
  await flush();
  expect(syncChip().getAttribute('data-state')).toBe('starting');
  expect(syncChip().querySelector('.u-spin')).not.toBeNull();
  resetLightSync();
  startHold = false;
  await flush();
  fireEvent.click(main());
  await flush();
  expect(syncChip().getAttribute('data-state')).toBe('on');
  expect(syncChip().className).toContain('lit');
  expect(main().getAttribute('aria-pressed')).toBe('true');
  // A failure: warning icon and a tip.
  fireEvent.click(main());
  await flush();
  startWord = 'bridge-unreachable';
  fireEvent.click(main());
  await flush();
  expect(syncChip().getAttribute('data-state')).toBe('failed');
  expect(syncChip().querySelector('.u-mood-ico.warn')).not.toBeNull();
  expect(await tipOf(main())).toContain('The Hue bridge did not answer.');
});

it('not paired: the tip points at Tools, and never shows a key or an address', async () => {
  startWord = 'not-paired';
  await show();
  fireEvent.click(main());
  await flush();
  const t = await tipOf(main());
  expect(t).toContain('Pair it in Tools');
  expect(t).not.toMatch(/\d+\.\d+\.\d+\.\d+|key/i);
});

it('the chip starts sync, and clicking it again stops sync then puts the lights back (the remembered mood)', async () => {
  await show();
  fireEvent.click(main());
  await flush();
  expect(count('wall2_lightsync_start')).toBe(1);
  expect(useLightSync.getState().remembered).toBe('brightDesk');
  // The home app now reads no mood lit while the Plays stream.
  list = list.map((m) => ({ ...m, active: false }));
  calls.length = 0;
  fireEvent.click(main());
  await flush();
  expect(order()).toEqual(['wall2_lightsync_stop', 'wall2_office_mood']);
  expect(calls[1].args).toEqual({ id: 'brightDesk' });
  expect(syncChip().getAttribute('data-state')).toBe('off');
});

it('lights back with no remembered mood is the stop alone', async () => {
  list = list.map((m) => ({ ...m, active: false }));
  await show();
  fireEvent.click(main());
  await flush();
  calls.length = 0;
  fireEvent.click(main());
  await flush();
  expect(order()).toEqual(['wall2_lightsync_stop']);
});

it('a mood chip while sync runs stops sync first (no lights back), then applies that mood', async () => {
  await show();
  fireEvent.click(main());
  await flush();
  calls.length = 0;
  fireEvent.click(mood('gaming'));
  await flush();
  expect(order()).toEqual(['wall2_lightsync_stop', 'wall2_office_mood']);
  expect(calls[1].args).toEqual({ id: 'gaming' });
});

it('the Off chip stops sync, then turns the office off', async () => {
  await show();
  fireEvent.click(main());
  await flush();
  calls.length = 0;
  fireEvent.click(mood('off'));
  await flush();
  expect(order()).toEqual(['wall2_lightsync_stop', 'wall2_office_off']);
});

it('"Stopped Hue Sync" shows once in the chip tip', async () => {
  hue = true;
  await show();
  fireEvent.click(main());
  await flush();
  expect(await tipOf(main())).toContain('Stopped Hue Sync');
  expect(await tipOf(main())).not.toContain('Stopped Hue Sync');
});

it('a settings read survives a throwing localStorage, and bad saved values are ignored', () => {
  const boom = {
    getItem: () => {
      throw new Error('blocked');
    },
  };
  expect(loadLightSync(boom)).toEqual({ palette: 'synthwave', settings: DEFAULT_LIGHT_SYNC });
  const odd = { getItem: () => JSON.stringify({ palette: 'custom', settings: { brightness: 9, floor: 'x', sendHz: 1 } }) };
  const got = loadLightSync(odd);
  expect(got.palette).toBe('synthwave');
  expect(got.settings.brightness).toBe(1);
  expect(got.settings.floor).toBe(DEFAULT_LIGHT_SYNC.floor);
  expect(got.settings.sendHz).toBe(25);
  expect(LIGHT_SYNC_KEY).toBe('wall2.lightsync');
});

it('clamps mirror the native ranges, with the floor held under the brightness', () => {
  const c = clampSettings({ brightness: 0.2, floor: 0.4, bassGain: 9, attackMs: 1, releaseMs: 99999, rippleMs: NaN });
  expect(c).toMatchObject({ brightness: 0.2, floor: 0.2, bassGain: 2, attackMs: 20, releaseMs: 1500, rippleMs: 600 });
});

it.each(PALETTES.filter((p) => p.enabled).map((p) => p.id))('palette %s sends its colours on start', async (id) => {
  useLightSync.setState({ palette: id as PaletteId });
  await show();
  fireEvent.click(main());
  await flush();
  const sent = calls.find((c) => c.command === 'wall2_lightsync_start')?.args as { palette: { colors: string[]; kick: string; rest: string }; settings: unknown };
  expect(sent.palette.colors.length).toBeGreaterThanOrEqual(2);
  expect(sent.palette.colors.length).toBeLessThanOrEqual(6);
  for (const c of [...sent.palette.colors, sent.palette.kick, sent.palette.rest]) expect(isHex(c)).toBe(true);
  expect(sent.settings).toEqual(DEFAULT_LIGHT_SYNC);
});

it('album art falls back to Synthwave without a cover, and uses the cover colours when it has them', () => {
  expect(resolvePalette('album').colors).toEqual(resolvePalette('synthwave').colors);
  expect(resolvePalette('album', { cover: ['#112233', '#445566'] }).colors).toEqual(['#112233', '#445566']);
});

it('the custom palette is shown but disabled, and never picked', async () => {
  await show();
  fireEvent.click(dots());
  const custom = slot().querySelector('[data-palette="custom"]') as HTMLElement;
  expect(custom.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(custom);
  expect(useLightSync.getState().palette).toBe('synthwave');
  expect(useLightSync.getState().stripOpen).toBe(true);
});

it('the strip opens and picks in two clicks, names in view, and the pick is remembered and tuned live', async () => {
  await show();
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  fireEvent.click(dots());
  const strip = slot().querySelector('[data-part="palette-strip"]') as HTMLElement;
  expect(within(strip).getAllByRole('button').map((b) => b.textContent)).toEqual(['Synthwave', 'Album art', 'Wall sky', 'Office mood', 'Electric Sheep', 'Neon City', 'Zen Tide', 'Your own']);
  fireEvent.click(within(strip).getByText('Neon City'));
  await flush();
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  expect(useLightSync.getState().palette).toBe('neon');
  expect(JSON.parse(localStorage.getItem(LIGHT_SYNC_KEY) ?? '{}').palette).toBe('neon');
  // While sync runs a pick tunes it.
  fireEvent.click(main());
  await flush();
  fireEvent.click(dots());
  fireEvent.click(within(slot().querySelector('[data-part="palette-strip"]') as HTMLElement).getByText('Zen Tide'));
  await flush();
  expect(count('wall2_lightsync_tune')).toBe(1);
  expect((calls.find((c) => c.command === 'wall2_lightsync_tune')?.args as { palette: { colors: string[] } }).palette.colors).toEqual(resolvePalette('zen').colors);
  void useHome;
});

it('Album art sends the colours of the cover now playing, read from the lines follower', async () => {
  useNowPlayingStore.setState({ art: 'cover.jpg' });
  setCoverTint({ left: [255, 0, 0], centre: [0, 255, 0], right: [0, 0, 255] }, 0, true);
  useLightSync.setState({ palette: 'album' });
  await show();
  fireEvent.click(main());
  await flush();
  const sent = calls.find((c) => c.command === 'wall2_lightsync_start')?.args as { palette: { colors: string[] } };
  expect(sent.palette.colors).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  useNowPlayingStore.setState({ art: null });
  resetCoverTint();
});
