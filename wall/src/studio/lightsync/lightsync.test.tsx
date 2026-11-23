import { StrictMode } from 'react';
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
import { SyncTip } from '../SyncChip';
import { renderToString } from 'react-dom/server';
import { DEFAULT_LIGHTS_UI, DEFAULT_LIGHT_SYNC, PALETTES, engineSettings, clampSettings, isHex, resolvePalette, type PaletteId } from './model';
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
const main = () => syncChip().querySelector('[data-part="sync-switch"]') as HTMLElement;
/** The label side of the chip: a click anywhere on it opens the menu. */
const dots = () => syncChip().querySelector('[data-part="sync-main"]') as HTMLElement;
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
  expect(SYNC_WIDTH).toBe(208);
});

it('states: idle, starting (spinner), on (lit), failed (warning icon)', async () => {
  expect(syncChipModel({ starting: false, running: false, failure: null, paletteName: 'x', hueNote: false })).toEqual({ lit: false, busy: false, failed: false });
  startHold = true;
  await show();
  expect(syncChip().getAttribute('data-state')).toBe('off');
  expect(main().getAttribute('aria-checked')).toBe('false');
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
  expect(main().getAttribute('aria-checked')).toBe('true');
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

it('Button A: the label opens the menu and never toggles; the switch toggles and never opens it; aria-checked follows the state', async () => {
  await show();
  const sw = main();
  expect(sw.getAttribute('role')).toBe('switch');
  expect(sw.getAttribute('aria-checked')).toBe('false');
  // A click on the label opens the menu and sends nothing to the bridge.
  fireEvent.click(dots());
  await flush();
  expect(slot().querySelector('[data-part="palette-strip"]')).not.toBeNull();
  expect(dots().getAttribute('aria-expanded')).toBe('true');
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
  expect(main().getAttribute('aria-checked')).toBe('true');
  fireEvent.click(main());
  await flush();
  expect(main().getAttribute('aria-checked')).toBe('false');
  expect(slot().querySelector('[data-part="palette-strip"]')).toBeNull();
  // The colour dots left the chip.
  expect(syncChip().querySelector('.u-sync-dot')).toBeNull();
  // Both are real buttons in the tab order; each has its own tip.
  expect(dots().tagName).toBe('BUTTON');
  expect(sw.tagName).toBe('BUTTON');
  expect(await tipOf(dots())).toBe('Opens Music sync: colours and settings');
  expect(await tipOf(sw)).toContain('Turns Music sync on or off');
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
  expect(loadLightSync(boom)).toEqual({ palette: 'synthwave', settings: DEFAULT_LIGHT_SYNC, ui: DEFAULT_LIGHTS_UI, custom: [] });
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
  expect(sent.settings).toEqual(engineSettings(DEFAULT_LIGHT_SYNC, DEFAULT_LIGHTS_UI));
});

it('album art falls back to Synthwave without a cover, and uses the cover colours when it has them', () => {
  expect(resolvePalette('album').colors).toEqual(resolvePalette('synthwave').colors);
  expect(resolvePalette('album', { cover: ['#112233', '#445566'] }).colors).toEqual(['#112233', '#445566']);
});

it('the custom palette is enabled and opens the picker; with no colours kept the palette stays', async () => {
  await show();
  fireEvent.click(dots());
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
  fireEvent.click(dots());
  const strip = slot().querySelector('[data-part="palette-strip"]') as HTMLElement;
  expect(Array.from(strip.querySelectorAll('.u-pal')).map((b) => b.textContent)).toEqual(['Synthwave', 'Album art', 'Wall sky', 'Office mood', 'Electric Sheep', 'Neon City', 'Zen Tide', 'Your own']);
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

const deferStart = () => {
  let open!: () => void;
  startGate = new Promise<void>((r) => (open = r));
  return open;
};

it('a mood clicked while the start is out wins: sync stops without lights back, then that mood applies', async () => {
  const open = deferStart();
  await show();
  fireEvent.click(main());
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
  fireEvent.click(main());
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
  fireEvent.click(main());
  await flush();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  mocks.set('wall2_lightsync_stop', async (args) => {
    calls.push({ command: 'wall2_lightsync_stop', args });
    await gate;
    running = false;
  });
  calls.length = 0;
  fireEvent.click(main());
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
  fireEvent.click(main());
  await flush();
  expect(await tipOf(main())).toContain('Stopped Hue Sync');
  expect(await tipOf(main())).not.toContain('Stopped Hue Sync');
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
