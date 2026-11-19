import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { resetTip } from '../ui/HoverTip';
import { useSceneWeather } from '../weather/sceneSetting';
import { DEFAULT_LOOKS } from '../unwind/watch/looks';
import { useWatchStore } from '../unwind/watch/store';
import { resetKeysFeed } from '../work/keysFeed';
import { resetReports } from './reports';
import { resetRetries } from './sources';
import { GROUP_KEY, resetTools, useToolsStore, type ToolsFocus } from './store';
import { GROUPS, ToolsDrawer, groupOf } from './ToolsDrawer';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let lightSyncAnswer: () => unknown;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-13T17:00:00Z'));
  localStorage.removeItem(GROUP_KEY);
  resetTools();
  resetTip();
  resetReports();
  resetRetries();
  resetKeysFeed();
  useSceneWeather.setState({ on: true });
  useWatchStore.setState({ looks: { ...DEFAULT_LOOKS } });
  usePlaceStore.setState({ active: 'work' });
  lightSyncAnswer = () => ({ paired: true, bridgeChanged: false, running: false, starting: false, lastError: null, stoppedHueSync: false });
  mocks.set('wall2_keys_summary', () => ({ front: 'idle', autoId: null, exe: null, sets: [], source: 'default', defaultPins: [], filePins: [] }));
  mocks.set('wall2_build_info', () => ({ commit: '7c9f442', builtAt: '2026-11-13T16:17Z' }));
  mocks.set('wall2_meet_next', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }, { id: 'second', label: 'Second', state: 'signed-out' }], meetings: [] }));
  mocks.set('wall2_meet_open_status', () => 'desktop');
  mocks.set('wall2_spotify_status', () => ({ setup: false, signedIn: false }));
  mocks.set('wall2_youtube_status', () => ({ setup: true, signedIn: true, reason: null, searchesLeft: null }));
  mocks.set('wall2_lightsync_status', () => lightSyncAnswer());
  mocks.set('wall2_tasks_next', () => []);
  mocks.set('wall2_sonos_summary', () => ({}));
  mocks.set('wall2_machines', () => ({ pc: {}, box: {}, boxStale: false }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  mocks.clear();
});

const openAt = async (focus: ToolsFocus = null) => {
  render(<ToolsDrawer />);
  act(() => useToolsStore.getState().openDrawer(focus));
  await flush();
};
const open = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.getAttribute('data-group'));

it('the group list is data: every entry has an icon, a tip, a panel and one rail tab', async () => {
  await openAt();
  expect(screen.getAllByRole('tab')).toHaveLength(GROUPS.length);
  for (const g of GROUPS) {
    expect(g.tip.length).toBeGreaterThan(0);
    expect(document.getElementById(`tools-panel-${g.id}`)).toBeTruthy();
    expect(document.querySelector(`.tools-tab[data-group="${g.id}"] svg`)).toBeTruthy();
  }
});

it('each link target opens its own group, and a ring target rings its block', async () => {
  const cases: [ToolsFocus, string, string | null][] = [
    ['accounts', 'accounts', 'accounts'],
    ['keylights', 'lights', 'keylights'],
    ['desktoken', 'lights', 'desktoken'],
    ['health', 'health', null],
    ['lights', 'lights', null],
    ['display', 'display', null],
  ];
  // Every section a group lists is covered by a case above.
  for (const g of GROUPS) for (const section of g.sections) expect(cases.map((c) => c[0])).toContain(section);
  for (const [focus, group, ring] of cases) {
    localStorage.setItem(GROUP_KEY, 'display');
    resetTools();
    const { unmount } = render(<ToolsDrawer />);
    act(() => useToolsStore.getState().openDrawer(focus));
    await flush();
    expect(open(), String(focus)).toEqual([group]);
    expect(groupOf(focus)).toBe(group);
    const ringed = [...document.querySelectorAll('.tools-ringed')].map((e) => e.getAttribute('data-section'));
    expect(ringed, String(focus)).toEqual(ring ? [ring] : []);
    unmount();
  }
});

it('a link while the drawer is already open on another group switches to the group it names', async () => {
  await openAt();
  fireEvent.click(screen.getByRole('tab', { name: /^Display/ }));
  expect(open()).toEqual(['display']);
  act(() => useToolsStore.getState().openDrawer('keylights'));
  await flush();
  expect(open()).toEqual(['lights']);
});

