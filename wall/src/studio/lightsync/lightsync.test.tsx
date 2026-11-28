import { StrictMode } from 'react';
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { LIGHT_SYNC_KEY, loadLightSync, saveLightSync } from '../../settings/settings';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { setCoverTint, resetCoverTint } from '../../music/coverTint';
import { useNowPlayingStore } from '../../music/store';
import { resetHome, useHome } from '../homeStore';
import { SYNC_WIDTH, SYNC_WORD, fitMoodRow, syncChipModel } from '../moodRow';
import { OfficeMoods } from '../OfficeMoods';
import { SyncChip, SyncTip } from '../SyncChip';
import { renderToString } from 'react-dom/server';
import { DEFAULT_LIGHTS_UI, DEFAULT_LIGHT_SYNC, INTENSITIES, INTENSITY_IDS, PALETTES, intensityOf, engineSettings, clampSettings, isHex, resolvePalette, type PaletteId } from './model';
import { attachPoll, resetLightSync, useLightSync } from './store';

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
let startGate: Promise<void> | null;
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
  startGate = null;
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
    if (startGate) await startGate;
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
/** The switch at the chip's right end: it turns sync on and off. */
const toggleSwitch = () => syncChip().querySelector('[data-part="sync-switch"]') as HTMLElement;
/** The label side of the chip: a click anywhere on it opens the menu. */
const label = () => syncChip().querySelector('[data-part="sync-main"]') as HTMLElement;
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
  expect(SYNC_WIDTH).toBe(203);
});

it('states: idle, starting (spinner), on (lit), failed (warning icon)', async () => {
  expect(syncChipModel({ starting: false, running: false, failure: null, paletteName: 'x', hueNote: false })).toEqual({ lit: false, busy: false, failed: false });
  startHold = true;
  await show();
  expect(syncChip().getAttribute('data-state')).toBe('off');
  expect(toggleSwitch().getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggleSwitch());
  await flush();
  expect(syncChip().getAttribute('data-state')).toBe('starting');
  expect(syncChip().querySelector('.u-spin')).not.toBeNull();
  resetLightSync();
  startHold = false;
  await flush();
  fireEvent.click(toggleSwitch());
  await flush();
  expect(syncChip().getAttribute('data-state')).toBe('on');
  expect(syncChip().className).toContain('lit');
  expect(toggleSwitch().getAttribute('aria-checked')).toBe('true');
  // A failure: warning icon and a tip.
  fireEvent.click(toggleSwitch());
  await flush();
  startWord = 'bridge-unreachable';
  fireEvent.click(toggleSwitch());
  await flush();
  expect(syncChip().getAttribute('data-state')).toBe('failed');
  expect(syncChip().querySelector('.u-mood-ico.warn')).not.toBeNull();
  expect(await tipOf(toggleSwitch())).toContain('The Hue bridge did not answer.');
});

it('Button A: the label opens the menu and never toggles; the switch toggles and never opens it; aria-checked follows the state', async () => {
  await show();
  const sw = toggleSwitch();
  expect(sw.getAttribute('role')).toBe('switch');
  expect(sw.getAttribute('aria-checked')).toBe('false');
  // A click on the label opens the menu and sends nothing to the bridge.
  fireEvent.click(label());
  await flush();
  expect(slot().querySelector('[data-part="palette-strip"]')).not.toBeNull();
  expect(label().getAttribute('aria-expanded')).toBe('true');
  expect(count('wall2_lightsync_start')).toBe(0);
  expect(sw.getAttribute('aria-checked')).toBe('false');
  // A click on the padding of the chip (the chip itself) closes it again.
  fireEvent.click(syncChip());
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  // The switch turns sync on without opening the menu.
  fireEvent.click(sw);
  await flush();
  expect(count('wall2_lightsync_start')).toBe(1);
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  expect(toggleSwitch().getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggleSwitch());
  await flush();
  expect(toggleSwitch().getAttribute('aria-checked')).toBe('false');
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  // The colour dots left the chip.
  expect(syncChip().querySelector('.u-sync-dot')).toBeNull();
  // Both are real buttons in the tab order; each has its own tip.
  expect(label().tagName).toBe('BUTTON');
  expect(sw.tagName).toBe('BUTTON');
  expect(await tipOf(label())).toBe('Opens Music sync: colours and settings');
  expect(await tipOf(sw)).toContain('Turns Music sync on or off');
});

