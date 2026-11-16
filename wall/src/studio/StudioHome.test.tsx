import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { IDLE } from '../onair/model';
import { useOnAirStore } from '../onair/store';
import { useSignalStore } from '../signals/store';
import { resetTools, useToolsStore } from '../tools/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { group, studioAnswer, studioWith } from './homeKit';
import { OFFER_MS, resetHome, useHome } from './homeStore';
import { LightsChip } from './LightsChip';
import { shortWords } from './SheetHome';
import { studioOf } from './home';
import { StudioBlock } from './StudioBlock';
import { resetKeyLights, useKeyLights } from './store';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let answer: Record<string, unknown>;
let writes: { command: string; args?: Record<string, unknown> }[];
let writeWord: string | null;

const keysOn = { on: true, brightness: 60, kelvin: 4400 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-14T10:00:00-08:00'));
  resetKeyLights();
  resetTools();
  resetTip();
  useOnAirStore.setState({ saved: IDLE });
  useSignalStore.setState({ known: true, recording: false });
  resetHome();
  answer = studioAnswer();
  writes = [];
  writeWord = null;
  mocks.set('wall2_keylights_status', () => ({ left: { set: true }, right: { set: true } }));
  mocks.set('wall2_keylights_read', () => ({ left: keysOn, right: keysOn }));
  mocks.set('wall2_studio', () => answer);
  for (const c of ['wall2_studio_preset', 'wall2_studio_normal', 'wall2_studio_group', 'wall2_studio_look']) {
    mocks.set(c, (args) => {
      writes.push({ command: c, args });
      if (writeWord) throw writeWord;
      return answer;
    });
  }
});
afterEach(() => {
  resetHome();
  vi.useRealTimers();
  mocks.clear();
  useSignalStore.setState({ recording: false });
});

