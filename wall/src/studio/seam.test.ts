import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { studioAnswer } from './homeKit';
import { backendNameFor, chooseBackend, currentInfo, directBackend, homeBackend, noteHomeKeys, resetSeam, type BackendInfo } from './keyLights';
import { viewOf } from './model';
import { resetKeyLights, useKeyLights } from './store';

vi.setConfig({ testTimeout: 20_000 });

const info = (over: Partial<BackendInfo> = {}): BackendInfo => ({ saved: { left: true, right: true }, directSilent: { left: false, right: false }, homeCanSet: false, ...over });

beforeEach(() => {
  resetSeam();
  resetKeyLights();
});
afterEach(() => {
  mocks.clear();
});

it('the choice table: direct whenever an address is saved, home only when direct is silent everywhere and the home app can set', () => {
  const rows: [string, BackendInfo, 'direct' | 'home'][] = [
    ['saved, direct fine, home can set', info({ homeCanSet: true }), 'direct'],
    ['saved, direct silent, home cannot set', info({ directSilent: { left: true, right: true } }), 'direct'],
    ['saved, direct silent, home can set', info({ directSilent: { left: true, right: true }, homeCanSet: true }), 'home'],
    ['no address, home can set', info({ saved: { left: false, right: false }, homeCanSet: true }), 'home'],
    ['no address, home cannot set', info({ saved: { left: false, right: false } }), 'direct'],
    ['saved not known yet, direct fine', info({ saved: null, homeCanSet: true }), 'direct'],
  ];
  for (const [name, i, want] of rows) {
    expect(backendNameFor('left', i), name).toBe(want);
    expect(backendNameFor('right', i), name).toBe(want);
  }
});

it('the choice is per side: one silent light with an address and the other fine split the back ends', () => {
  const i = info({ directSilent: { left: true, right: false }, homeCanSet: true });
  expect(backendNameFor('left', i)).toBe('home');
  expect(backendNameFor('right', i)).toBe('direct');
  expect(chooseBackend(info())).toBe(directBackend);
  expect(chooseBackend(info({ directSilent: { left: true, right: true }, homeCanSet: true }))).toBe(homeBackend);
  expect(chooseBackend(i)).not.toBe(directBackend);
  expect(chooseBackend(i)).not.toBe(homeBackend);
});

it('direct silent on every read since the app started is told from the reads, one answering read clears it', async () => {
  const silent = { left: 'no-answer', right: 'timeout' };
  mocks.set('wall2_keylights_read', () => silent);
  expect(currentInfo().directSilent).toEqual({ left: false, right: false });
  await directBackend.read();
  await directBackend.read();
  expect(currentInfo().directSilent).toEqual({ left: true, right: true });
  mocks.set('wall2_keylights_read', () => ({ left: { on: true, brightness: 50, kelvin: 4000 }, right: 'other-model' }));
  await directBackend.read();
  expect(currentInfo().directSilent).toEqual({ left: false, right: true });
  // other-model counts as silent too.
  noteHomeKeys(true);
  expect(currentInfo().homeCanSet).toBe(true);
  noteHomeKeys(false);
  expect(currentInfo().homeCanSet).toBe(false);
});

it('the home back end reads the studio answer keys and sets through the keylights command', async () => {
  const keys = { canSet: true, left: { on: true, brightness: 40, kelvin: 3500 }, right: 'no-answer' };
  mocks.set('wall2_studio', () => studioAnswer({ keys }));
  expect(await homeBackend.read()).toEqual({ left: { on: true, brightness: 40, kelvin: 3500 }, right: 'no-answer' });
  const set = vi.fn(() => studioAnswer({ keys: { canSet: true, left: { on: false, brightness: 40, kelvin: 3500 }, right: { on: false, brightness: 40, kelvin: 3500 } } }));
  mocks.set('wall2_studio_keys', set);
  expect(await homeBackend.set('both', { on: false })).toEqual({ left: { on: false, brightness: 40, kelvin: 3500 }, right: { on: false, brightness: 40, kelvin: 3500 } });
  expect(set).toHaveBeenCalledWith({ which: 'both', on: false });
  await homeBackend.set('left', { brightness: 55.4, kelvin: 4010 });
  expect(set).toHaveBeenLastCalledWith({ which: 'left', brightness: 55, kelvin: 4010 });
  // Only the touched side comes back.
  expect(await homeBackend.set('right', { on: true })).toEqual({ left: null, right: { on: false, brightness: 40, kelvin: 3500 } });
});