/** What a browser does for a key on a button (jsdom does not): Enter clicks on keydown, Space clicks on keyup. */
const press = (el: HTMLElement, key: 'Enter' | ' ') => {
  const down = fireEvent.keyDown(el, { key });
  if (key === 'Enter' && down) fireEvent.click(el);
  const up = fireEvent.keyUp(el, { key });
  if (key === ' ' && up && down) fireEvent.click(el);
};
const tabOrder = () => Array.from(slot().querySelectorAll<HTMLElement>('button, [role="switch"]'));

it('Button A by keyboard: Enter on the label opens the menu, Space on the switch toggles and leaves the menu closed, and Tab reaches the menu after the switch', async () => {
  await show();
  press(label(), 'Enter');
  await flush();
  expect(slot().querySelector('[data-part="palette-strip"]')).not.toBeNull();
  expect(count('wall2_lightsync_start')).toBe(0);
  // Tab order is DOM order: label, switch, then the menu it opened, then the moods.
  const order2 = tabOrder();
  const at = (e: Element | null) => order2.indexOf(e as HTMLElement);
  const firstPal = slot().querySelector('[data-part="palette-strip"] button');
  expect(at(label())).toBeLessThan(at(toggleSwitch()));
  expect(at(toggleSwitch())).toBeLessThan(at(firstPal));
  expect(at(firstPal)).toBeLessThan(at(mood('brightDesk')));
  // Close it, then Space on the switch: sync starts, the menu stays closed.
  press(label(), 'Enter');
  await flush();
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  press(toggleSwitch(), ' ');
  await flush();
  expect(count('wall2_lightsync_start')).toBe(1);
  expect(toggleSwitch().getAttribute('aria-checked')).toBe('true');
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  press(toggleSwitch(), ' ');
  await flush();
  expect(toggleSwitch().getAttribute('aria-checked')).toBe('false');
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
});

it('a failed start is said in words: the switch is described by the failure and the way to retry', async () => {
  await show();
  expect(toggleSwitch().getAttribute('aria-describedby')).toBeNull();
  useLightSync.setState({ failure: 'bridge-unreachable' });
  await flush();
  const id = toggleSwitch().getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  const note = document.getElementById(id as string);
  expect(note?.textContent).toContain('Music sync failed');
  expect(note?.textContent).toContain('did not answer');
  expect(note?.textContent).toContain('try again');
});