const showBlock = async () => {
  const view = render(
    <>
      <StudioBlock />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const chipOf = (name: string) => screen.getByText(name).closest('button') as HTMLElement;
const tipOf = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(300);
  return document.querySelector('.hover-tip')?.textContent ?? '';
};

// Section: the block

it('ready, nothing on: the preset chips in the home app order, Back to normal dashed, the key light words, four switches', async () => {
  await showBlock();
  const row = within(screen.getByRole('group', { name: 'Presets' }));
  expect(row.getAllByRole('button').map((b) => b.textContent)).toEqual(['On air', 'Recording', 'Back to normal', 'Fine tune']);
  expect(chipOf('Back to normal').getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByText('No preset on.')).toBeTruthy();
  expect(screen.getByText(/Key lights 60%, 4400 K/)).toBeTruthy();
  expect(screen.getAllByRole('switch').map((s) => s.textContent)).toEqual(['Key lights', 'Panels', 'Behind monitor', 'Overhead']);
  expect(screen.queryByText(/does not offer them here yet/)).toBeNull();
});

it('a preset chip tip is its line; Back to normal says there is nothing to go back from', async () => {
  await showBlock();
  expect(await tipOf(chipOf('On air'))).toContain('Key lights on, panels glow');
  expect(await tipOf(chipOf('Back to normal'))).toContain('Nothing to go back from');
});

it('a click applies the preset and the chip shows the read back, with the check and the summary', async () => {
  await showBlock();
  answer = studioWith('onAir');
  fireEvent.click(chipOf('On air'));
  await flush();
  expect(writes).toEqual([{ command: 'wall2_studio_preset', args: { id: 'onAir' } }]);
  expect(chipOf('On air').getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('On air:')).toBeTruthy();
  expect(screen.getByText(/Key lights on, panels glow/)).toBeTruthy();
  expect(chipOf('Back to normal').getAttribute('aria-disabled')).toBeNull();
  fireEvent.click(chipOf('Back to normal'));
  await flush();
  expect(writes[1].command).toBe('wall2_studio_normal');
});

it('changed says only that it changed: an amber dot, "On air, changed" and since it was set', async () => {
  answer = studioWith('onAir', { changed: true });
  await showBlock();
  expect(screen.getByText('On air, changed', { selector: 'span' })).toBeTruthy();
  expect(document.querySelector('.st-preset .st-dot')).toBeTruthy();
  expect(screen.getByText('since it was set')).toBeTruthy();
  const tip = await tipOf(screen.getByText('since it was set'));
  expect(tip).toContain('Hue app');
  expect(tip).toContain('HomeKit');
});

it('stale shows the values with (not fresh) and a tip; an unreachable group is dim', async () => {
  answer = studioAnswer({ stale: true, groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', true, 80), group('overhead', 'Overhead', true, 90, { reachable: false })] });
  await showBlock();
  expect(screen.getByText('(not fresh)')).toBeTruthy();
  const oh = screen.getByText('Overhead').closest('[role="switch"]') as HTMLElement;
  expect(oh.className).toContain('dim');
  expect(await tipOf(oh)).toContain('Not answering');
});

it('the home app away: amber line, dashed chips and tiles that take no click, Try again reads again', async () => {
  await showBlock();
  mocks.set('wall2_studio', () => {
    throw 'unreachable';
  });
  await act(async () => useHome.getState().readStudio());
  await flush();
  expect(screen.getByText('The home app is not answering.')).toBeTruthy();
  expect(chipOf('On air').getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(chipOf('On air'));
  fireEvent.click(screen.getByText('Overhead'));
  await flush();
  expect(writes).toHaveLength(0);
  // Key lights are unaffected.
  expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('true');
  mocks.set('wall2_studio', () => answer);
  fireEvent.click(screen.getByText('Try again'));
  await flush();
  expect(screen.queryByText('The home app is not answering.')).toBeNull();
});

it('never read and not answering: the key lights as before and one amber line with Try again', async () => {
  mocks.set('wall2_studio', () => {
    throw 'failed';
  });
  await showBlock();
  expect(screen.getByText('The home app is not answering.')).toBeTruthy();
  expect(screen.getByText('Try again')).toBeTruthy();
  expect(screen.getByText('Fine tune')).toBeTruthy();
});

it('absent, not set up at the home app: the quiet line with Check again, key lights as today, no offer', async () => {
  for (const word of ['absent', 'studio-not-set-up', 'not-configured']) {
    resetHome();
    mocks.set('wall2_studio', () => {
      throw word;
    });
    const view = await showBlock();
    expect(screen.getByText('Presets and room lights: the home app does not offer them here yet.')).toBeTruthy();
    expect(screen.getByText('Check again')).toBeTruthy();
    expect(screen.getByText('Fine tune')).toBeTruthy();
    expect(screen.queryByText('Back to normal')).toBeNull();
    view.unmount();
  }
});

it('no token on this PC: every home control disabled, the line says where to type it, Open Tools opens Tools at Home app', async () => {
  answer = studioAnswer({ canWrite: false, writeBlock: 'not-set-up' });
  await showBlock();
  expect(screen.getByText("To change these, type the home app's desk token in Tools.")).toBeTruthy();
  expect(chipOf('On air').getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(chipOf('On air'));
  fireEvent.click(screen.getByText('Panels'));
  await flush();
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByText('Open Tools'));
  expect(useToolsStore.getState().open).toBe(true);
  expect(useToolsStore.getState().focus).toBe('desktoken');
});

it('a base the token may not go to: disabled, the https or tailnet line, Check again, a tip that names homeBaseUrl and never the base', async () => {
  answer = studioAnswer({ canWrite: false, writeBlock: 'needs-private-address' });
  await showBlock();
  expect(screen.getByText('The home app must be reached over https or the tailnet to take changes.')).toBeTruthy();
  const check = screen.getByText('Check again').closest('button') as HTMLElement;
  expect(await tipOf(check)).toContain('homeBaseUrl');
  const reads = vi.fn(() => answer);
  mocks.set('wall2_studio', reads);
  fireEvent.click(check);
  await flush();
  expect(reads).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toMatch(/https?:\/\//);
});

it('a group that needs a Hue zone is dashed and disabled with its tip, and takes no click', async () => {
  answer = studioAnswer({ groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', true, 80), group('overhead', 'Overhead', false, 0, { canSwitch: false, canDim: false, setTo: 'Needs a Hue zone', floor: null })] });
  await showBlock();
  const oh = screen.getByText('Overhead').closest('[role="switch"]') as HTMLElement;
  expect(oh.getAttribute('aria-disabled')).toBe('true');
  expect(await tipOf(oh)).toContain('The home app needs a Hue zone for this light group. Its README says how.');
  fireEvent.click(oh);
  await flush();
  expect(writes).toHaveLength(0);
});

it('a room switch writes its id and the opposite state, and shows what was read back', async () => {
  await showBlock();
  fireEvent.click(screen.getByText('Panels'));
  await flush();
  expect(writes).toEqual([{ command: 'wall2_studio_group', args: { id: 'panels', on: true } }]);
  // The home app says it did not turn on: the switch stays off.
  expect(screen.getByText('Panels').closest('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
});

it('the second room switch will not turn off while the other room light is off, with the dark-room tip, and sends nothing', async () => {
  answer = studioAnswer({ groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', false, 0), group('overhead', 'Overhead', true, 90)] });
  await showBlock();
  const oh = screen.getByText('Overhead').closest('[role="switch"]') as HTMLElement;
  expect(oh.getAttribute('aria-disabled')).toBe('true');
  expect(await tipOf(oh)).toContain('One room light stays on so the room is never dark around the monitor');
  fireEvent.click(oh);
  await flush();
  expect(writes).toHaveLength(0);
  // The one that is off can still be turned on.
  const bm = screen.getByText('Behind monitor').closest('[role="switch"]') as HTMLElement;
  expect(bm.getAttribute('aria-disabled')).toBeNull();
});

it('the home app refusing with room-dark springs the switch back and says why for five seconds', async () => {
  await showBlock();
  writeWord = 'room-dark';
  fireEvent.click(screen.getByText('Overhead'));
  await flush();
  expect(screen.getByText('One room light stays on, so the room is never dark around the monitor.')).toBeTruthy();
  expect(screen.getByText('Overhead').closest('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  await flush(5100);
  expect(screen.queryByText(/never dark around the monitor\./)).toBeNull();
});

it('a refused desk token and a home app without one stay as amber lines with their action', async () => {
  await showBlock();
  writeWord = 'forbidden';
  fireEvent.click(chipOf('On air'));
  await flush();
  expect(screen.getByText('The home app refused the desk token. Type it again in Tools.')).toBeTruthy();
  fireEvent.click(screen.getByText('Open Tools'));
  expect(useToolsStore.getState().focus).toBe('desktoken');
  writeWord = 'home-not-set-up';
  fireEvent.click(chipOf('On air'));
  await flush();
  expect(screen.getByText('The home app has no desk token yet. Set the same token there.')).toBeTruthy();
  expect(screen.getByText('Try again')).toBeTruthy();
  await flush(30_000);
  expect(screen.getByText('The home app has no desk token yet. Set the same token there.')).toBeTruthy();
});

it('busy and a light that did not answer say so for five seconds, then the read back shows', async () => {
  await showBlock();
  writeWord = 'busy';
  fireEvent.click(chipOf('On air'));
  await flush();
  expect(screen.getByText('The home app is busy with another light change. Try again in a moment.')).toBeTruthy();
  await flush(5100);
  expect(screen.queryByText(/busy with another/)).toBeNull();
  writeWord = 'not-answering';
  fireEvent.click(chipOf('On air'));
  await flush();
  expect(screen.getByText('A light did not answer the home app. This shows what it reports now.')).toBeTruthy();
});

it('three presets: Fine tune is the icon alone', async () => {
  const more = (answer.presets as Record<string, unknown>[]).concat([{ id: 'night', label: 'Night', line: 'Room 10%', active: false, setsKeyLights: false }]);
  answer = studioAnswer({ presets: more });
  await showBlock();
  const row = within(screen.getByRole('group', { name: 'Presets' }));
  expect(row.getAllByRole('button').map((b) => b.textContent)).toEqual(['On air', 'Recording', 'Night', 'Back to normal', '']);
  expect(row.getByRole('button', { name: 'Fine tune' })).toBeTruthy();
});

it('the key lights tile still works with the home part present', async () => {
  await showBlock();
  const sent = vi.fn(() => ({ left: { on: false, brightness: 60, kelvin: 4400 }, right: { on: false, brightness: 60, kelvin: 4400 } }));
  mocks.set('wall2_keylights_set', sent);
  fireEvent.click(screen.getAllByRole('switch')[0]);
  await flush();
  expect(sent).toHaveBeenCalledWith({ side: 'both', on: false });
});

// Section: the offer

const startTimer = () => useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: true, startedAt: Date.now(), firstStartAt: s.saved.firstStartAt ?? Date.now() } }));
const stopTimer = () => useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: false, startedAt: null, accumulatedMs: 5000, stoppedAt: Date.now() } }));

it('the offer bar takes the place of the preset row and the summary; Set for the stream applies On air', async () => {
  await showBlock();
  await act(async () => startTimer());
  await flush();
  expect(screen.getByText('Studio lights are not set.')).toBeTruthy();
  expect(screen.getByText('The timer started just now.')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Presets' })).toBeNull();
  expect(screen.queryByText('No preset on.')).toBeNull();
  // Nothing was applied by the offer being there.
  expect(writes).toHaveLength(0);
  answer = studioWith('onAir');
  fireEvent.click(screen.getByText('Set for the stream'));
  await flush();
  expect(writes).toEqual([{ command: 'wall2_studio_preset', args: { id: 'onAir' } }]);
  expect(screen.queryByText('Studio lights are not set.')).toBeNull();
  expect(screen.getByRole('group', { name: 'Presets' })).toBeTruthy();
});

it('Not now leaves the lights alone and the bar goes; the bar also goes by itself after a minute', async () => {
  await showBlock();
  await act(async () => startTimer());
  await flush();
  fireEvent.click(screen.getByText('Not now'));
  await flush();
  expect(writes).toHaveLength(0);
  expect(screen.queryByText('Studio lights are not set.')).toBeNull();
  stopTimer();
  await flush();
  useHome.getState().dismissOffer();
  await act(async () => useSignalStore.setState({ recording: true }));
  await flush();
  expect(screen.getByText('A recording started just now.')).toBeTruthy();
  await flush(OFFER_MS + 100);
  expect(screen.queryByText('A recording started just now.')).toBeNull();
});

it('the stop offer names the preset the room is on, with Back to normal and Keep', async () => {
  answer = studioWith('onAir');
  await showBlock();
  await act(async () => startTimer());
  await flush();
  await act(async () => stopTimer());
  await flush();
  expect(screen.getByText('The show timer stopped.')).toBeTruthy();
  expect(screen.getByText('The room is still on On air.')).toBeTruthy();
  fireEvent.click(screen.getByText('Keep'));
  await flush();
  expect(writes).toHaveLength(0);
  expect(screen.queryByText('The show timer stopped.')).toBeNull();
});

// Section: the chip

it('the Work chip names the preset that is on, and says key light words when none is', async () => {
  useSignalStore.setState({ recording: true });
  answer = studioWith('onAir');
  render(
    <>
      <LightsChip />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(screen.getByText('Lights: On air')).toBeTruthy();
  expect(await tipOf(screen.getByText('Lights: On air').closest('button') as Element)).toContain('Key lights on, panels glow');
  await act(async () => {
    answer = studioAnswer();
    await useHome.getState().readStudio();
  });
  expect(screen.getByText('Lights: key lights 60%')).toBeTruthy();
});

it('the chip says "changed" after the preset, and an amber dot shows while an offer waits', async () => {
  useSignalStore.setState({ recording: true });
  answer = studioWith('onAir', { changed: true });
  render(<LightsChip />);
  await flush();
  expect(screen.getByText('Lights: On air, changed')).toBeTruthy();
  expect(document.querySelector('.lights-chip .st-dot')).toBeNull();
  await act(async () => {
    useHome.setState({ offer: { kind: 'stop', what: 'recording', label: 'On air' } });
  });
  expect(document.querySelector('.lights-chip .st-dot')).toBeTruthy();
});

it('the chip is unchanged when the home part is absent, and says nothing about a preset that is old', async () => {
  useSignalStore.setState({ recording: true });
  mocks.set('wall2_studio', () => {
    throw 'absent';
  });
  render(<LightsChip />);
  await flush();
  expect(screen.getByText('Lights: key lights 60%')).toBeTruthy();
  resetHome();
  answer = studioWith('onAir');
  mocks.set('wall2_studio', () => answer);
  await act(async () => useHome.getState().readStudio());
  expect(screen.getByText('Lights: On air')).toBeTruthy();
  mocks.set('wall2_studio', () => {
    throw 'unreachable';
  });
  await act(async () => useHome.getState().readStudio());
  expect(screen.queryByText('Lights: On air')).toBeNull();
});

it('on Meet the chip shows while a call shows, with no recording needed, and opens the sheet', async () => {
  useSignalStore.setState({ recording: false });
  answer = studioWith('onAir');
  render(<LightsChip where="meet" />);
  await flush();
  fireEvent.click(screen.getByText('Lights: On air'));
  expect(useKeyLights.getState().drawer).toBe(true);
  expect(document.querySelector('.st-drawer')).toBeTruthy();
});

// Section: the sheet

const openSheet = async () => {
  const view = await showBlock();
  fireEvent.click(screen.getByText('Fine tune'));
  await flush();
  return view;
};
const sheet = () => within(document.querySelector('.st-drawer') as HTMLElement);

it('the sheet: preset tiles with each line, Back to normal, then the key lights and the rooms with the floor', async () => {
  await openSheet();
  const tiles = [...document.querySelectorAll('.st-pt')].map((t) => t.querySelector('.st-pt-n')?.textContent);
  expect(tiles).toEqual(['On air', 'Recording', 'Back to normal']);
  expect(sheet().getByText('Key lights on, panels glow')).toBeTruthy();
  expect(sheet().getByText('Linked')).toBeTruthy();
  expect(sheet().getByText('Glow')).toBeTruthy();
  expect(sheet().getByText('Calm')).toBeTruthy();
  // The short words sit on the name's line; the full sentence is the tip.
  const floors = sheet().getAllByText('Floor 45%');
  expect(floors).toHaveLength(2);
  expect(await tipOf(floors[0])).toContain('White 80%. Floor 45%');
  const sliders = sheet().getAllByRole('slider', { name: /Behind monitor brightness|Overhead brightness/ });
  expect(sliders).toHaveLength(2);
  expect(document.querySelectorAll('.st-floor')).toHaveLength(2);
});

it('a room slider stops at the floor and sends a whole level with on', async () => {
  await openSheet();
  const track = sheet().getByRole('slider', { name: 'Behind monitor brightness' });
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 26, width: 200, height: 26, x: 0, y: 0, toJSON: () => ({}) });
  track.setPointerCapture = () => {};
  // 10 percent of the track is below the 45 percent floor: the slider holds at 45.
  fireEvent.pointerDown(track, { clientX: 20, button: 0, pointerId: 1 });
  fireEvent.pointerUp(track, { pointerId: 1 });
  await flush();
  expect(writes.at(-1)).toEqual({ command: 'wall2_studio_group', args: { id: 'behindMonitor', on: true, level: 45 } });
  fireEvent.pointerDown(track, { clientX: 150, button: 0, pointerId: 1 });
  fireEvent.pointerUp(track, { pointerId: 1 });
  await flush();
  expect(writes.at(-1)).toEqual({ command: 'wall2_studio_group', args: { id: 'behindMonitor', on: true, level: 75 } });
});

it('a look chip applies its look; the active look shows the check', async () => {
  answer = studioWith('onAir', { looks: [{ id: 'glow', label: 'Glow', active: true }, { id: 'calm', label: 'Calm', active: false }] });
  await openSheet();
  expect(sheet().getByText('Glow').closest('button')?.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(sheet().getByText('Calm'));
  await flush();
  expect(writes.at(-1)).toEqual({ command: 'wall2_studio_look', args: { id: 'calm' } });
});

it('without a token the sheet shows its tiles and rooms disabled, and one amber button says why', async () => {
  answer = studioAnswer({ canWrite: false, writeBlock: 'not-set-up' });
  await openSheet();
  expect(sheet().getByText('On air').closest('button')?.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(sheet().getByText('Calm'));
  fireEvent.click(sheet().getAllByRole('switch', { name: '' })[1]);
  await flush();
  expect(writes).toHaveLength(0);
  fireEvent.click(sheet().getByRole('button', { name: /desk token/i }));
  expect(useToolsStore.getState().focus).toBe('desktoken');
});

it('a group that needs a Hue zone reads the home app words in the sheet and has no slider', async () => {
  answer = studioAnswer({ groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', true, 80), group('overhead', 'Overhead', false, 0, { canSwitch: false, canDim: false, setTo: 'Needs a Hue zone', floor: null })] });
  await openSheet();
  expect(sheet().getByText('Needs a Hue zone')).toBeTruthy();
  expect(sheet().queryByRole('slider', { name: 'Overhead brightness' })).toBeNull();
});

it('without the home part the sheet is the key lights as before, with the quiet line', async () => {
  mocks.set('wall2_studio', () => {
    throw 'absent';
  });
  await openSheet();
  expect(document.querySelector('.st-pt')).toBeNull();
  expect(sheet().getByText('Presets and room lights: the home app does not offer them here yet.')).toBeTruthy();
  expect(sheet().getByText('Linked')).toBeTruthy();
});

it('the sheet reads the home app once when it opens', async () => {
  const reads = vi.fn(() => answer);
  mocks.set('wall2_studio', reads);
  await showBlock();
  const n = reads.mock.calls.length;
  fireEvent.click(screen.getByText('Fine tune'));
  await flush();
  expect(reads.mock.calls.length).toBeGreaterThan(n);
});

// Section: fix round, the sheet

it('six panel looks: every look chip is there and reachable, and the last one applies', async () => {
  const looks = ['glow', 'calm', 'sunrise', 'ocean', 'ember', 'aurora'].map((id) => ({ id, label: id.toUpperCase(), active: false }));
  answer = studioAnswer({ looks });
  await openSheet();
  expect(sheet().getAllByRole('button').filter((b) => looks.some((l) => l.label === b.textContent))).toHaveLength(6);
  fireEvent.click(sheet().getByText('AURORA'));
  await flush();
  expect(writes.at(-1)).toEqual({ command: 'wall2_studio_look', args: { id: 'aurora' } });
});

it('a preset tile carries its whole line in its text and in its tip', async () => {
  const line = 'Key lights on, panels glow, monitor and overhead white, then the desk lamp at half';
  const presets = (answer.presets as Record<string, unknown>[]).map((p, i) => (i === 0 ? { ...p, line } : p));
  answer = studioAnswer({ presets });
  await openSheet();
  expect(document.querySelector('.st-pt .st-pt-l')?.textContent).toBe(line);
  expect(await tipOf(document.querySelector('.st-pt') as Element)).toContain(line);
});

it('a room slider with a floor fills from the floor, the part under it stays hatched', async () => {
  await openSheet();
  const track = sheet().getByRole('slider', { name: 'Behind monitor brightness' });
  const fill = track.querySelector('.st-fi') as HTMLElement;
  expect(track.querySelector('.st-hatch')).toBeTruthy();
  expect(fill.style.left).toBe('45%');
  expect(fill.style.width).toBe('35%');
});

it('a click outside closes the sheet, as the footer says', async () => {
  await openSheet();
  expect(sheet().getByText('Esc or a click outside closes it')).toBeTruthy();
  fireEvent.pointerDown(document.body);
  await flush();
  expect(document.querySelector('.st-drawer')).toBeNull();
});

it('a room\'s short words: the floor, else the home app\'s words without their number, else On or Off', () => {
  const g = (over: Record<string, unknown>) => studioOf(studioAnswer({ groups: [{ ...group('overhead', 'Overhead', true, 90), ...over }] }))!.groups[0];
  expect(shortWords(g({}))).toBe('Floor 45%');
  expect(shortWords(g({ floor: null, setTo: 'Glow 70%' }))).toBe('Glow');
  expect(shortWords(g({ floor: null, setTo: null, on: false }))).toBe('Off');
  expect(shortWords(g({ canSwitch: false, setTo: 'Needs a Hue zone' }))).toBe('Needs a Hue zone');
});