it('the last open group is remembered for the next time the drawer opens', async () => {
  await openAt();
  expect(open()).toEqual(['accounts']);
  fireEvent.click(screen.getByRole('tab', { name: /^Health/ }));
  await flush();
  expect(localStorage.getItem(GROUP_KEY)).toBe('health');
  act(() => useToolsStore.getState().close());
  await flush();
  act(() => useToolsStore.getState().openDrawer());
  await flush();
  expect(open()).toEqual(['health']);
  // A link wins over the memory.
  act(() => useToolsStore.getState().close());
  act(() => useToolsStore.getState().openDrawer('desktoken'));
  await flush();
  expect(open()).toEqual(['lights']);
});

it('an unknown remembered value is ignored', async () => {
  localStorage.setItem(GROUP_KEY, 'nonsense');
  await openAt();
  expect(open()).toEqual(['accounts']);
});

it('the remembered group survives a localStorage that throws on every read and write', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await openAt();
  expect(open()).toEqual(['accounts']);
  fireEvent.click(screen.getByRole('tab', { name: /^Display/ }));
  await flush();
  expect(open()).toEqual(['display']);
  // The drawer still works: it opens at a link and closes.
  act(() => useToolsStore.getState().openDrawer('keylights'));
  await flush();
  expect(open()).toEqual(['lights']);
  act(() => useToolsStore.getState().close());
  expect(screen.queryByLabelText('Tools')).toBeNull();
});

it('the arrow keys move between rail groups', async () => {
  await openAt();
  const tab = (g: string) => document.querySelector(`.tools-tab[data-group="${g}"]`) as HTMLElement;
  fireEvent.keyDown(tab('accounts'), { key: 'ArrowDown' });
  expect(open()).toEqual(['health']);
  fireEvent.keyDown(tab('health'), { key: 'ArrowUp' });
  fireEvent.keyDown(tab('accounts'), { key: 'ArrowUp' });
  expect(open()).toEqual(['display']);
});

const lines = () => Object.fromEntries([...document.querySelectorAll('[data-rail-status]')].map((e) => [e.getAttribute('data-rail-status'), e.textContent]));

it('each rail entry renders a status line from the state its panel shows', async () => {
  await openAt();
  await flush(500);
  const l = lines();
  expect(Object.keys(l)).toEqual(GROUPS.map((g) => g.id));
  for (const text of Object.values(l)) expect(text).toBeTruthy();
  // Work is connected, Second is signed out, Spotify is not set up, YouTube is signed in.
  expect(l.accounts).toBe('1 needs sign-in');
  expect(l.lights).toBe('Hue paired');
  expect(l.display).toBe('Weather on');
  expect(l.health).toMatch(/^(All fresh|\d+ need a look)$/);
  // The dot beside each line is part of the entry.
  for (const g of GROUPS) expect(document.querySelector(`.tools-tab[data-group="${g.id}"] .tools-dot`)).toBeTruthy();
});

it('rail lines follow the state: weather off, not paired, bridge changed, every account signed in', async () => {
  await openAt();
  await flush(500);
  act(() => useSceneWeather.getState().setOn(false));
  await flush();
  expect(lines().display).toBe('Weather off');
  lightSyncAnswer = () => ({ paired: false, bridgeChanged: false, running: false, starting: false, lastError: null, stoppedHueSync: false });
  mocks.set('wall2_meet_next', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }], meetings: [] }));
  act(() => useToolsStore.getState().close());
  act(() => useToolsStore.getState().openDrawer());
  await flush(500);
  expect(lines().lights).toBe('Nothing set up');
  expect(lines().accounts).toBe('All signed in');
  lightSyncAnswer = () => ({ paired: true, bridgeChanged: true, running: false, starting: false, lastError: null, stoppedHueSync: false });
  act(() => useToolsStore.getState().close());
  act(() => useToolsStore.getState().openDrawer());
  await flush(500);
  expect(lines().lights).toBe('Bridge changed');
  expect(document.querySelector('[data-rail-status="lights"]')?.className).toContain('bad');
});

it('a refused keys file counts toward Health', async () => {
  mocks.set('wall2_keys_summary', () => {
    throw 'chord is not in the allowed key list';
  });
  await openAt();
  await flush(500);
  expect(lines().health).toMatch(/need a look$/);
  expect(document.querySelector('[data-rail-status="health"]')?.className).toContain('bad');
});

it('every rail tab carries a hover tip and the panel title matches the group', async () => {
  await openAt();
  for (const g of GROUPS) {
    expect(document.querySelector(`.tools-tab[data-group="${g.id}"]`)?.hasAttribute('data-tip')).toBe(true);
    expect(document.querySelector(`#tools-panel-${g.id} .tools-ptitle`)?.textContent).toBe(g.name);
  }
});