it('a blocked switch does nothing when pressed', async () => {
  const view = render(<SyncChip blocked />);
  await flush();
  const sw = view.container.querySelector('[data-part="sync-switch"]') as HTMLElement;
  expect(sw.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(sw);
  await flush();
  expect(count('wall2_lightsync_start')).toBe(0);
  expect(count('wall2_lightsync_stop')).toBe(0);
});

it('not paired: the tip points at Tools, and never shows a key or an address', async () => {
  startWord = 'not-paired';
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  const t = await tipOf(toggleSwitch());
  expect(t).toContain('Pair it in Tools');
  expect(t).not.toMatch(/\d+\.\d+\.\d+\.\d+|key/i);
});

it('the chip starts sync, and clicking it again stops sync then puts the lights back (the remembered mood)', async () => {
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  expect(count('wall2_lightsync_start')).toBe(1);
  expect(useLightSync.getState().remembered).toBe('brightDesk');
  // The home app now reads no mood lit while the Plays stream.
  list = list.map((m) => ({ ...m, active: false }));
  calls.length = 0;
  fireEvent.click(toggleSwitch());
  await flush();
  expect(order()).toEqual(['wall2_lightsync_stop', 'wall2_office_mood']);
  expect(calls[1].args).toEqual({ id: 'brightDesk' });
  expect(syncChip().getAttribute('data-state')).toBe('off');
});

it('lights back with no remembered mood is the stop alone', async () => {
  list = list.map((m) => ({ ...m, active: false }));
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  calls.length = 0;
  fireEvent.click(toggleSwitch());
  await flush();
  expect(order()).toEqual(['wall2_lightsync_stop']);
});

it('a mood chip while sync runs stops sync first (no lights back), then applies that mood', async () => {
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  calls.length = 0;
  fireEvent.click(mood('gaming'));
  await flush();
  expect(order()).toEqual(['wall2_lightsync_stop', 'wall2_office_mood']);
  expect(calls[1].args).toEqual({ id: 'gaming' });
});

it('the Off chip stops sync, then turns the office off', async () => {
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  calls.length = 0;
  fireEvent.click(mood('off'));
  await flush();
  expect(order()).toEqual(['wall2_lightsync_stop', 'wall2_office_off']);
});

it('"Stopped Hue Sync" shows once in the chip tip', async () => {
  hue = true;
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  expect(await tipOf(toggleSwitch())).toContain('Stopped Hue Sync');
  expect(await tipOf(toggleSwitch())).not.toContain('Stopped Hue Sync');
});

it('a settings read survives a throwing localStorage, and bad saved values are ignored', () => {
  const boom = {
    getItem: () => {
      throw new Error('blocked');
    },
  };
  expect(loadLightSync(boom)).toEqual({ palette: 'synthwave', settings: DEFAULT_LIGHT_SYNC, ui: DEFAULT_LIGHTS_UI, custom: [] });
  const odd = { getItem: () => JSON.stringify({ version: 2, palette: 'custom', settings: { brightness: 9, floor: 'x', sendHz: 1 } }) };
  const got = loadLightSync(odd);
  expect(got.palette).toBe('synthwave');
  expect(got.settings.brightness).toBe(1);
  expect(got.settings.floor).toBe(DEFAULT_LIGHT_SYNC.floor);
  expect(got.settings.sendHz).toBe(25);
  expect(LIGHT_SYNC_KEY).toBe('wall2.lightsync');
});

it('clamps mirror the native ranges, with the floor held under the brightness', () => {
  const c = clampSettings({ brightness: 0.2, floor: 0.4, bassGain: 9, attackMs: 1, releaseMs: 99999, rippleMs: NaN });
  expect(c).toMatchObject({ brightness: 0.2, floor: 0.1, bassGain: 2, attackMs: 40, releaseMs: 2000, rippleMs: 600 });
});

it('a value saved by the strobe engine loads as Subtle once, keeping palette, own colours, follow and ripple', () => {
  const old = {
    palette: 'custom',
    custom: ['#ff3d9a', '#35e6ea', '#9a7bff'],
    settings: { brightness: 0.85, floor: 0.06, kickFlash: 0.8, attackMs: 50, releaseMs: 380, bassGain: 1.5, plays: false },
    ui: { colourBars: 1, follow: ['bass', 'bass', 'highs', 'highs', 'both'], ripple: false },
  };
  const got = loadLightSync({ getItem: () => JSON.stringify(old) });
  expect(got.settings).toMatchObject({ ...INTENSITIES.subtle.settings, bassGain: 1.5, plays: false });
  expect(got.ui).toEqual({ ...DEFAULT_LIGHTS_UI, colourBars: INTENSITIES.subtle.colourBars, follow: ['bass', 'bass', 'highs', 'highs', 'both'], ripple: false });
  expect(got.palette).toBe('custom');
  expect(got.custom).toEqual(old.custom);
  // Saved again it carries the version, and the next load keeps what was chosen after it.
  let text = '';
  saveLightSync({ ...got, settings: { ...got.settings, floor: 0.2 } }, { setItem: (_k, v) => void (text = v) });
  expect(JSON.parse(text).version).toBe(2);
  expect(loadLightSync({ getItem: () => text }).settings.floor).toBe(0.2);
});

it('the move to Subtle is saved at load and a version 2 value is left as it is', () => {
  const store: Record<string, string> = { [LIGHT_SYNC_KEY]: JSON.stringify({ palette: 'neon', settings: { floor: 0.06 }, ui: { colourBars: 1 } }) };
  const io = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) };
  expect(loadLightSync(io).settings.floor).toBe(INTENSITIES.subtle.settings.floor);
  expect(JSON.parse(store[LIGHT_SYNC_KEY]).version).toBe(2);
  store[LIGHT_SYNC_KEY] = JSON.stringify({ ...JSON.parse(store[LIGHT_SYNC_KEY]), settings: { ...INTENSITIES.subtle.settings, floor: 0.2 } });
  expect(loadLightSync(io).settings.floor).toBe(0.2);
  const stale = { getItem: () => JSON.stringify({ version: '2', settings: { floor: 0.06 } }) };
  expect(loadLightSync(stale).settings.floor).toBe(INTENSITIES.subtle.settings.floor);
});