it('the home back end maps a studio that cannot set to not-set-up, a missing side to failed, and a busy write stays busy', async () => {
  mocks.set('wall2_studio', () => studioAnswer({ keys: { canSet: false, left: null, right: null } }));
  expect(await homeBackend.read()).toEqual({ left: 'not-set-up', right: 'not-set-up' });
  mocks.set('wall2_studio', () => studioAnswer({ keys: { canSet: true, left: null, right: 'other-model' } }));
  expect(await homeBackend.read()).toEqual({ left: 'failed', right: 'other-model' });
  mocks.set('wall2_studio_keys', () => {
    throw 'busy';
  });
  await expect(homeBackend.set('both', { on: true })).rejects.toBe('busy');
  mocks.set('wall2_studio_keys', () => {
    throw 'unreachable';
  });
  await expect(homeBackend.set('both', { on: true })).rejects.toBe('failed');
});

it('the store reads through the home app once direct has been silent and the home app can set', async () => {
  mocks.set('wall2_keylights_status', () => ({ left: { set: true }, right: { set: true } }));
  mocks.set('wall2_keylights_read', () => ({ left: 'no-answer', right: 'no-answer' }));
  const keys = { canSet: true, left: { on: true, brightness: 30, kelvin: 3000 }, right: { on: true, brightness: 30, kelvin: 3000 } };
  mocks.set('wall2_studio', () => studioAnswer({ keys }));
  await useKeyLights.getState().refresh();
  expect(useKeyLights.getState().left).toBe('no-answer');
  // The home app reports it can set the key lights (the polling tells the seam).
  noteHomeKeys(true);
  await useKeyLights.getState().refresh();
  expect(useKeyLights.getState().left).toEqual({ on: true, brightness: 30, kelvin: 3000 });
  expect(useKeyLights.getState().right).toEqual({ on: true, brightness: 30, kelvin: 3000 });
});

it('with the home app unable to set them, a silent direct light shows its own words as before', async () => {
  mocks.set('wall2_keylights_status', () => ({ left: { set: true }, right: { set: true } }));
  mocks.set('wall2_keylights_read', () => ({ left: 'no-answer', right: 'no-answer' }));
  await useKeyLights.getState().refresh();
  await useKeyLights.getState().refresh();
  expect(useKeyLights.getState().left).toBe('no-answer');
});

// Fix round: the fallback must be used by the running store, not only chosen.
it('store level: no address saved on either side and the home app able to set them, a refresh shows the reported pair and a write goes to the home app', async () => {
  mocks.set('wall2_keylights_status', () => ({ left: { set: false }, right: { set: false } }));
  mocks.set('wall2_keylights_read', () => {
    throw new Error('the direct back end must not be asked');
  });
  const keys = { canSet: true, left: { on: true, brightness: 35, kelvin: 3300 }, right: { on: true, brightness: 36, kelvin: 3400 } };
  mocks.set('wall2_studio', () => studioAnswer({ keys }));
  noteHomeKeys(true);
  await useKeyLights.getState().refresh();
  expect(useKeyLights.getState().left).toEqual({ on: true, brightness: 35, kelvin: 3300 });
  expect(useKeyLights.getState().right).toEqual({ on: true, brightness: 36, kelvin: 3400 });
  // The pages see lights that answer, and Tools still sees that no address is saved.
  const s = useKeyLights.getState();
  expect(viewOf({ status: s.status, left: s.left, right: s.right })).toBe('live');
  expect(s.saved).toEqual({ left: false, right: false, unreadable: false });
  const set = vi.fn(() => studioAnswer({ keys: { canSet: true, left: { on: false, brightness: 35, kelvin: 3300 }, right: { on: false, brightness: 36, kelvin: 3400 } } }));
  mocks.set('wall2_studio_keys', set);
  await useKeyLights.getState().set('both', { on: false });
  expect(set).toHaveBeenCalledWith({ which: 'both', on: false });
  expect(useKeyLights.getState().left).toMatchObject({ on: false });
});

it('store level: with no usable back end (the home app cannot set them) the old unset result stays', async () => {
  mocks.set('wall2_keylights_status', () => ({ left: { set: false }, right: { set: false } }));
  await useKeyLights.getState().refresh();
  const s = useKeyLights.getState();
  expect(viewOf({ status: s.status, left: s.left, right: s.right })).toBe('unset');
  expect(s.left).toBeNull();
});