it.each(PALETTES.filter((p) => p.enabled).map((p) => p.id))('palette %s sends its colours on start', async (id) => {
  useLightSync.setState({ palette: id as PaletteId });
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  const sent = calls.find((c) => c.command === 'wall2_lightsync_start')?.args as { palette: { colors: string[]; kick: string; rest: string }; settings: unknown };
  expect(sent.palette.colors.length).toBeGreaterThanOrEqual(2);
  expect(sent.palette.colors.length).toBeLessThanOrEqual(6);
  for (const c of [...sent.palette.colors, sent.palette.kick, sent.palette.rest]) expect(isHex(c)).toBe(true);
  expect(sent.settings).toEqual(engineSettings(DEFAULT_LIGHT_SYNC, DEFAULT_LIGHTS_UI));
});

it('album art falls back to Synthwave without a cover, and uses the cover colours when it has them', () => {
  expect(resolvePalette('album').colors).toEqual(resolvePalette('synthwave').colors);
  expect(resolvePalette('album', { cover: ['#112233', '#445566'] }).colors).toEqual(['#112233', '#445566']);
});

it('the custom palette is enabled and opens the picker; with no colours kept the palette stays', async () => {
  await show();
  fireEvent.click(label());
  const custom = slot().querySelector('[data-palette="custom"]') as HTMLElement;
  expect(custom.getAttribute('aria-disabled')).toBeNull();
  fireEvent.click(custom);
  expect(useLightSync.getState().palette).toBe('synthwave');
  expect(useLightSync.getState().stripOpen).toBe(false);
  expect(slot().querySelector('[data-part="custom-picker"]')).not.toBeNull();
});

it('the strip opens and picks in two clicks, names in view, and the pick is remembered and tuned live', async () => {
  await show();
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  fireEvent.click(label());
  const strip = slot().querySelector('[data-part="palette-strip"]') as HTMLElement;
  expect(Array.from(strip.querySelectorAll('.u-pal')).map((b) => b.textContent)).toEqual(['Synthwave', 'Album art', 'Wall sky', 'Office mood', 'Electric Sheep', 'Neon City', 'Zen Tide', 'Your own']);
  fireEvent.click(within(strip).getByText('Neon City'));
  await flush();
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  expect(useLightSync.getState().palette).toBe('neon');
  expect(JSON.parse(localStorage.getItem(LIGHT_SYNC_KEY) ?? '{}').palette).toBe('neon');
  // While sync runs a pick tunes it.
  fireEvent.click(toggleSwitch());
  await flush();
  fireEvent.click(label());
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
  fireEvent.click(toggleSwitch());
  await flush();
  const sent = calls.find((c) => c.command === 'wall2_lightsync_start')?.args as { palette: { colors: string[] } };
  expect(sent.palette.colors).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  useNowPlayingStore.setState({ art: null });
  resetCoverTint();
});

const deferStart = () => {
  let open!: () => void;
  startGate = new Promise<void>((r) => (open = r));
  return open;
};

it('a mood clicked while the start is out wins: sync stops without lights back, then that mood applies', async () => {
  const open = deferStart();
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  fireEvent.click(mood('gaming'));
  await flush();
  expect(count('wall2_office_mood')).toBe(0);
  open();
  await flush(50);
  expect(order()).toEqual(['wall2_lightsync_start', 'wall2_lightsync_stop', 'wall2_office_mood']);
  expect(calls[1].args).toEqual({ restorePanels: true });
  expect(calls[2].args?.id).toBe('gaming');
  expect(useLightSync.getState().status).toBeNull();
});

it('Off clicked while the start is out wins, and the last click of two wins', async () => {
  const open = deferStart();
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  fireEvent.click(mood('gaming'));
  fireEvent.click(mood('off'));
  open();
  await flush(50);
  expect(order()).toEqual(['wall2_lightsync_start', 'wall2_lightsync_stop', 'wall2_office_off']);
});

it('unmounting the chip stops the status polling, and a remount resumes it', async () => {
  running = true;
  const view = await show();
  await flush(0);
  const base = count('wall2_lightsync_status');
  mocks.set('wall2_lightsync_status', () => {
    calls.push({ command: 'wall2_lightsync_status' });
    return { paired: true, bridgeChanged: false, running, starting: false, lastError: null, stoppedHueSync: false };
  });
  await flush(4100);
  expect(count('wall2_lightsync_status')).toBeGreaterThan(0);
  view.unmount();
  const after = count('wall2_lightsync_status');
  await flush(10_000);
  expect(count('wall2_lightsync_status')).toBe(after);
  expect(base).toBe(0);
  const detach = attachPoll();
  await flush(2100);
  expect(count('wall2_lightsync_status')).toBeGreaterThan(after);
  detach();
});

it('a failed stop keeps polling', async () => {
  running = true;
  await show();
  await flush(2100);
  mocks.set('wall2_lightsync_stop', () => {
    throw 'nope';
  });
  mocks.set('wall2_lightsync_status', () => {
    calls.push({ command: 'wall2_lightsync_status' });
    return { paired: true, bridgeChanged: false, running: true, starting: false, lastError: null, stoppedHueSync: false };
  });
  await act(async () => {
    await useLightSync.getState().stop();
  });
  const n = count('wall2_lightsync_status');
  await flush(4100);
  expect(count('wall2_lightsync_status')).toBeGreaterThan(n);
});

it('a mood then Off clicked during a stop: the last choice is applied, and Lights back is skipped', async () => {
  await show();
  fireEvent.click(toggleSwitch());
  await flush();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  mocks.set('wall2_lightsync_stop', async (args) => {
    calls.push({ command: 'wall2_lightsync_stop', args });
    await gate;
    running = false;
  });
  calls.length = 0;
  fireEvent.click(toggleSwitch());
  await flush();
  expect(useLightSync.getState().stopping).toBe(true);
  fireEvent.click(mood('gaming'));
  fireEvent.click(mood('off'));
  await flush();
  expect(count('wall2_office_mood') + count('wall2_office_off')).toBe(0);
  release();
  await flush(50);
  expect(order()).toEqual(['wall2_lightsync_stop', 'wall2_office_off']);
});

it('StrictMode mounts and a double detach never underflow the poll owners', async () => {
  running = true;
  const view = render(
    <StrictMode>
      <OfficeMoods />
    </StrictMode>,
  );
  await flush();
  mocks.set('wall2_lightsync_status', () => {
    calls.push({ command: 'wall2_lightsync_status' });
    return { paired: true, bridgeChanged: false, running: true, starting: false, lastError: null, stoppedHueSync: false };
  });
  await flush(4100);
  expect(count('wall2_lightsync_status')).toBeGreaterThan(0);
  view.unmount();
  // A second owner stays mounted while the first detaches twice: polling must go on.
  const keep = attachPoll();
  const a = attachPoll();
  a();
  a();
  calls.length = 0;
  await flush(4100);
  expect(count('wall2_lightsync_status')).toBeGreaterThan(0);
  keep();
  // Underflow would leave a negative count: one new owner must still poll.
  const again = attachPoll();
  calls.length = 0;
  await flush(4100);
  expect(count('wall2_lightsync_status')).toBeGreaterThan(0);
  again();
});

it('a status read in flight when stop begins sets no stale running state and starts no timer', async () => {
  running = true;
  await show();
  await flush(0);
  let releaseRead!: () => void;
  const readGate = new Promise<void>((r) => (releaseRead = r));
  let releaseStop!: () => void;
  const stopGate = new Promise<void>((r) => (releaseStop = r));
  mocks.set('wall2_lightsync_status', async () => {
    calls.push({ command: 'wall2_lightsync_status' });
    await readGate;
    return { paired: true, bridgeChanged: false, running: true, starting: false, lastError: null, stoppedHueSync: false };
  });
  mocks.set('wall2_lightsync_stop', async (args) => {
    calls.push({ command: 'wall2_lightsync_stop', args });
    await stopGate;
    running = false;
  });
  useLightSync.setState({ status: { paired: true, bridgeChanged: false, running: true, starting: false, lastError: null, stoppedHueSync: false } as never });
  await act(async () => {
    void useLightSync.getState().poll();
    void useLightSync.getState().stop();
    await vi.advanceTimersByTimeAsync(0);
  });
  releaseRead();
  await flush(0);
  releaseStop();
  await flush(0);
  expect(useLightSync.getState().status).toBeNull();
  calls.length = 0;
  await flush(10_000);
  expect(count('wall2_lightsync_status')).toBe(0);
});

it('the Hue note is taken in an effect: a double render under StrictMode still shows it once', async () => {
  hue = true;
  render(
    <StrictMode>
      <OfficeMoods />
      <HoverTipLayer />
    </StrictMode>,
  );
  await flush();
  fireEvent.click(toggleSwitch());
  await flush();
  expect(await tipOf(toggleSwitch())).toContain('Stopped Hue Sync');
  expect(await tipOf(toggleSwitch())).not.toContain('Stopped Hue Sync');
});

it('rendering the tip without committing it (no effects) does not consume the Hue note', () => {
  useLightSync.setState({ hueNote: true, status: { paired: true, bridgeChanged: false, running: true, starting: false, lastError: null, stoppedHueSync: true } as never });
  renderToString(<SyncTip />);
  renderToString(<SyncTip />);
  expect(useLightSync.getState().hueNote).toBe(true);
  const view = render(<SyncTip />);
  expect(view.container.textContent).toContain('Stopped Hue Sync');
  expect(useLightSync.getState().hueNote).toBe(false);
});

/** The plan's table, written out by hand so a wrong value in the model fails here. */
const COLUMNS = {
  subtle: { settings: { floor: 0.45, brightness: 0.8, energyDepth: 0.35, kickFlash: 0.25, kickWhite: 0, kickRiseMs: 80, kickDecayMs: 450, attackMs: 150, releaseMs: 900, levelWindow: 8, beatNudge: 0.04, minPulseGapMs: 500, slewDown: 0.8, bassGain: 1, highGain: 1 }, colourBars: 4, driftMs: 10000 },
  moderate: { settings: { floor: 0.35, brightness: 0.9, energyDepth: 0.55, kickFlash: 0.45, kickWhite: 0.15, kickRiseMs: 60, kickDecayMs: 320, attackMs: 100, releaseMs: 650, levelWindow: 4, beatNudge: 0.08, minPulseGapMs: 400, slewDown: 1.5, bassGain: 1, highGain: 1 }, colourBars: 2, driftMs: 6000 },
  high: { settings: { floor: 0.25, brightness: 1, energyDepth: 0.75, kickFlash: 0.7, kickWhite: 0.35, kickRiseMs: 40, kickDecayMs: 220, attackMs: 60, releaseMs: 420, levelWindow: 2, beatNudge: 0.15, minPulseGapMs: 340, slewDown: 3, bassGain: 1, highGain: 1 }, colourBars: 1, driftMs: 4000 },
} as const;

it('the store writes an intensity column, saves it and sends one tune; a field moved after it reads as Custom', () => {
  useLightSync.setState({ status: { paired: true, bridgeChanged: false, running: true, starting: false, lastError: null, stoppedHueSync: false } });
  mocks.set('wall2_lightsync_tune', (args) => {
    calls.push({ command: 'wall2_lightsync_tune', args });
  });
  for (const id of INTENSITY_IDS) {
    calls = [];
    useLightSync.getState().setIntensity(id);
    const col = COLUMNS[id];
    const { settings, ui } = useLightSync.getState();
    expect(settings).toMatchObject(col.settings);
    expect(ui.colourBars).toBe(col.colourBars);
    expect(intensityOf(settings, ui)).toBe(id);
    expect(count('wall2_lightsync_tune')).toBe(1);
    expect((calls[0].args as { settings: Record<string, unknown> }).settings).toMatchObject({ ...col.settings, driftMs: col.driftMs });
    expect(JSON.parse(localStorage.getItem(LIGHT_SYNC_KEY) ?? '{}').settings).toMatchObject(col.settings);
    useLightSync.getState().setSettings({ kickFlash: 0.6 });
    expect(intensityOf(useLightSync.getState().settings, useLightSync.getState().ui)).toBeNull();
  }
});

it('a new install is on Subtle, and with sync off an intensity pick sends nothing', () => {
  const { settings, ui } = useLightSync.getState();
  expect(intensityOf(settings, ui)).toBe('subtle');
  useLightSync.getState().setIntensity('high');
  expect(count('wall2_lightsync_tune')).toBe(0);
  useLightSync.getState().resetLights();
  expect(intensityOf(useLightSync.getState().settings, useLightSync.getState().ui)).toBe('subtle');
});
